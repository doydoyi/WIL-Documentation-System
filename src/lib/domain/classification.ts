/**
 * Rule-based classification of Shared Drive files (SRS FR-2.2.2).
 *
 * Each rule holds a case-insensitive regular expression that is tested
 * against the file name, the folder path, or extracted OCR text. Active rules
 * are applied in priority order (lowest number first, then oldest rule); the
 * first match gives the category and purpose. No match means the file waits
 * in the Needs Classification queue.
 */

export type MatchTarget = "file_name" | "folder_path" | "extracted_text";

export interface ClassificationRule {
  id: number;
  pattern: string;
  match_on: MatchTarget;
  category_code: string;
  purpose_code: string;
  priority: number;
  is_active: boolean;
}

export interface ClassifiableFile {
  name: string;
  folderPath: string;
  extractedText?: string | null;
}

export interface ClassificationResult {
  ruleId: number;
  categoryCode: string;
  purposeCode: string;
}

export interface ActiveCodes {
  categories: ReadonlySet<string>;
  purposes: ReadonlySet<string>;
}

const MAX_PATTERN_LENGTH = 500;

/** Returns an error message if the pattern cannot be used, otherwise null. */
export function validateRulePattern(pattern: string): string | null {
  if (pattern.trim().length === 0) return "Enter a pattern.";
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `Patterns can be at most ${MAX_PATTERN_LENGTH} characters long.`;
  }
  try {
    new RegExp(pattern, "i");
    return null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid expression";
    return `The pattern is not a valid regular expression (${detail}). Escape special characters such as . ( ) [ ] with a backslash.`;
  }
}

/** Sorts rules into the order in which they are applied. */
export function orderRules<T extends Pick<ClassificationRule, "id" | "priority">>(rules: T[]): T[] {
  return [...rules].sort((a, b) => a.priority - b.priority || a.id - b.id);
}

/**
 * Compiles the usable rules once, for classifying many files (initial scan).
 * Inactive rules, rules that refer to inactive codes, and rules whose pattern
 * no longer compiles are skipped.
 */
export function compileRules(rules: ClassificationRule[], activeCodes?: ActiveCodes) {
  return orderRules(rules)
    .filter((rule) => rule.is_active)
    .filter(
      (rule) =>
        !activeCodes ||
        (activeCodes.categories.has(rule.category_code) && activeCodes.purposes.has(rule.purpose_code)),
    )
    .flatMap((rule) => {
      try {
        return [{ rule, regex: new RegExp(rule.pattern, "i") }];
      } catch {
        return [];
      }
    });
}

export type CompiledRules = ReturnType<typeof compileRules>;

export function classifyWithCompiled(
  file: ClassifiableFile,
  compiled: CompiledRules,
): ClassificationResult | null {
  for (const { rule, regex } of compiled) {
    const subject =
      rule.match_on === "file_name"
        ? file.name
        : rule.match_on === "folder_path"
          ? file.folderPath
          : (file.extractedText ?? "");
    if (subject && regex.test(subject)) {
      return { ruleId: rule.id, categoryCode: rule.category_code, purposeCode: rule.purpose_code };
    }
  }
  return null;
}

export function classifyFile(
  file: ClassifiableFile,
  rules: ClassificationRule[],
  activeCodes?: ActiveCodes,
): ClassificationResult | null {
  return classifyWithCompiled(file, compileRules(rules, activeCodes));
}
