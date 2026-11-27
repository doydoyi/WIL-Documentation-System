import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/domain/access";

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

/**
 * The signed-in user with an active profile, or null. Deduplicated per
 * request. The JWT is verified with getClaims(); the profile is read under
 * RLS, so a deactivated profile immediately loses access (UC-1.2 A1).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", userId)
    .maybeSingle();

  // A failed query is an outage, not a missing profile: do not sign the user out.
  if (profileError) {
    console.error("Could not read the user profile", profileError);
    throw new Error("Your profile could not be loaded. Try again.");
  }
  if (!profile || !profile.is_active) return null;
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name || profile.email,
    role: profile.role as UserRole,
  };
});

/** For pages and layouts: redirects to the sign-in page when needed. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/signout?reason=inactive");
  return user;
}

/** For pages: users without the role see the dashboard instead. */
export async function requireRole(...roles: UserRole[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/dashboard?error=forbidden");
  return user;
}

export class AuthorizationError extends Error {}

/**
 * For Server Actions and Route Handlers, which are reachable by direct POST
 * and must check access themselves.
 */
export async function authorize(...roles: UserRole[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError("Your session has ended. Sign in again.");
  if (!roles.includes(user.role)) {
    throw new AuthorizationError("You do not have permission to do this.");
  }
  return user;
}
