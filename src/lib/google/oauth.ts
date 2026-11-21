import "server-only";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * OAuth for the Internal Google Workspace application (UC-1.5 step 2).
 *
 * An Administrator authorizes the system once; the refresh token is stored in
 * Supabase Vault and only ever read by server code (FR-1.5.5, NFR-SE-03),
 * so scheduled synchronization can run without a signed-in user.
 *
 * Scopes (NFR-SE-06): Drive is needed to read the Shared Drive, write the
 * document code to appProperties and copy templates; Docs fills generated
 * reports (Sprint 2). openid/email identify the authorizing account.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const OAUTH_STATE_COOKIE = "wil_google_oauth_state";

export function googleRedirectUri(): string {
  return `${env.siteUrl}/api/google/callback`;
}

export function buildGoogleAuthUrl(state: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    // Always show consent so Google returns a refresh token.
    prompt: "consent",
    include_granted_scopes: "true",
    hd: env.allowedEmailDomain,
    state,
  }).toString();
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      ...body,
    }),
    cache: "no-store",
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = (json as { error?: string }).error ?? `HTTP ${response.status}`;
    throw new GoogleAuthError(reason);
  }
  return json as TokenResponse;
}

export class GoogleAuthError extends Error {
  constructor(public readonly reason: string) {
    super(
      reason === "invalid_grant"
        ? "Google access has been revoked or has expired. An Administrator must reconnect the Google account in Drive Settings."
        : `Google rejected the request (${reason}). Check the OAuth client settings.`,
    );
  }
}

export async function exchangeAuthorizationCode(code: string) {
  const tokens = await tokenRequest({
    code,
    grant_type: "authorization_code",
    redirect_uri: googleRedirectUri(),
  });
  const granted = new Set((tokens.scope ?? "").split(" "));
  const missingScopes = GOOGLE_SCOPES.filter((s) => s.startsWith("https://") && !granted.has(s));
  return {
    refreshToken: tokens.refresh_token ?? null,
    email: emailFromIdToken(tokens.id_token),
    missingScopes,
  };
}

/**
 * Reads the e-mail claim. The ID token came directly from Google's token
 * endpoint over TLS in exchange for our client secret, so its signature does
 * not need to be re-verified here.
 */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function storeRefreshToken(refreshToken: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("set_google_refresh_token", { p_token: refreshToken });
  if (error) throw new Error(`The Google credential could not be stored: ${error.message}`);
  cachedAccessToken = null;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/** Short-lived access token from the stored refresh token. */
export async function getGoogleAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }
  const admin = createAdminClient();
  const { data: refreshToken, error } = await admin.rpc("get_google_refresh_token");
  if (error) throw new Error(`The Google credential could not be read: ${error.message}`);
  if (!refreshToken) {
    throw new GoogleAuthError("not_connected");
  }
  const tokens = await tokenRequest({ refresh_token: refreshToken as string, grant_type: "refresh_token" });
  cachedAccessToken = { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  return tokens.access_token;
}
