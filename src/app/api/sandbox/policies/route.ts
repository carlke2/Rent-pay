import { z } from "zod";
import { getPolicy, savePolicy } from "@/services/policies";
import { todayInNairobi } from "@/utilities/dates";
import { isoDate, readJson, SANDBOX_ACTOR, sandboxRoute } from "../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The policy that applies today (or on ?date=) to ?buildingId= (omit for the account-level policy). */
export const GET = sandboxRoute(async (request) => {
  const url = new URL(request.url);
  const buildingId = z.uuid().nullable().parse(url.searchParams.get("buildingId") || null);
  const date = isoDate.parse(url.searchParams.get("date") ?? todayInNairobi());
  return { date, ...(await getPolicy(buildingId, date)) };
});

const saveSchema = z.object({
  buildingId: z.uuid().nullable().default(null),
  effectiveFrom: isoDate,
  settings: z.record(z.string(), z.unknown()),
});

/** Saves a policy; settings may be partial and are applied on top of what applies now. */
export const POST = sandboxRoute(async (request) => {
  const body = saveSchema.parse(await readJson(request));
  return savePolicy({ ...body, actor: SANDBOX_ACTOR });
});
