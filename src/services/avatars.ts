import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import sharp from "sharp";
import { detectImageType, getStorage } from "@/adapters/storage";
import { getDatabase } from "@/database/client";
import { auditLog, tenants } from "@/database/schema";
import { writeAudit } from "./audit";
import { ServiceError } from "./errors";
import { logError } from "@/utilities/log";

export const AVATAR_MAX_BYTES = 4 * 1024 * 1024;
const AVATAR_SIZE = 512;
const UPLOADS_PER_HOUR = 10;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);

/** The URL the app shows for a tenant's photo; the key's random part busts the 1-hour private cache on change. */
export function avatarUrl(tenantId: string, avatarKey: string | null | undefined): string | null {
  if (!avatarKey) return null;
  const version = avatarKey.split("/").pop()?.replace(/\.webp$/, "") ?? "";
  return `/api/avatars/${tenantId}?v=${version}`;
}

/**
 * Validates and normalises an uploaded photo: JPEG/PNG/WebP by magic bytes (not the claimed type), at most 4 MB,
 * EXIF rotation applied, centre-cropped to 512x512, WebP, and no metadata (EXIF/GPS/ICC are dropped by default).
 */
export async function processAvatar(bytes: Uint8Array): Promise<Buffer> {
  if (bytes.byteLength === 0) throw new ServiceError("That file is empty.");
  if (bytes.byteLength > AVATAR_MAX_BYTES) throw new ServiceError("The photo must be 4 MB or smaller.");
  const detected = detectImageType(bytes);
  if (!detected || !ACCEPTED.has(detected.contentType)) throw new ServiceError("Choose a JPEG, PNG or WebP photo.");
  try {
    return await sharp(bytes, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new ServiceError("We couldn't read that photo. Try another one.");
  }
}

async function uploadsInLastHour(tenantId: string): Promise<number> {
  const [row] = await getDatabase()
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "tenant.avatar_upload"),
        eq(auditLog.entity, "tenant"),
        eq(auditLog.entityId, tenantId),
        gte(auditLog.createdAt, new Date(Date.now() - 60 * 60_000)),
      ),
    );
  return row?.count ?? 0;
}

/** Deletes a replaced/removed object. Never fails the request: an orphaned file is logged, not shown to the user. */
async function deleteQuietly(key: string | null | undefined) {
  if (!key) return;
  try {
    await getStorage().delete(key);
  } catch (error) {
    logError(`[avatars] could not delete old photo ${key}`, error);
  }
}

/** A tenant sets their own photo (10 uploads per hour). Returns the new photo URL. */
export async function setTenantAvatar(tenantId: string, bytes: Uint8Array): Promise<string> {
  if ((await uploadsInLastHour(tenantId)) >= UPLOADS_PER_HOUR) {
    throw new ServiceError("You've changed your photo a lot in the last hour. Please try again later.");
  }
  const webp = await processAvatar(bytes);
  const key = `avatars/${tenantId}/${randomBytes(12).toString("base64url")}.webp`;
  await getStorage().put(key, webp, "image/webp");

  let previous: string | null = null;
  try {
    await getDatabase().transaction(async (transaction) => {
      const [before] = await transaction.select({ avatarKey: tenants.avatarKey }).from(tenants).where(eq(tenants.id, tenantId)).for("update");
      if (!before) throw new ServiceError("Account not found");
      previous = before.avatarKey;
      await transaction.update(tenants).set({ avatarKey: key }).where(eq(tenants.id, tenantId));
      await writeAudit(transaction, { actor: `tenant:${tenantId}`, action: "tenant.avatar_upload", entity: "tenant", entityId: tenantId, before, after: { avatarKey: key } });
    });
  } catch (error) {
    await deleteQuietly(key);
    throw error;
  }
  await deleteQuietly(previous);
  return avatarUrl(tenantId, key)!;
}

/** Removes a tenant's photo (the tenant, or the landlord). */
export async function removeTenantAvatar(tenantId: string, actor: string): Promise<void> {
  let previous: string | null = null;
  await getDatabase().transaction(async (transaction) => {
    const [before] = await transaction.select({ avatarKey: tenants.avatarKey }).from(tenants).where(eq(tenants.id, tenantId)).for("update");
    if (!before) throw new ServiceError("Tenant not found");
    if (!before.avatarKey) return;
    previous = before.avatarKey;
    await transaction.update(tenants).set({ avatarKey: null }).where(eq(tenants.id, tenantId));
    await writeAudit(transaction, { actor, action: "tenant.avatar_remove", entity: "tenant", entityId: tenantId, before, after: { avatarKey: null } });
  });
  await deleteQuietly(previous);
}

export async function getAvatarKey(tenantId: string): Promise<string | null> {
  const [row] = await getDatabase().select({ avatarKey: tenants.avatarKey }).from(tenants).where(eq(tenants.id, tenantId));
  return row?.avatarKey ?? null;
}
