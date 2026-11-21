"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, AuthorizationError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { isAllowedEmail, USER_ROLES, type UserRole } from "@/lib/domain/access";
import { describeDbError, fail, ok, zodFieldErrors, type ActionResult } from "@/lib/action-result";

const userSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  email: z.string().trim().toLowerCase().email("Enter a valid e-mail address."),
  full_name: z.string().trim().min(1, "Enter the user's full name.").max(200),
  role: z.enum(USER_ROLES as [UserRole, ...UserRole[]], { message: "Choose a role." }),
  is_active: z.boolean(),
});

/**
 * Creates or updates a user profile (UC-1.2, FR-1.2.1 – FR-1.2.4).
 * The profile write runs with the Administrator's own session so RLS checks
 * the role and the audit trigger records who made the change.
 */
export async function saveUser(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    await authorize("administrator");
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    throw error;
  }

  const parsed = userSchema.safeParse({
    id: formData.get("id") ?? undefined,
    email: formData.get("email"),
    full_name: formData.get("full_name"),
    role: formData.get("role"),
    is_active: formData.get("is_active") === "on",
  });
  if (!parsed.success) {
    return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  }
  const input = parsed.data;

  // E1: university domain only.
  if (!isAllowedEmail(input.email, env.allowedEmailDomain)) {
    return fail("Use a university e-mail address.", {
      email: `The address must end with @${env.allowedEmailDomain}.`,
    });
  }

  const supabase = await createClient();

  if (input.id) {
    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ full_name: input.full_name, role: input.role, is_active: input.is_active })
      .eq("id", input.id)
      .select("id");
    if (error) return fail(describeDbError(error, "The user could not be saved. Try again."));
    if (!updated?.length) return fail("This user no longer exists. Refresh the page.");
    revalidatePath("/admin/users");
    return ok(`Saved ${input.email}.`);
  }

  // New user: reject duplicates before creating anything (E1).
  const { data: existing } = await supabase.from("profiles").select("id").eq("email", input.email).maybeSingle();
  if (existing) {
    return fail("This user already exists.", { email: "A profile with this e-mail address already exists." });
  }

  // Pre-create the auth account so the user's first Google sign-in links to it.
  const admin = createAdminClient();
  let authUserId: string | null = null;
  let createdAuthUser = false;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (created?.user) {
    authUserId = created.user.id;
    createdAuthUser = true;
  } else if (createError && /already|exists/i.test(createError.message)) {
    authUserId = await findAuthUserIdByEmail(input.email);
  }
  if (!authUserId) {
    return fail("The account could not be created. Try again, or contact the system maintainer.");
  }

  const { error: insertError } = await supabase.from("profiles").insert({
    id: authUserId,
    email: input.email,
    full_name: input.full_name,
    role: input.role,
    is_active: input.is_active,
  });
  if (insertError) {
    if (createdAuthUser) await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
    return fail(describeDbError(insertError, "The user could not be saved. Try again."));
  }

  revalidatePath("/admin/users");
  return ok(`Added ${input.email}. They can now sign in with Google.`);
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) return null;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}
