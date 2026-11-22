import { z } from "zod";
import { previewPolicyChange } from "@/services/policies";
import { isoDate, readJson, sandboxRoute } from "../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const previewSchema = z.object({
  buildingId: z.uuid().nullable().default(null),
  settings: z.record(z.string(), z.unknown()),
  date: isoDate.optional(),
});

export const POST = sandboxRoute(async (request) => {
  const body = previewSchema.parse(await readJson(request));
  return previewPolicyChange({ buildingId: body.buildingId, settings: body.settings, today: body.date });
});
