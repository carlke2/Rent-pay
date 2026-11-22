import { z } from "zod";
import { moveIn } from "@/services/tenancy";
import { isoDate, readJson, SANDBOX_ACTOR, sandboxRoute, unitIdFromCode, wholeShillings } from "../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    unitId: z.uuid().optional(),
    unitCode: z.string().optional(),
    tenant: z.union([
      z.object({ tenantId: z.uuid() }),
      z.object({
        fullName: z.string().min(1),
        phone: z.string().min(1),
        nationalId: z.string().nullish(),
        alternativePhone: z.string().nullish(),
        whatsappOptIn: z.boolean().optional(),
        nextOfKin: z.object({ name: z.string(), phone: z.string(), relationship: z.string().optional() }).nullish(),
      }),
    ]),
    startDate: isoDate,
    rentAmount: wholeShillings.min(0).optional(),
    depositAmount: wholeShillings.min(0).optional(),
    openingReading: z.number().int().min(0).nullish(),
    date: isoDate.optional(),
  })
  .refine((body) => body.unitId || body.unitCode, "unitId or unitCode is required");

export const POST = sandboxRoute(async (request) => {
  const { unitCode, unitId, date, ...body } = schema.parse(await readJson(request));
  return moveIn({ ...body, unitId: unitId ?? (await unitIdFromCode(unitCode ?? "")), actor: SANDBOX_ACTOR, today: date });
});
