import { z } from "zod";
import { sendReminders } from "@/services/notifications";
import { isoDate, readJson, sandboxRoute } from "../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = sandboxRoute(async (request) => {
  const { date } = z.object({ date: isoDate.optional() }).parse(await readJson(request));
  return sendReminders({ today: date });
});
