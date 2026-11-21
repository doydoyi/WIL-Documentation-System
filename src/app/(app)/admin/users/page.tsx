import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Alert } from "@/components/ui";
import type { UserRole } from "@/lib/domain/access";
import { UserManager, type UserRow } from "./user-manager";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const currentUser = await requireRole("administrator");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, last_login_at, created_at")
    .order("full_name");

  const users: UserRow[] = (data ?? []).map((u) => ({ ...u, role: u.role as UserRole }));

  return (
    <>
      <PageHeader
        title="User Management"
        description="Add office personnel, assign their role, and activate or deactivate accounts. Users sign in with their university Google account."
      />
      {error ? <Alert tone="error">Users could not be loaded. Refresh the page to try again.</Alert> : null}
      <UserManager
        users={users}
        currentUserId={currentUser.id}
        emailDomain={process.env.ALLOWED_EMAIL_DOMAIN ?? ""}
      />
    </>
  );
}
