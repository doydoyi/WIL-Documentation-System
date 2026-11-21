import type { Metadata } from "next";
import { Alert } from "@/components/ui";
import { safeRedirectPath } from "@/lib/domain/access";
import { GoogleSignInButton } from "./google-sign-in-button";

export const metadata: Metadata = { title: "Sign in" };

/** Messages state what went wrong and how to fix it (NFR-US-03). */
const ERRORS: Record<string, { tone: "error" | "info"; text: string }> = {
  domain: { tone: "error", text: "Use your university Google account." },
  unregistered: { tone: "error", text: "Your account is not registered. Contact the Administrator." },
  inactive: {
    tone: "error",
    text: "Your account is not active. Contact the Administrator to have it reactivated.",
  },
  timeout: { tone: "info", text: "You were signed out after 20 minutes of inactivity. Sign in again to continue." },
  callback: { tone: "error", text: "Google sign-in could not be completed. Try again." },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const next = safeRedirectPath(typeof params.next === "string" ? params.next : undefined);
  const error = errorKey ? ERRORS[errorKey] : undefined;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div
            aria-hidden
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-bold text-accent"
          >
            WIL
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Wildcats Innovation Labs Office
            </p>
            <h1 className="text-lg font-semibold leading-tight text-stone-900">
              Document Management and Automated Reporting System
            </h1>
          </div>
        </div>

        {error ? (
          <div className="mb-5">
            <Alert tone={error.tone}>{error.text}</Alert>
          </div>
        ) : null}

        <GoogleSignInButton
          next={next}
          hostedDomain={process.env.ALLOWED_EMAIL_DOMAIN ?? ""}
        />
        <p className="mt-4 text-center text-xs text-stone-500">
          Only registered office personnel with a university Google account can sign in.
        </p>
      </div>
    </main>
  );
}
