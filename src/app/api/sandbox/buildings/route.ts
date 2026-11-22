import { z } from "zod";
import { createBuilding } from "@/services/tenancy";
import { readJson, SANDBOX_ACTOR, sandboxRoute } from "../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ name: z.string().min(1), location: z.string().nullish(), codePrefix: z.string().min(1).max(8) });

export const POST = sandboxRoute(async (request) => createBuilding({ ...schema.parse(await readJson(request)), actor: SANDBOX_ACTOR }));
