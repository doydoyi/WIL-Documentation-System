import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authorize, AuthorizationError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit";
import { exchangeAuthorizationCode, OAUTH_STATE_COOKIE, storeRefreshToken } from "@/lib/google/oauth";

function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Completes the Google authorization and stores the refresh token (UC-1.5 step 2). */
export async function GET(request: NextRequest) {
  const back = (params: Record<string, string>) => {
    const url = new URL("/admin/drive", request.url);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const response = NextResponse.redirect(url);
    response.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/google" });
    return response;
  };

  let user;
  try {
    user = await authorize("administrator");
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.redirect(new URL("/dashboard?error=forbidden", request.url));
    throw error;
  }

  const { searchParams } = request.nextUrl;
  if (searchParams.get("error")) return back({ google: "cancelled" });
  if (!sameState(request.cookies.get(OAUTH_STATE_COOKIE)?.value, searchParams.get("state"))) {
    return back({ google: "state" });
  }
  const code = searchParams.get("code");
  if (!code) return back({ google: "failed" });

  try {
    const result = await exchangeAuthorizationCode(code);
    if (result.missingScopes.length) return back({ google: "scopes" });
    if (!result.refreshToken) return back({ google: "no_refresh" });
    await storeRefreshToken(result.refreshToken);

    const supabase = await createClient();
    const { data: config } = await supabase.from("drive_config").select("status").eq("id", 1).single();
    await supabase
      .from("drive_config")
      .update({
        connected_account_email: result.email,
        status: config?.status === "not_connected" || config?.status === "error" ? "account_connected" : config?.status,
      })
      .eq("id", 1);

    await recordAuditEvent({
      actorId: user.id,
      action: "drive_account_connected",
      entityType: "drive_config",
      entityId: "1",
      newValues: { connected_account_email: result.email },
    });
    return back({ google: "connected" });
  } catch (error) {
    console.error("Google authorization failed", error);
    return back({ google: "failed" });
  }
}
