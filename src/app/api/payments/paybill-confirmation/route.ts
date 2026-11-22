import { receiveCallback } from "../receive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return receiveCallback(request, "paybill_confirmation", { ResultCode: 0, ResultDesc: "Success" });
}
