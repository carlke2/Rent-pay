import { reconcileStatement } from "@/services/payments";
import { ServiceError } from "@/services/errors";
import { SANDBOX_ACTOR, sandboxRoute } from "../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: the statement CSV as text/csv (or JSON { "csvText": "..." }, or multipart with a "file" field). */
export const POST = sandboxRoute(async (request) => {
  const type = request.headers.get("content-type") ?? "";
  let csvText: string;
  if (type.includes("multipart/form-data")) {
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) throw new ServiceError('Attach the statement as a "file" field');
    csvText = await file.text();
  } else if (type.includes("application/json")) {
    const body = (await request.json()) as { csvText?: unknown };
    if (typeof body.csvText !== "string") throw new ServiceError("csvText is required");
    csvText = body.csvText;
  } else {
    csvText = await request.text();
  }
  return reconcileStatement({ csvText, actor: SANDBOX_ACTOR });
});
