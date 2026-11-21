/**
 * Office document codes: [OFFICE]-[CATEGORY]-[PURPOSE]-[YEAR]-[SEQ]
 * e.g. WIL-EVT-A0-2026-001 (SRS FR-2.2.3).
 *
 * Codes are generated atomically in the database (generate_document_code);
 * these helpers validate and format them in the application.
 */

export const OFFICE_CODE = "WIL";

/** Category: three uppercase letters (UC-1.4 E1). */
export const CATEGORY_CODE_PATTERN = /^[A-Z]{3}$/;
/** Purpose: A, B or C followed by one digit (UC-1.4 E1). */
export const PURPOSE_CODE_PATTERN = /^[ABC][0-9]$/;
export const DOCUMENT_CODE_PATTERN =
  /^([A-Z]{2,4})-([A-Z]{3})-([ABC][0-9])-([0-9]{4})-([0-9]{3})$/;

export const MAX_SEQUENCE = 999;

export interface DocumentCodeParts {
  office: string;
  category: string;
  purpose: string;
  year: number;
  sequence: number;
}

export function isValidCategoryCode(code: string): boolean {
  return CATEGORY_CODE_PATTERN.test(code);
}

export function isValidPurposeCode(code: string): boolean {
  return PURPOSE_CODE_PATTERN.test(code);
}

export function formatDocumentCode(parts: DocumentCodeParts): string {
  const { office, category, purpose, year, sequence } = parts;
  if (!/^[A-Z]{2,4}$/.test(office)) throw new Error(`Invalid office code: ${office}`);
  if (!isValidCategoryCode(category)) throw new Error(`Invalid category code: ${category}`);
  if (!isValidPurposeCode(purpose)) throw new Error(`Invalid purpose code: ${purpose}`);
  if (!Number.isInteger(year) || year < 1990 || year > 2999) throw new Error(`Invalid year: ${year}`);
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) {
    throw new Error(`Invalid sequence number: ${sequence}`);
  }
  return [office, category, purpose, String(year), String(sequence).padStart(3, "0")].join("-");
}

export function parseDocumentCode(code: string): DocumentCodeParts | null {
  const match = DOCUMENT_CODE_PATTERN.exec(code.trim().toUpperCase());
  if (!match) return null;
  const [, office, category, purpose, year, sequence] = match;
  const seq = Number(sequence);
  if (seq < 1) return null;
  return { office, category, purpose, year: Number(year), sequence: seq };
}
