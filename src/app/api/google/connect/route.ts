import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authorize, AuthorizationError } from "@/lib/auth";
import { buildGoogleAuthUrl, OAUTH_STATE_COOKIE } from "@/lib/google/oauth";

/** Starts the one-time Google authorization for Shared Drive access (UC-1.5 step 1). */
export async function GET(request: Request) {
  try {
    await authorize("administrator");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.redirect(new URL("/dashboard?error=forbidden", request.url));
    }
    throw error;
  }

  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(buildGoogleAuthUrl(state));
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/google",
    maxAge: 600,
  });
  return response;
}
