import { requireUser } from "@/lib/auth";
import { navItemsFor, ROLE_LABELS } from "@/lib/domain/access";
import { NavLinks } from "@/components/nav-links";
import { IdleTimer } from "@/components/idle-timer";

/** Shell for every signed-in page: role-filtered navigation and session info. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const items = navItemsFor(user.role).map(({ href, label }) => ({ href, label }));

  return (
    <div className="flex min-h-screen flex-1">
      <IdleTimer />
      <aside className="flex w-60 shrink-0 flex-col bg-brand text-white">
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
          <span aria-hidden className="rounded bg-accent px-1.5 py-0.5 text-xs font-bold text-brand-strong">WIL</span>
          <span className="text-sm font-semibold leading-tight">Document Management</span>
        </div>
        <NavLinks items={items} />
        <div className="mt-auto border-t border-white/10 px-5 py-4 text-sm">
          <p className="truncate font-medium" title={user.email}>{user.fullName}</p>
          <p className="text-xs text-white/70">{ROLE_LABELS[user.role]}</p>
          <form action="/auth/signout" method="post" className="mt-3">
            <button type="submit" className="text-xs font-medium text-white/80 underline-offset-2 hover:text-white hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
