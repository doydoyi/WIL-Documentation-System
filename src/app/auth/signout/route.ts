import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LAST_ACTIVITY_COOKIE } from "@/lib/domain/access";

const REASONS = new Set(["timeout", "inactive"]);

async function signOut(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const reason = request.nextUrl.searchParams.get("reason");
  const url = new URL("/login", request.url);
  if (reason && REASONS.has(reason)) url.searchParams.set("error", reason);

  const response = NextResponse.redirect(url, { status: 303 });
  response.cookies.delete(LAST_ACTIVITY_COOKIE);
  return response;
}

export const GET = signOut;
export const POST = signOut;
