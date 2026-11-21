import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Alert, cx, PageHeader } from "@/components/ui";
import type { ClassificationRule } from "@/lib/domain/classification";
import { CodeTable, type CodeRow } from "./code-table";
import { RequiredFieldsMatrix } from "./required-fields";
import { RulesEditor } from "./rules-editor";

export const metadata: Metadata = { title: "Reference Codes" };

const TABS = [
  { key: "categories", label: "Categories" },
  { key: "purposes", label: "Purposes" },
  { key: "required", label: "Required Fields" },
  { key: "rules", label: "Classification Rules" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function ReferenceCodesPage({ searchParams }: PageProps<"/admin/reference">) {
  await requireRole("administrator");
  const { tab: rawTab } = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : "categories";

  const supabase = await createClient();
  const [categories, purposes, requiredFields, rules, usage] = await Promise.all([
    supabase.from("categories").select("code, name, description, is_active").order("code"),
    supabase.from("purposes").select("code, name, description, is_active").order("code"),
    supabase.from("required_field_rules").select("category_code, field_name, is_required"),
    supabase.from("classification_rules").select("id, pattern, match_on, category_code, purpose_code, priority, is_active").order("priority").order("id"),
    supabase.from("documents").select("category_code, purpose_code"),
  ]);
  const loadError = [categories, purposes, requiredFields, rules, usage].find((r) => r.error);

  const categoryRows: CodeRow[] = (categories.data ?? []).map((c) => ({ ...c, code: c.code.trim() }));
  const purposeRows: CodeRow[] = purposes.data ?? [];
  const usedCategories = new Map<string, number>();
  const usedPurposes = new Map<string, number>();
  for (const d of usage.data ?? []) {
    usedCategories.set(d.category_code.trim(), (usedCategories.get(d.category_code.trim()) ?? 0) + 1);
    usedPurposes.set(d.purpose_code, (usedPurposes.get(d.purpose_code) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader
        title="Reference Codes"
        description="Category and purpose codes, required fields per category, and the rules that classify new Shared Drive files automatically. Codes in use are never deleted; deactivate them instead."
      />
      {loadError ? <div className="mb-4"><Alert tone="error">Some reference data could not be loaded. Refresh the page to try again.</Alert></div> : null}

      <nav className="mb-5 flex gap-1 border-b border-stone-200" aria-label="Reference data">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/reference?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cx(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
              tab === t.key ? "border-brand text-brand" : "border-transparent text-stone-600 hover:text-stone-900",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "categories" ? <CodeTable kind="category" rows={categoryRows} usage={Object.fromEntries(usedCategories)} /> : null}
      {tab === "purposes" ? <CodeTable kind="purpose" rows={purposeRows} usage={Object.fromEntries(usedPurposes)} /> : null}
      {tab === "required" ? (
        <RequiredFieldsMatrix
          categories={categoryRows}
          required={(requiredFields.data ?? []).filter((r) => r.is_required).map((r) => ({ category: r.category_code.trim(), field: r.field_name }))}
        />
      ) : null}
      {tab === "rules" ? (
        <RulesEditor
          rules={(rules.data ?? []).map((r) => ({ ...r, category_code: r.category_code.trim() })) as ClassificationRule[]}
          categories={categoryRows}
          purposes={purposeRows}
        />
      ) : null}
    </>
  );
}
