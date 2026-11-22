import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAMES, verifySessionToken, type Role } from "@/authentication/tokens";

type Area = { prefix: string; login: string; home: string; role: Role };

const AREAS: Area[] = [
  { prefix: "/admin", login: "/admin/login", home: "/admin", role: "landlord" },
  { prefix: "/tenants", login: "/tenants/login", home: "/tenants", role: "tenant" },
];

const within = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/**
 * Guards the landlord app and the tenant portal. Never runs for /api (see matcher),
 * so M-Pesa callbacks and job routes are never redirected.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
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
  matcher: ["/admin", "/admin/:path*", "/tenants", "/tenants/:path*"],
};
