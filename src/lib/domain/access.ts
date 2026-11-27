/**
 * Access rules shared by the proxy, layouts and Server Actions.
 * Row Level Security enforces the same rules in the database (NFR-SE-02);
 * these checks give users clear messages and keep pages they cannot use
 * out of the navigation.
 */

export type UserRole = "administrator" | "records_staff" | "viewer";

export const ROLE_LABELS: Record<UserRole, string> = {
  administrator: "Administrator",
  records_staff: "Records Staff",
  viewer: "Viewer",
};

export const USER_ROLES: UserRole[] = ["administrator", "records_staff", "viewer"];

/** Sessions end after 20 minutes without activity (FR-1.1.3, NFR-SE-08). */
export const IDLE_TIMEOUT_MS = 20 * 60 * 1000;
export const LAST_ACTIVITY_COOKIE = "wil_last_activity";

export function isSessionIdleExpired(lastActivity: number | null, now: number): boolean {
  if (lastActivity === null || !Number.isFinite(lastActivity)) return false;
  return now - lastActivity > IDLE_TIMEOUT_MS;
}

/**
 * Only accounts in the university's Google Workspace domain may sign in
 * (FR-1.1.1). The domain comes from ALLOWED_EMAIL_DOMAIN.
 */
export function isAllowedEmail(email: string | null | undefined, allowedDomain: string): boolean {
  if (!email) return false;
  const domain = allowedDomain.trim().toLowerCase().replace(/^@/, "");
  if (!domain) return false;
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  return at > 0 && normalized.slice(at + 1) === domain;
}

export interface NavItem {
  href: string;
  label: string;
  roles: UserRole[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["administrator", "records_staff", "viewer"] },
  { href: "/admin/users", label: "Users", roles: ["administrator"] },
  { href: "/admin/reference", label: "Reference Codes", roles: ["administrator"] },
  { href: "/admin/drive", label: "Drive Settings", roles: ["administrator"] },
  { href: "/admin/audit", label: "Audit Logs", roles: ["administrator"] },
];

export function navItemsFor(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/** Only same-site relative paths are accepted as post-login destinations. */
export function safeRedirectPath(value: string | null | undefined, fallback = "/dashboard"): string {
  // URL parsers drop tabs and newlines and treat "\" as "/", so "/\t/evil.com" would become "//evil.com".
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return fallback;
  }
  return value;
}
