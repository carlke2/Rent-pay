import { paybillConfirmation } from "../paybill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Key in ?key=. See ./[key] for the path form that Paybill URLs are registered with. */
export async function POST(request: Request) {
  return paybillConfirmation(request);
}
