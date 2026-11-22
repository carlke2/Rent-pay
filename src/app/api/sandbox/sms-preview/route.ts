import { previewSmsTemplates } from "@/services/notifications";
import { ServiceError } from "@/services/errors";
import { sandboxRoute } from "../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = sandboxRoute(async (request) => {
  const leaseId = new URL(request.url).searchParams.get("leaseId");
  if (!leaseId) throw new ServiceError("leaseId is required");
  const templates = await previewSmsTemplates(leaseId);
  return { templates };
});
