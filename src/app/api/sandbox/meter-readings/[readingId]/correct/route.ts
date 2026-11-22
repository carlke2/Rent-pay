import { z } from "zod";
import { correctMeterReading } from "@/services/billing";
import { readJson, SANDBOX_ACTOR, sandboxRoute } from "../../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = sandboxRoute<RouteContext<"/api/sandbox/meter-readings/[readingId]/correct">>(async (request, context) => {
  const { readingId } = await context.params;
  const { currentReading } = z.object({ currentReading: z.number().int().min(0) }).parse(await readJson(request));
  return correctMeterReading({ readingId: z.uuid().parse(readingId), currentReading, actor: SANDBOX_ACTOR });
});
