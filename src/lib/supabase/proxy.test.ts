import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// A token refresh makes Supabase call setAll with cookies plus no-cache headers.
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (c: unknown[], h: Record<string, string>) => void } }) => ({
    auth: {
      getClaims: async () => {
        opts.cookies.setAll([{ name: "sb-token", value: "t", options: {} }], {
          "Cache-Control": "private, no-store",
        });
        return { data: { claims: { sub: "user-1" } } };
      },
    },
  }),
}));

import { updateSession } from "./proxy";

describe("updateSession", () => {
  it("copies Supabase's no-cache headers onto a pass-through response", async () => {
    const response = await updateSession(new NextRequest("http://localhost/admin/users"));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("copies them onto a redirect too", async () => {
    const response = await updateSession(new NextRequest("http://localhost/login"));
    expect(response.status).toBe(307);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
