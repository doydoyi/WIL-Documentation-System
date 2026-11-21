/**
 * CSV serialisation for exports (UC-1.3 A1, UC-3.1 A2).
 *
 * Values are quoted when needed, and cells that a spreadsheet would treat as
 * a formula (=, +, -, @, tab, carriage return) are prefixed with an
 * apostrophe to prevent CSV injection.
 */

export type CsvValue = string | number | boolean | null | undefined | Date | object;

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);

  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(cell).join(",")];
  for (const row of rows) lines.push(row.map(cell).join(","));
  // UTF-8 BOM so Excel opens accented names correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}
