import "server-only";

/**
 * Server-side configuration. Secrets are read only on the server and never
 * sent to the browser (NFR-SE-03). See .env.example for descriptions.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See .env.example.`);
  }
  return value;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabasePublishableKey() {
    return required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  },
  /** Service-role key; bypasses RLS. Used only by trusted server code. */
  get supabaseSecretKey() {
    return required("SUPABASE_SECRET_KEY");
  },
  /** University Google Workspace domain, e.g. "cit.edu" (FR-1.1.1). */
  get allowedEmailDomain() {
    return required("ALLOWED_EMAIL_DOMAIN");
  },
  /** Optional: the first Administrator, created on first sign-in when none exists. */
  get bootstrapAdminEmail() {
    return process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || null;
  },
  get siteUrl() {
    return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  },
  get officeCode() {
    return process.env.OFFICE_CODE?.trim().toUpperCase() || "WIL";
  },
  /** OAuth client of the Internal Google Workspace application (UC-1.5). */
  get googleClientId() {
    return required("GOOGLE_OAUTH_CLIENT_ID");
  },
  get googleClientSecret() {
    return required("GOOGLE_OAUTH_CLIENT_SECRET");
  },
};
