"use client";

import { useActionState } from "react";
import { saveCategory, savePurpose } from "./actions";
import { idle } from "@/lib/action-result";
import { Alert, Badge, buttonClass, inputClass, tableClass } from "@/components/ui";

export interface CodeRow {
  code: string;
  name: string;
  description: string;
  is_active: boolean;
}

type Kind = "category" | "purpose";

const COPY: Record<Kind, { placeholder: string; help: string; noun: string }> = {
  category: { placeholder: "EVT", help: "Three capital letters", noun: "category" },
  purpose: { placeholder: "A0", help: "A, B or C plus one digit", noun: "purpose" },
};

export function CodeTable({ kind, rows, usage }: { kind: Kind; rows: CodeRow[]; usage: Record<string, number> }) {
  return (
    <div className="space-y-6">
      <AddCodeForm kind={kind} />
      <div className={tableClass.wrapper}>
        <table className={tableClass.table}>
          <thead>
            <tr>
              <th className={tableClass.th}>Code</th>
              <th className={tableClass.th}>Name</th>
              <th className={tableClass.th}>Description</th>
              <th className={tableClass.th}>Documents</th>
              <th className={tableClass.th}>Active</th>
              <th className={tableClass.th}><span className="sr-only">Save</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((row) => (
              <CodeRowForm key={row.code} kind={kind} row={row} used={usage[row.code] ?? 0} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CodeRowForm({ kind, row, used }: { kind: Kind; row: CodeRow; used: number }) {
  const [state, action, pending] = useActionState(kind === "category" ? saveCategory : savePurpose, idle);
  const formId = `${kind}-${row.code}`;
  return (
    <tr className={tableClass.row}>
      <td className={`${tableClass.td} font-mono font-semibold`}>
        {row.code}
        <form id={formId} action={action}>
          <input type="hidden" name="mode" value="edit" />
          <input type="hidden" name="code" value={row.code} />
        </form>
      </td>
      <td className={tableClass.td}>
        <input form={formId} name="name" defaultValue={row.name} aria-label={`Name of ${row.code}`} className={inputClass} required />
      </td>
      <td className={tableClass.td}>
        <input form={formId} name="description" defaultValue={row.description} aria-label={`Description of ${row.code}`} className={inputClass} />
      </td>
      <td className={tableClass.td}>{used}</td>
      <td className={tableClass.td}>
        <input
          form={formId}
          type="checkbox"
          name="is_active"
          defaultChecked={row.is_active}
          aria-label={`${row.code} active`}
          className="h-4 w-4 accent-brand"
        />
        {!row.is_active ? <span className="ml-2"><Badge tone="amber">Inactive</Badge></span> : null}
      </td>
      <td className={`${tableClass.td} whitespace-nowrap text-right`}>
        <button form={formId} type="submit" disabled={pending} className={buttonClass.link}>
          {pending ? "Saving…" : "Save"}
        </button>
        {state.status === "error" ? <p role="alert" className="mt-1 max-w-48 text-xs text-red-700">{state.message}</p> : null}
        {state.status === "success" ? <p className="mt-1 text-xs text-green-700">Saved</p> : null}
      </td>
    </tr>
  );
}

function AddCodeForm({ kind }: { kind: Kind }) {
  const [state, action, pending] = useActionState(kind === "category" ? saveCategory : savePurpose, idle);
  const errors = state.status === "error" ? state.fieldErrors ?? {} : {};
  const copy = COPY[kind];
  return (
    <form action={action} className="rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold">Add a {copy.noun} code</h2>
      <input type="hidden" name="mode" value="new" />
      <input type="hidden" name="is_active" value="on" />
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-28">
          <input name="code" placeholder={copy.placeholder} aria-label="Code" required maxLength={3} className={`${inputClass} font-mono uppercase`} aria-invalid={Boolean(errors.code)} />
          <p className={`mt-1 text-xs ${errors.code ? "text-red-700" : "text-stone-500"}`}>{errors.code ?? copy.help}</p>
        </div>
        <div className="min-w-56 flex-1">
          <input name="name" placeholder="Name" aria-label="Name" required className={inputClass} aria-invalid={Boolean(errors.name)} />
          {errors.name ? <p className="mt-1 text-xs text-red-700">{errors.name}</p> : null}
        </div>
        <div className="min-w-56 flex-1">
          <input name="description" placeholder="Description (optional)" aria-label="Description" className={inputClass} />
        </div>
        <button type="submit" disabled={pending} className={buttonClass.primary}>{pending ? "Adding…" : "Add"}</button>
      </div>
      {state.status !== "idle" && !Object.keys(errors).length ? (
        <div className="mt-3"><Alert tone={state.status === "error" ? "error" : "success"}>{state.message}</Alert></div>
      ) : null}
    </form>
  );
}
