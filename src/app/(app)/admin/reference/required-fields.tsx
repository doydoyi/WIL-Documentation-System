"use client";

import { useActionState } from "react";
import { saveRequiredFields } from "./actions";
import { idle } from "@/lib/action-result";
import { REQUIRED_FIELD_LABELS, REQUIRED_FIELD_OPTIONS } from "@/lib/domain/reference";
import { buttonClass, tableClass } from "@/components/ui";
import type { CodeRow } from "./code-table";

export function RequiredFieldsMatrix({
  categories,
  required,
}: {
  categories: CodeRow[];
  required: { category: string; field: string }[];
}) {
  const isRequired = (category: string, field: string) =>
    required.some((r) => r.category === category && r.field === field);

  return (
    <div>
      <p className="mb-4 text-sm text-stone-600">
        Registered documents missing a required field are marked incomplete and listed for Records Staff.
        Saving re-checks the existing documents of that category.
      </p>
      <div className={tableClass.wrapper}>
        <table className={tableClass.table}>
          <thead>
            <tr>
              <th className={tableClass.th}>Category</th>
              {REQUIRED_FIELD_OPTIONS.map((f) => (
                <th key={f} className={`${tableClass.th} text-center`}>{REQUIRED_FIELD_LABELS[f]}</th>
              ))}
              <th className={tableClass.th}><span className="sr-only">Save</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {categories.map((c) => (
              <CategoryRow key={c.code} category={c} isRequired={(f) => isRequired(c.code, f)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CategoryRow({ category, isRequired }: { category: CodeRow; isRequired: (field: string) => boolean }) {
  const [state, action, pending] = useActionState(saveRequiredFields, idle);
  const formId = `required-${category.code}`;
  return (
    <tr className={tableClass.row}>
      <td className={tableClass.td}>
        <span className="font-mono font-semibold">{category.code}</span> <span className="text-stone-600">{category.name}</span>
        <form id={formId} action={action}>
          <input type="hidden" name="category_code" value={category.code} />
        </form>
      </td>
      {REQUIRED_FIELD_OPTIONS.map((f) => (
        <td key={f} className={`${tableClass.td} text-center`}>
          <input
            form={formId}
            type="checkbox"
            name="fields"
            value={f}
            defaultChecked={isRequired(f)}
            aria-label={`${REQUIRED_FIELD_LABELS[f]} required for ${category.code}`}
            className="h-4 w-4 accent-brand"
          />
        </td>
      ))}
      <td className={`${tableClass.td} whitespace-nowrap text-right`}>
        <button form={formId} type="submit" disabled={pending} className={buttonClass.link}>{pending ? "Saving…" : "Save"}</button>
        {state.status === "error" ? <p role="alert" className="mt-1 text-xs text-red-700">{state.message}</p> : null}
        {state.status === "success" ? <p className="mt-1 text-xs text-green-700">Saved</p> : null}
      </td>
    </tr>
  );
}
