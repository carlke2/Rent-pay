import { inArray } from "drizzle-orm";
import { z } from "zod";
import { normaliseUnitCode } from "@/core/payments";
import { getDatabase } from "@/database/client";
import { units } from "@/database/schema";
import { BillingError, saveMeterReadings } from "@/services/billing";
import { billingPeriod, isoDate, readJson, SANDBOX_ACTOR, sandboxRoute } from "../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const readingsSchema = z.object({
  period: billingPeriod,
  readings: z.array(z.object({ unitCode: z.string().min(1), currentReading: z.number().int().min(0) })).min(1),
  date: isoDate.optional(),
});

export const POST = sandboxRoute(async (request) => {
  const body = readingsSchema.parse(await readJson(request));
  const codes = body.readings.map((reading) => normaliseUnitCode(reading.unitCode));
  const found = await getDatabase()
    .select({ id: units.id, normalisedCode: units.normalisedCode })
    .from(units)
    .where(inArray(units.normalisedCode, codes));
  const idByCode = new Map(found.map((unit) => [unit.normalisedCode, unit.id]));

  const readings = body.readings.map((reading) => {
    const unitId = idByCode.get(normaliseUnitCode(reading.unitCode));
    if (!unitId) throw new BillingError(`Unknown unit code ${reading.unitCode}`);
    return { unitId, currentReading: reading.currentReading };
  });
  return { readings: await saveMeterReadings({ period: body.period, readings, actor: SANDBOX_ACTOR, today: body.date }) };
});
