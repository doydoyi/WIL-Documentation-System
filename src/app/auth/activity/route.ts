import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSessionIdleExpired, LAST_ACTIVITY_COOKIE } from "@/lib/domain/access";

/** Heartbeat from IdleTimer: records activity for a still-valid session. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return new NextResponse(null, { status: 401 });

  const last = Number(request.cookies.get(LAST_ACTIVITY_COOKIE)?.value ?? NaN);
  if (isSessionIdleExpired(Number.isFinite(last) ? last : null, Date.now())) {
    return new NextResponse(null, { status: 401 });
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(LAST_ACTIVITY_COOKIE, String(Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return response;
}
