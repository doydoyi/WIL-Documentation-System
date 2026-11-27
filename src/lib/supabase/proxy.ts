import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSessionIdleExpired, LAST_ACTIVITY_COOKIE } from "@/lib/domain/access";

/** Routes reachable without a session. */
const PUBLIC_PATHS = ["/login", "/auth/"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));
}

/**
 * Runs before every matched request:
 *  1. refreshes the Supabase session cookies;
 *  2. sends requests without a session to /login (route protection);
 *  3. ends sessions idle for more than 20 minutes (FR-1.1.3, NFR-SE-08).
 * Role checks happen in layouts, Server Actions and RLS.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  let noCacheHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          // Cache-Control etc. keep a CDN from serving one user's session cookie to another.
          noCacheHeaders = headers;
          Object.entries(headers).forEach(([key, value]) => supabaseResponse.headers.set(key, value));
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    const [p, q] = path.split("?");
    url.pathname = p;
    url.search = q ? `?${q}` : "";
    const response = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    Object.entries(noCacheHeaders).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  };

  if (!signedIn) {
    if (isPublicPath(pathname)) return supabaseResponse;
    const next = encodeURIComponent(pathname + search);
    return redirectTo(pathname === "/" ? "/login" : `/login?next=${next}`);
  }

  if (pathname.startsWith("/auth/")) return supabaseResponse;

  const lastActivity = Number(request.cookies.get(LAST_ACTIVITY_COOKIE)?.value ?? NaN);
  if (isSessionIdleExpired(Number.isFinite(lastActivity) ? lastActivity : null, Date.now())) {
    return redirectTo("/auth/signout?reason=timeout");
  }

  const response = pathname === "/login" || pathname === "/" ? redirectTo("/dashboard") : supabaseResponse;
  response.cookies.set(LAST_ACTIVITY_COOKIE, String(Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return response;
}
