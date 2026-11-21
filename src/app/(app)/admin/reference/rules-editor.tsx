"use client";

import { useActionState, useMemo, useState } from "react";
import { deleteRule, saveRule } from "./actions";
import { idle } from "@/lib/action-result";
import { classifyFile, orderRules, type ClassificationRule } from "@/lib/domain/classification";
import { MATCH_TARGET_LABELS } from "@/lib/domain/reference";
import { Alert, Badge, buttonClass, EmptyState, inputClass, labelClass, tableClass } from "@/components/ui";
import type { CodeRow } from "./code-table";

export function RulesEditor({
  rules,
  categories,
  purposes,
}: {
  rules: ClassificationRule[];
  categories: CodeRow[];
  purposes: CodeRow[];
}) {
  const [editing, setEditing] = useState<ClassificationRule | "new" | null>(null);
  const ordered = useMemo(() => orderRules(rules), [rules]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-stone-600">
          Rules are applied to each new file in priority order (lowest number first). The first matching rule gives the
          category and purpose; files no rule matches wait for Records Staff. Patterns are case-insensitive regular
          expressions, so <code className="rounded bg-stone-100 px-1">liquidation</code> matches any name containing that
          word and <code className="rounded bg-stone-100 px-1">^/Events/SpotLab</code> matches a folder and its sub-folders.
        </p>
        <button type="button" className={buttonClass.primary} onClick={() => setEditing("new")}>Add Rule</button>
      </div>

      {editing ? (
        <RuleForm
          key={editing === "new" ? "new" : editing.id}
          rule={editing === "new" ? null : editing}
          categories={categories}
          purposes={purposes}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {ordered.length === 0 ? (
        <EmptyState>No classification rules yet. Until rules are added, every new file waits for manual classification.</EmptyState>
      ) : (
        <div className={tableClass.wrapper}>
          <table className={tableClass.table}>
            <thead>
              <tr>
                <th className={tableClass.th}>Priority</th>
                <th className={tableClass.th}>Pattern</th>
                <th className={tableClass.th}>Matches on</th>
                <th className={tableClass.th}>Category</th>
                <th className={tableClass.th}>Purpose</th>
                <th className={tableClass.th}>Status</th>
                <th className={tableClass.th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {ordered.map((rule) => (
                <tr key={rule.id} className={tableClass.row}>
                  <td className={tableClass.td}>{rule.priority}</td>
                  <td className={`${tableClass.td} font-mono text-xs`}>{rule.pattern}</td>
                  <td className={tableClass.td}>{MATCH_TARGET_LABELS[rule.match_on]}</td>
                  <td className={`${tableClass.td} font-mono`}>{rule.category_code}</td>
                  <td className={`${tableClass.td} font-mono`}>{rule.purpose_code}</td>
                  <td className={tableClass.td}><Badge tone={rule.is_active ? "green" : "neutral"}>{rule.is_active ? "Active" : "Inactive"}</Badge></td>
                  <td className={`${tableClass.td} whitespace-nowrap text-right`}>
                    <button type="button" className={buttonClass.link} onClick={() => setEditing(rule)}>Edit</button>
                    <DeleteRuleButton id={rule.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RuleTester rules={rules} categories={categories} purposes={purposes} />
    </div>
  );
}

function RuleForm({
  rule,
  categories,
  purposes,
  onClose,
}: {
  rule: ClassificationRule | null;
  categories: CodeRow[];
  purposes: CodeRow[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(saveRule, idle);
  const errors = state.status === "error" ? state.fieldErrors ?? {} : {};
  const fieldError = (name: string) =>
    errors[name] ? <p className="mt-1 text-xs text-red-700">{errors[name]}</p> : null;

  return (
    <form action={action} className="rounded-lg border border-stone-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">{rule ? "Edit rule" : "Add rule"}</h2>
        <button type="button" className={buttonClass.link} onClick={onClose}>Close</button>
      </div>
      {state.status !== "idle" ? (
        <div className="mb-4"><Alert tone={state.status === "error" ? "error" : "success"}>{state.message}</Alert></div>
      ) : null}
      <input type="hidden" name="id" value={rule?.id ?? ""} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
        <div className="md:col-span-3">
          <label htmlFor="pattern" className={labelClass}>Pattern</label>
          <input id="pattern" name="pattern" required defaultValue={rule?.pattern ?? ""} className={`${inputClass} mt-1 font-mono`} aria-invalid={Boolean(errors.pattern)} />
          {fieldError("pattern")}
        </div>
        <div>
          <label htmlFor="match_on" className={labelClass}>Match on</label>
          <select id="match_on" name="match_on" defaultValue={rule?.match_on ?? "file_name"} className={`${inputClass} mt-1`}>
            {Object.entries(MATCH_TARGET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="priority" className={labelClass}>Priority</label>
          <input id="priority" name="priority" type="number" min={0} max={10000} required defaultValue={rule?.priority ?? 100} className={`${inputClass} mt-1`} />
          {fieldError("priority")}
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_active" defaultChecked={rule?.is_active ?? true} className="h-4 w-4 accent-brand" /> Active
          </label>
        </div>
        <div className="md:col-span-3">
          <label htmlFor="category_code" className={labelClass}>Category</label>
          <select id="category_code" name="category_code" required defaultValue={rule?.category_code ?? ""} className={`${inputClass} mt-1`}>
            <option value="" disabled>Choose a category</option>
            {categories.map((c) => (
              <option key={c.code} value={c.code}>{c.code} – {c.name}{c.is_active ? "" : " (inactive)"}</option>
            ))}
          </select>
          {fieldError("category_code")}
        </div>
        <div className="md:col-span-3">
          <label htmlFor="purpose_code" className={labelClass}>Purpose</label>
          <select id="purpose_code" name="purpose_code" required defaultValue={rule?.purpose_code ?? ""} className={`${inputClass} mt-1`}>
            <option value="" disabled>Choose a purpose</option>
            {purposes.map((p) => (
              <option key={p.code} value={p.code}>{p.code} – {p.name}{p.is_active ? "" : " (inactive)"}</option>
            ))}
          </select>
          {fieldError("purpose_code")}
        </div>
      </div>
      <div className="mt-5 flex gap-2">
        <button type="submit" disabled={pending} className={buttonClass.primary}>{pending ? "Saving…" : "Save rule"}</button>
        <button type="button" onClick={onClose} className={buttonClass.secondary}>Cancel</button>
      </div>
    </form>
  );
}

function DeleteRuleButton({ id }: { id: number }) {
  const [state, action, pending] = useActionState(deleteRule, idle);
  return (
    <form
      action={action}
      className="ml-3 inline"
      onSubmit={(e) => {
        if (!window.confirm("Delete this rule? Documents already coded keep their codes.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="text-sm font-medium text-red-700 hover:underline">Delete</button>
      {state.status === "error" ? <span role="alert" className="ml-2 text-xs text-red-700">{state.message}</span> : null}
    </form>
  );
}

/** Lets the Administrator check which rule a file would match before a scan. */
function RuleTester({ rules, categories, purposes }: { rules: ClassificationRule[]; categories: CodeRow[]; purposes: CodeRow[] }) {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("/");
  const active = useMemo(
    () => ({
      categories: new Set(categories.filter((c) => c.is_active).map((c) => c.code)),
      purposes: new Set(purposes.filter((p) => p.is_active).map((p) => p.code)),
    }),
    [categories, purposes],
  );
  const result = name ? classifyFile({ name, folderPath: folder || "/" }, rules, active) : null;

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold">Try the rules</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="try-name" className={labelClass}>File name</label>
          <input id="try-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="SpotLab Demo Day Report.docx" className={`${inputClass} mt-1`} />
        </div>
        <div>
          <label htmlFor="try-folder" className={labelClass}>Folder path</label>
          <input id="try-folder" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/Events/SpotLab" className={`${inputClass} mt-1`} />
        </div>
      </div>
      {name ? (
        <p className="mt-3 text-sm" aria-live="polite">
          {result ? (
            <>Matches rule #{result.ruleId}: the file would be coded <span className="font-mono font-semibold">WIL-{result.categoryCode}-{result.purposeCode}-YYYY-NNN</span> (provisional).</>
          ) : (
            <>No active rule matches. The file would wait under <strong>Needs Classification</strong>.</>
          )}
        </p>
      ) : null}
    </section>
  );
}
