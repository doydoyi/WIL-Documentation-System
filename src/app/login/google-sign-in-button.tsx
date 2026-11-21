"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buttonClass, cx } from "@/components/ui";

export function GoogleSignInButton({ next, hostedDomain }: { next: string; hostedDomain: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectTo.toString(),
        // Pre-selects university accounts on Google's screen; the server
        // still verifies the domain after sign-in.
        queryParams: { prompt: "select_account", ...(hostedDomain ? { hd: hostedDomain } : {}) },
      },
    });
    if (error) {
      setError("Google sign-in could not be started. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={signIn} disabled={pending} className={cx(buttonClass.primary, "w-full py-2.5")}>
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
          <path fill="#fff" d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.64 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.68 3.7 14.55 2.8 12 2.8 6.92 2.8 2.8 6.92 2.8 12s4.12 9.2 9.2 9.2c5.31 0 8.83-3.73 8.83-8.98 0-.6-.07-1.06-.15-1.52Z" />
        </svg>
        {pending ? "Redirecting to Google…" : "Sign in with Google"}
      </button>
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
