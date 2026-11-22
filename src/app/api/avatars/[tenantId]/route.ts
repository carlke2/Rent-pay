import { NextResponse } from "next/server";
import { z } from "zod";
import { getStorage } from "@/adapters/storage";
import { readSession } from "@/authentication/session";
import { getAvatarKey } from "@/services/avatars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

/**
 * Streams a tenant's profile photo from private storage. Only that tenant or the landlord may see it; everyone
 * else gets 404 (not 403), so the route doesn't reveal which tenants have a photo.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/avatars/[tenantId]">) {
  const { tenantId } = await params;
  if (!z.uuid().safeParse(tenantId).success) return new NextResponse(null, { status: 404, headers: PRIVATE_HEADERS });

  const [tenant, landlord] = await Promise.all([readSession("tenant"), readSession("landlord")]);
  const allowed = Boolean(landlord) || tenant?.subject === tenantId;
  if (!allowed) return new NextResponse(null, { status: 404, headers: PRIVATE_HEADERS });

  const key = await getAvatarKey(tenantId);
  const file = key ? await getStorage().get(key) : null;
  if (!file) return new NextResponse(null, { status: 404, headers: PRIVATE_HEADERS });

  return new NextResponse(new Blob([file.bytes as BlobPart], { type: "image/webp" }), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(file.bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
