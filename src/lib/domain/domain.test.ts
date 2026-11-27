import { describe, expect, it } from "vitest";
import {
  formatDocumentCode,
  isValidCategoryCode,
  isValidPurposeCode,
  parseDocumentCode,
} from "./codes";
import { classifyFile, validateRulePattern, type ClassificationRule } from "./classification";
import { FolderTree, parseDriveId, parseDriveIdList, titleFromFileName } from "./drive";
import { toCsv } from "./csv";
import {
  IDLE_TIMEOUT_MS,
  isAllowedEmail,
  isSessionIdleExpired,
  navItemsFor,
  safeRedirectPath,
} from "./access";

describe("document codes", () => {
  it("formats codes with a zero-padded sequence", () => {
    expect(
      formatDocumentCode({ office: "WIL", category: "EVT", purpose: "A0", year: 2026, sequence: 1 }),
    ).toBe("WIL-EVT-A0-2026-001");
    expect(
      formatDocumentCode({ office: "WIL", category: "FIN", purpose: "C3", year: 2025, sequence: 999 }),
    ).toBe("WIL-FIN-C3-2025-999");
  });

  it("rejects parts outside the office format", () => {
    expect(() =>
      formatDocumentCode({ office: "WIL", category: "EV", purpose: "A0", year: 2026, sequence: 1 }),
    ).toThrow();
    expect(() =>
      formatDocumentCode({ office: "WIL", category: "EVT", purpose: "D1", year: 2026, sequence: 1 }),
    ).toThrow();
    expect(() =>
      formatDocumentCode({ office: "WIL", category: "EVT", purpose: "A0", year: 2026, sequence: 1000 }),
    ).toThrow();
  });

  it("round-trips through parse", () => {
    expect(parseDocumentCode("wil-evt-a0-2026-007")).toEqual({
      office: "WIL",
      category: "EVT",
      purpose: "A0",
      year: 2026,
      sequence: 7,
    });
    expect(parseDocumentCode("WIL-EVT-A0-2026-000")).toBeNull();
    expect(parseDocumentCode("WIL-EVT-A0-26-001")).toBeNull();
  });

  it("validates reference code formats (UC-1.4 E1)", () => {
    expect(isValidCategoryCode("ADM")).toBe(true);
    expect(isValidCategoryCode("AD1")).toBe(false);
    expect(isValidCategoryCode("adm")).toBe(false);
    expect(isValidPurposeCode("B5")).toBe(true);
    expect(isValidPurposeCode("D1")).toBe(false);
    expect(isValidPurposeCode("A10")).toBe(false);
  });
});

describe("classification rules", () => {
  const rules: ClassificationRule[] = [
    { id: 1, pattern: "liquidation", match_on: "file_name", category_code: "FIN", purpose_code: "B2", priority: 50, is_active: true },
    { id: 2, pattern: "^/Events/SpotLab", match_on: "folder_path", category_code: "EVT", purpose_code: "A2", priority: 10, is_active: true },
    { id: 3, pattern: "report", match_on: "file_name", category_code: "EVT", purpose_code: "A4", priority: 100, is_active: true },
    { id: 4, pattern: "report", match_on: "file_name", category_code: "ADM", purpose_code: "A4", priority: 1, is_active: false },
    { id: 5, pattern: "attendance", match_on: "file_name", category_code: "ARC", purpose_code: "C3", priority: 5, is_active: true },
  ];

  it("applies rules in priority order and skips inactive ones", () => {
    expect(classifyFile({ name: "Final Report.docx", folderPath: "/Events/SpotLab/2026" }, rules)).toEqual({
      ruleId: 2,
      categoryCode: "EVT",
      purposeCode: "A2",
    });
    expect(classifyFile({ name: "Final Report.docx", folderPath: "/Admin" }, rules)?.ruleId).toBe(3);
  });

  it("matches case-insensitively", () => {
    expect(classifyFile({ name: "LIQUIDATION March.xlsx", folderPath: "/" }, rules)?.categoryCode).toBe("FIN");
  });

  it("returns null when no rule matches, queuing the file", () => {
    expect(classifyFile({ name: "photo.jpg", folderPath: "/Misc" }, rules)).toBeNull();
  });

  it("skips rules that refer to inactive codes", () => {
    const active = { categories: new Set(["EVT", "FIN", "ADM"]), purposes: new Set(["A2", "A4", "B2"]) };
    // Rule 5 (ARC/C3) would match first but its codes are inactive.
    expect(classifyFile({ name: "Attendance report.pdf", folderPath: "/" }, rules, active)?.ruleId).toBe(3);
  });

  it("validates patterns", () => {
    expect(validateRulePattern("report")).toBeNull();
    expect(validateRulePattern("(unclosed")).toMatch(/not a valid regular expression/);
    expect(validateRulePattern("   ")).toMatch(/Enter a pattern/);
  });
});

describe("drive helpers", () => {
  it("parses Shared Drive IDs and URLs", () => {
    expect(parseDriveId("0ABCdefGhIJkUk9PVA")).toBe("0ABCdefGhIJkUk9PVA");
    expect(parseDriveId("https://drive.google.com/drive/folders/0ABCdefGhIJkUk9PVA?usp=sharing")).toBe(
      "0ABCdefGhIJkUk9PVA",
    );
    expect(parseDriveId("https://drive.google.com/drive/u/1/folders/0ABCdefGhIJkUk9PVA")).toBe(
      "0ABCdefGhIJkUk9PVA",
    );
    expect(parseDriveId("https://evil.example.com/drive/folders/0ABCdefGhIJkUk9PVA")).toBeNull();
    expect(parseDriveId("not an id!")).toBeNull();
  });

  it("parses lists of folder IDs", () => {
    expect(parseDriveIdList("1aaaaaaaaaaa, 1bbbbbbbbbbb\n1aaaaaaaaaaa bad!")).toEqual({
      ids: ["1aaaaaaaaaaa", "1bbbbbbbbbbb"],
      invalid: ["bad!"],
    });
  });

  const tree = new FolderTree("DRIVE", [
    { id: "events", name: "Events", parentId: "DRIVE" },
    { id: "spot", name: "SpotLab", parentId: "events" },
    { id: "sys", name: "_WIL-DMS-system", parentId: "DRIVE" },
    { id: "ocr", name: "ocr-temp", parentId: "sys" },
  ]);

  it("builds folder paths", () => {
    expect(tree.pathOf("spot")).toBe("/Events/SpotLab");
    expect(tree.pathOf("DRIVE")).toBe("/");
    expect(tree.pathOf(null)).toBe("/");
  });

  it("detects files in excluded folders, including sub-folders", () => {
    const excluded = new Set(["sys"]);
    expect(tree.isExcluded("ocr", excluded)).toBe(true);
    expect(tree.isExcluded("spot", excluded)).toBe(false);
    expect(tree.isExcluded("spot", new Set())).toBe(false);
  });

  it("survives cycles in parent links", () => {
    const loop = new FolderTree("D", [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ]);
    expect(loop.pathOf("a")).toBe("/B/A");
  });

  it("derives titles from file names", () => {
    expect(titleFromFileName("Event Report.final.docx")).toBe("Event Report.final");
    expect(titleFromFileName("README")).toBe("README");
  });
});

describe("csv", () => {
  it("escapes quotes, commas, newlines and formula prefixes", () => {
    const csv = toCsv(["a", "b"], [["x,y", 'say "hi"'], ["=SUM(A1)", null], ["line\nbreak", 3]]);
    expect(csv).toBe('﻿a,b\r\n"x,y","say ""hi"""\r\n\'=SUM(A1),\r\n"line\nbreak",3\r\n');
  });
});

describe("access rules", () => {
  it("restricts sign-in to the university domain", () => {
    expect(isAllowedEmail("Jane.Doe@CIT.edu", "cit.edu")).toBe(true);
    expect(isAllowedEmail("jane@gmail.com", "cit.edu")).toBe(false);
    expect(isAllowedEmail("jane@sub.cit.edu", "cit.edu")).toBe(false);
    expect(isAllowedEmail("jane@cit.edu", "")).toBe(false);
    expect(isAllowedEmail(null, "cit.edu")).toBe(false);
  });

  it("expires sessions after 20 idle minutes", () => {
    const now = 1_000_000_000;
    expect(isSessionIdleExpired(now - IDLE_TIMEOUT_MS + 1000, now)).toBe(false);
    expect(isSessionIdleExpired(now - IDLE_TIMEOUT_MS - 1000, now)).toBe(true);
    expect(isSessionIdleExpired(null, now)).toBe(false);
  });

  it("shows admin pages only to Administrators", () => {
    expect(navItemsFor("viewer").map((i) => i.href)).toEqual(["/dashboard"]);
    expect(navItemsFor("records_staff").map((i) => i.href)).toEqual(["/dashboard"]);
    expect(navItemsFor("administrator").length).toBe(5);
  });

  it("only accepts same-site redirect paths", () => {
    expect(safeRedirectPath("/admin/users")).toBe("/admin/users");
    expect(safeRedirectPath("//evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("https://evil.com")).toBe("/dashboard");
    expect(safeRedirectPath(null)).toBe("/dashboard");
    expect(safeRedirectPath("/\t/evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("/\n/evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("/a\\b")).toBe("/dashboard");
  });
});
