import { jobHandler } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = jobHandler("daily-summary", []);

export const GET = handle;
export const POST = handle;
