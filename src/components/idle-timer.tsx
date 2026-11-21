"use client";

import { useEffect } from "react";
import { IDLE_TIMEOUT_MS } from "@/lib/domain/access";

const EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;
const HEARTBEAT_MS = 4 * 60 * 1000;

/**
 * Signs the user out after 20 minutes without interaction (FR-1.1.3).
 * The proxy enforces the same limit on the server; while the user is active
 * on a page without navigating, a throttled heartbeat tells the server so.
 */
export function IdleTimer() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let lastHeartbeat = Date.now();
    const reset = () => {
      if (Date.now() - lastHeartbeat > HEARTBEAT_MS) {
        lastHeartbeat = Date.now();
        void fetch("/auth/activity", { method: "POST" }).catch(() => undefined);
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Full navigation on purpose: /auth/signout is a Route Handler that
        // clears the session cookies.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/auth/signout?reason=timeout");
      }, IDLE_TIMEOUT_MS);
    };
    reset();
    EVENTS.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      EVENTS.forEach((event) => window.removeEventListener(event, reset));
    };
  }, []);
  return null;
}
