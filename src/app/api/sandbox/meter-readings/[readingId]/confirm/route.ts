import { z } from "zod";
import { confirmMeterReading } from "@/services/billing";
import { SANDBOX_ACTOR, sandboxRoute } from "../../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = sandboxRoute<RouteContext<"/api/sandbox/meter-readings/[readingId]/confirm">>(async (_request, context) => {
  const { readingId } = await context.params;
  return confirmMeterReading({ readingId: z.uuid().parse(readingId), actor: SANDBOX_ACTOR });
});
