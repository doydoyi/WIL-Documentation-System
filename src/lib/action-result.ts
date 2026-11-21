import type { PostgrestError } from "@supabase/supabase-js";

/** Result returned by Server Actions to forms using useActionState. */
export type ActionResult =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

export const idle: ActionResult = { status: "idle" };

export function fail(message: string, fieldErrors?: Record<string, string>): ActionResult {
  return { status: "error", message, fieldErrors };
}

export function ok(message: string): ActionResult {
  return { status: "success", message };
}

/** Turns database errors into messages that say what to do (NFR-US-03). */
export function describeDbError(error: PostgrestError | null | undefined, fallback: string): string {
  if (!error) return fallback;
  if (error.code === "23505") return "That entry already exists. Use a different value.";
  if (error.code === "23503") return "That entry refers to a code that does not exist.";
  if (error.code === "42501") return "You do not have permission to do this.";
  // Raised by our own database functions with a readable message.
  if (error.code === "P0001") return error.message;
  console.error(fallback, error);
  return fallback;
}

/** Flattens zod issues into a field -> message map. */
export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
