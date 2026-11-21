"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, AuthorizationError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_CODE_PATTERN, PURPOSE_CODE_PATTERN } from "@/lib/domain/codes";
import { validateRulePattern } from "@/lib/domain/classification";
import { REQUIRED_FIELD_OPTIONS } from "@/lib/domain/reference";
import { describeDbError, fail, ok, zodFieldErrors, type ActionResult } from "@/lib/action-result";

/**
 * Reference data administration (UC-1.4). Writes run with the
 * Administrator's session: RLS checks the role and the audit trigger records
 * each change. Codes are never deleted (FR-1.4.2); they are deactivated.
 */

const PATH = "/admin/reference";

async function guard(): Promise<ActionResult | null> {
  try {
    await authorize("administrator");
    return null;
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    throw error;
  }
}

const text = (max: number, message: string) => z.string().trim().min(1, message).max(max);

function codeSchema(kind: "category" | "purpose") {
  const pattern = kind === "category" ? CATEGORY_CODE_PATTERN : PURPOSE_CODE_PATTERN;
  const formatHelp =
    kind === "category"
      ? "Category codes are three capital letters, e.g. EVT."
      : "Purpose codes are A, B, or C followed by one digit, e.g. B2.";
  return z.object({
    mode: z.enum(["new", "edit"]),
    code: z.string().trim().toUpperCase().regex(pattern, formatHelp),
    name: text(200, "Enter a name."),
    description: z.string().trim().max(1000).default(""),
    is_active: z.boolean(),
  });
}

async function saveCode(kind: "category" | "purpose", formData: FormData): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;

  const parsed = codeSchema(kind).safeParse({
    mode: formData.get("mode"),
    code: formData.get("code"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    is_active: formData.get("is_active") === "on",
  });
  if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));

  const { mode, code, name, description, is_active } = parsed.data;
  const table = kind === "category" ? "categories" : "purposes";
  const supabase = await createClient();

  if (mode === "new") {
    const { error } = await supabase.from(table).insert({ code, name, description, is_active });
    if (error?.code === "23505") {
      return fail(`The code ${code} is already used.`, { code: "Choose a code that is not already in the list." });
    }
    if (error) return fail(describeDbError(error, "The code could not be saved. Try again."));
  } else {
    const { data, error } = await supabase.from(table).update({ name, description, is_active }).eq("code", code).select("code");
    if (error) return fail(describeDbError(error, "The code could not be saved. Try again."));
    if (!data?.length) return fail(`The code ${code} no longer exists. Refresh the page.`);
  }

  revalidatePath(PATH);
  return ok(mode === "new" ? `Added ${code}.` : `Saved ${code}.`);
}

export async function saveCategory(_prev: ActionResult, formData: FormData) {
  return saveCode("category", formData);
}

export async function savePurpose(_prev: ActionResult, formData: FormData) {
  return saveCode("purpose", formData);
}

/** Sets the required fields of one category (FR-1.4.3, FR-2.4.2). */
export async function saveRequiredFields(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;

  const category = String(formData.get("category_code") ?? "").toUpperCase();
  if (!CATEGORY_CODE_PATTERN.test(category)) return fail("Choose a valid category.");
  const selected = new Set(
    formData.getAll("fields").map(String).filter((f) => (REQUIRED_FIELD_OPTIONS as readonly string[]).includes(f)),
  );

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("required_field_rules")
    .select("id, field_name, is_required")
    .eq("category_code", category);
  if (readError) return fail(describeDbError(readError, "The required fields could not be saved. Try again."));

  const toDelete = (existing ?? []).filter((r) => !selected.has(r.field_name)).map((r) => r.id);
  const known = new Set((existing ?? []).map((r) => r.field_name));
  const toInsert = [...selected].filter((f) => !known.has(f)).map((field_name) => ({ category_code: category, field_name }));
  const toEnable = (existing ?? []).filter((r) => selected.has(r.field_name) && !r.is_required).map((r) => r.id);

  if (toDelete.length) {
    const { error } = await supabase.from("required_field_rules").delete().in("id", toDelete);
    if (error) return fail(describeDbError(error, "The required fields could not be saved. Try again."));
  }
  if (toInsert.length) {
    const { error } = await supabase.from("required_field_rules").insert(toInsert);
    if (error) return fail(describeDbError(error, "The required fields could not be saved. Try again."));
  }
  if (toEnable.length) {
    const { error } = await supabase.from("required_field_rules").update({ is_required: true }).in("id", toEnable);
    if (error) return fail(describeDbError(error, "The required fields could not be saved. Try again."));
  }

  revalidatePath(PATH);
  return ok(`Saved required fields for ${category}. Existing records were re-checked.`);
}

const ruleSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  pattern: z.string().max(500),
  match_on: z.enum(["file_name", "folder_path", "extracted_text"], { message: "Choose what the pattern matches." }),
  category_code: z.string().trim().toUpperCase().regex(CATEGORY_CODE_PATTERN, "Choose a category."),
  purpose_code: z.string().trim().toUpperCase().regex(PURPOSE_CODE_PATTERN, "Choose a purpose."),
  priority: z.coerce.number({ message: "Enter a whole number." }).int("Enter a whole number.").min(0, "Use 0 to 10000.").max(10000, "Use 0 to 10000."),
  is_active: z.boolean(),
});

/** Creates or updates a classification rule (UC-1.4 step 3, E2). */
export async function saveRule(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;

  const rawId = formData.get("id");
  const parsed = ruleSchema.safeParse({
    id: rawId ? rawId : undefined,
    pattern: formData.get("pattern") ?? "",
    match_on: formData.get("match_on"),
    category_code: formData.get("category_code"),
    purpose_code: formData.get("purpose_code"),
    priority: formData.get("priority"),
    is_active: formData.get("is_active") === "on",
  });
  if (!parsed.success) return fail("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const { id, ...rule } = parsed.data;

  const patternError = validateRulePattern(rule.pattern);
  if (patternError) return fail("Check the pattern.", { pattern: patternError });

  const supabase = await createClient();

  // E2: a rule may only refer to active codes.
  if (rule.is_active) {
    const [{ data: category }, { data: purpose }] = await Promise.all([
      supabase.from("categories").select("is_active").eq("code", rule.category_code).maybeSingle(),
      supabase.from("purposes").select("is_active").eq("code", rule.purpose_code).maybeSingle(),
    ]);
    if (!category?.is_active) {
      return fail(`Category ${rule.category_code} is inactive. Activate it first or choose another category.`, {
        category_code: "This category is inactive.",
      });
    }
    if (!purpose?.is_active) {
      return fail(`Purpose ${rule.purpose_code} is inactive. Activate it first or choose another purpose.`, {
        purpose_code: "This purpose is inactive.",
      });
    }
  }

  if (id) {
    const { data, error } = await supabase.from("classification_rules").update(rule).eq("id", id).select("id");
    if (error) return fail(describeDbError(error, "The rule could not be saved. Try again."));
    if (!data?.length) return fail("This rule no longer exists. Refresh the page.");
  } else {
    const { error } = await supabase.from("classification_rules").insert(rule);
    if (error) return fail(describeDbError(error, "The rule could not be saved. Try again."));
  }

  revalidatePath(PATH);
  return ok(id ? "Rule saved." : "Rule added.");
}

export async function deleteRule(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return fail("Choose a rule to delete.");

  const supabase = await createClient();
  const { error } = await supabase.from("classification_rules").delete().eq("id", id);
  if (error) return fail(describeDbError(error, "The rule could not be deleted. Try again."));
  revalidatePath(PATH);
  return ok("Rule deleted.");
}
