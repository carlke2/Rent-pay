import { z } from "zod";
import { createPayLink } from "@/authentication/pay-links";
import { readJson, sandboxRoute } from "../../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ validDays: z.number().int().min(1).max(90).optional(), next: z.enum(["pay", "statement"]).optional() });

export const POST = sandboxRoute<RouteContext<"/api/sandbox/leases/[leaseId]/pay-link">>(async (request, context) => {
  const { leaseId } = await context.params;
  return { url: await createPayLink(z.uuid().parse(leaseId), schema.parse(await readJson(request))) };
});
