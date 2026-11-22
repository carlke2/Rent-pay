import { NextResponse } from "next/server";
import { readLocalFile, verifyLocalSignature } from "@/adapters/storage/local";
import { getEnvironment } from "@/configuration/environment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves files for the local (development) storage adapter, only with a valid, unexpired signature. */
export async function GET(request: Request, context: RouteContext<"/api/files/[...key]">) {
  if (getEnvironment().STORAGE_PROVIDER !== "local") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { key } = await context.params;
  const joined = key.join("/");
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get("expires"));
  const signature = url.searchParams.get("signature") ?? "";
  if (!verifyLocalSignature(joined, expires, signature)) return NextResponse.json({ error: "Link expired or invalid" }, { status: 403 });
  try {
    const file = await readLocalFile(joined);
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
