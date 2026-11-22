import { z } from "zod";
import { createUnit } from "@/services/tenancy";
import { readJson, SANDBOX_ACTOR, sandboxRoute, wholeShillings } from "../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  buildingId: z.uuid(),
  code: z.string().min(1),
  type: z.string().min(1),
  floor: z.number().int().nullish(),
  rentAmount: wholeShillings.min(0),
  depositAmount: wholeShillings.min(0).optional(),
  meterNumber: z.string().nullish(),
});

export const POST = sandboxRoute(async (request) => createUnit({ ...schema.parse(await readJson(request)), actor: SANDBOX_ACTOR }));
