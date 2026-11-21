import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAuditEvent } from "@/lib/audit";
import { env } from "@/lib/env";
import { isAllowedEmail, LAST_ACTIVITY_COOKIE, safeRedirectPath } from "@/lib/domain/access";

/**
 * Google sign-in callback (UC-1.1 steps 4–7).
 * Exchanges the code for a session, then admits only university accounts
 * with an active profile. Every outcome is written to the audit log
 * (FR-1.1.4).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));

  const toLogin = (error?: string) => {
    const url = new URL("/login", request.url);
    if (error) url.searchParams.set("error", error);
    return NextResponse.redirect(url);
  };

  // A1: the user cancelled on Google's screen.
  if (!code) return toLogin(searchParams.get("error") ? undefined : "callback");

  const supabase = await createClient();
  const { data: exchange, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError || !exchange.user) return toLogin("callback");

  const authUser = exchange.user;
  const email = (authUser.email ?? "").toLowerCase();
  const admin = createAdminClient();

  const deny = async (reason: "domain" | "unregistered" | "inactive", actorId: string | null) => {
    await recordAuditEvent({
      actorId,
      action: "sign_in_failed",
      entityType: "auth",
      entityId: email || authUser.id,
      newValues: { email, reason },
    });
    await supabase.auth.signOut();
    // Remove auth accounts that Google sign-in created for unknown users.
    if (!actorId) await admin.auth.admin.deleteUser(authUser.id).catch(() => undefined);
    return toLogin(reason);
  };

  // E1: the account is outside the university domain.
  if (!isAllowedEmail(email, env.allowedEmailDomain)) {
    const { data: existing } = await admin.from("profiles").select("id").eq("id", authUser.id).maybeSingle();
    return deny("domain", existing?.id ?? null);
  }

  let { data: profile } = await admin
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", authUser.id)
    .maybeSingle();

  // First run: create the configured bootstrap Administrator when no
  // Administrator exists yet.
  if (!profile && env.bootstrapAdminEmail === email) {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "administrator");
    if (count === 0) {
      const fullName = (authUser.user_metadata?.full_name as string | undefined) ?? "";
      const { data: created } = await admin
        .from("profiles")
        .insert({ id: authUser.id, email, full_name: fullName, role: "administrator" })
        .select("id, role, is_active")
        .single();
      profile = created;
    }
  }

  // E2: no profile, or the profile is inactive.
  if (!profile) return deny("unregistered", null);
  if (!profile.is_active) return deny("inactive", profile.id);

  await admin.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", profile.id);
  await recordAuditEvent({
    actorId: profile.id,
    action: "sign_in",
    entityType: "auth",
    entityId: profile.id,
    newValues: { email },
  });

  const response = NextResponse.redirect(new URL(next, request.url));
  response.cookies.set(LAST_ACTIVITY_COOKIE, String(Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return response;
}
