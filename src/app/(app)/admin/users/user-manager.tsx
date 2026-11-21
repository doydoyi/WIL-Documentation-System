"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { saveUser } from "./actions";
import { idle } from "@/lib/action-result";
import { ROLE_LABELS, USER_ROLES, type UserRole } from "@/lib/domain/access";
import {
  Alert,
  Badge,
  buttonClass,
  EmptyState,
  formatDateTime,
  inputClass,
  labelClass,
  tableClass,
} from "@/components/ui";

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  last_login_at: string | null;
}

type Editing = { mode: "new" } | { mode: "edit"; user: UserRow } | null;

export function UserManager({
  users,
  currentUserId,
  emailDomain,
}: {
  users: UserRow[];
  currentUserId: string;
  emailDomain: string;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email.includes(q) ||
        u.full_name.toLowerCase().includes(q) ||
        ROLE_LABELS[u.role].toLowerCase().includes(q),
    );
  }, [users, query]);

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-center gap-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, e-mail, or role"
            aria-label="Search users"
            className={`${inputClass} max-w-sm`}
          />
          <button type="button" className={buttonClass.primary} onClick={() => setEditing({ mode: "new" })}>
            Add User
          </button>
        </div>

        {filtered.length === 0 ? (
          <EmptyState>{users.length === 0 ? "No users yet." : "No users match your search."}</EmptyState>
        ) : (
          <div className={tableClass.wrapper}>
            <table className={tableClass.table}>
              <thead>
                <tr>
                  <th className={tableClass.th}>Name</th>
                  <th className={tableClass.th}>E-mail</th>
                  <th className={tableClass.th}>Role</th>
                  <th className={tableClass.th}>Status</th>
                  <th className={tableClass.th}>Last login</th>
                  <th className={tableClass.th}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filtered.map((u) => (
                  <tr key={u.id} className={tableClass.row}>
                    <td className={tableClass.td}>
                      {u.full_name || "—"}
                      {u.id === currentUserId ? <span className="ml-2 text-xs text-stone-500">(you)</span> : null}
                    </td>
                    <td className={tableClass.td}>{u.email}</td>
                    <td className={tableClass.td}>
                      <Badge tone={u.role === "administrator" ? "brand" : u.role === "records_staff" ? "blue" : "neutral"}>
                        {ROLE_LABELS[u.role]}
                      </Badge>
                    </td>
                    <td className={tableClass.td}>
                      <Badge tone={u.is_active ? "green" : "red"}>{u.is_active ? "Active" : "Inactive"}</Badge>
                    </td>
                    <td className={tableClass.td}>{u.last_login_at ? formatDateTime(u.last_login_at) : "Never"}</td>
                    <td className={`${tableClass.td} text-right`}>
                      <button type="button" className={buttonClass.link} onClick={() => setEditing({ mode: "edit", user: u })}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing ? (
        <UserForm
          key={editing.mode === "edit" ? editing.user.id : "new"}
          user={editing.mode === "edit" ? editing.user : null}
          emailDomain={emailDomain}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function UserForm({
  user,
  emailDomain,
  onClose,
}: {
  user: UserRow | null;
  emailDomain: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveUser, idle);
  const errors = state.status === "error" ? state.fieldErrors ?? {} : {};

  useEffect(() => {
    if (state.status === "success" && !user) onClose();
  }, [state, user, onClose]);

  function confirmDeactivation(event: React.FormEvent<HTMLFormElement>) {
    const active = (event.currentTarget.elements.namedItem("is_active") as HTMLInputElement).checked;
    if (user?.is_active && !active) {
      const confirmed = window.confirm(
        `Deactivate ${user.email}? They will lose access immediately and be signed out on their next action.`,
      );
      if (!confirmed) event.preventDefault();
    }
  }

  return (
    <aside className="w-96 shrink-0 self-start rounded-lg border border-stone-200 bg-white p-5 shadow-sm" aria-label="User form">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">{user ? "Edit user" : "Add user"}</h2>
        <button type="button" className={buttonClass.link} onClick={onClose}>Close</button>
      </div>

      <form action={formAction} onSubmit={confirmDeactivation} className="space-y-4">
        {state.status !== "idle" ? (
          <Alert tone={state.status === "error" ? "error" : "success"}>{state.message}</Alert>
        ) : null}
        <input type="hidden" name="id" value={user?.id ?? ""} />

        <div>
          <label htmlFor="email" className={labelClass}>E-mail</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            readOnly={Boolean(user)}
            defaultValue={user?.email ?? ""}
            placeholder={emailDomain ? `name@${emailDomain}` : "name@university.edu"}
            className={`${inputClass} mt-1 read-only:bg-stone-100`}
            aria-invalid={Boolean(errors.email)}
            aria-describedby="email-help"
          />
          <p id="email-help" className={`mt-1 text-xs ${errors.email ? "text-red-700" : "text-stone-500"}`}>
            {errors.email ?? (user ? "The e-mail address cannot be changed." : "The user's university Google account.")}
          </p>
        </div>

        <div>
          <label htmlFor="full_name" className={labelClass}>Full name</label>
          <input
            id="full_name"
            name="full_name"
            required
            defaultValue={user?.full_name ?? ""}
            className={`${inputClass} mt-1`}
            aria-invalid={Boolean(errors.full_name)}
          />
          {errors.full_name ? <p className="mt-1 text-xs text-red-700">{errors.full_name}</p> : null}
        </div>

        <div>
          <label htmlFor="role" className={labelClass}>Role</label>
          <select id="role" name="role" defaultValue={user?.role ?? "viewer"} className={`${inputClass} mt-1`}>
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>{ROLE_LABELS[role]}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">
            Administrators manage the system; Records Staff register and review documents; Viewers search and open documents.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_active" defaultChecked={user?.is_active ?? true} className="h-4 w-4 accent-brand" />
          Active
        </label>

        <div className="flex gap-2 pt-2">
          <button type="submit" disabled={pending} className={buttonClass.primary}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onClose} className={buttonClass.secondary}>Cancel</button>
        </div>
      </form>
    </aside>
  );
}
