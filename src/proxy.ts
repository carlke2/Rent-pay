import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAMES, verifySessionToken, type Role } from "@/authentication/tokens";

type Area = { prefix: string; login: string; home: string; role: Role };

const AREAS: Area[] = [
  { prefix: "/admin", login: "/admin/login", home: "/admin", role: "landlord" },
  { prefix: "/tenants", login: "/tenants/login", home: "/tenants", role: "tenant" },
];

const within = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/**
 * Guards the landlord app and the tenant portal, and hides the sandbox API outside the sandbox. It runs for no
 * other /api route (see matcher), so M-Pesa callbacks and job routes are never redirected.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // /api/sandbox/* is 404 for every method unless MPESA_ENV=sandbox (unset means sandbox, as in the app's config).
  // The route guard does this too, but only for methods a route defines; others would get 405 and reveal the route.
  if (within(pathname, "/api/sandbox")) {
    const mode = process.env.MPESA_ENV?.trim() || "sandbox";
    return mode === "sandbox" ? NextResponse.next() : NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const area = AREAS.find((candidate) => within(pathname, candidate.prefix));
  if (!area) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE_NAMES[area.role])?.value;
  const session = await verifySessionToken(token, area.role);

  if (within(pathname, area.login)) {
    return session && request.method === "GET"
      ? NextResponse.redirect(new URL(area.home, request.url))
      : NextResponse.next();
  }
  if (session) return NextResponse.next();

  const loginUrl = new URL(area.login, request.url);
  if (pathname !== area.home) loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/tenants", "/tenants/:path*", "/api/sandbox/:path*"],
};
