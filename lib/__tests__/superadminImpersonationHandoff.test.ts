import { beforeEach, describe, expect, it } from "vitest";
import { buildImpersonationHeaders, withImpersonationHeaders } from "@/app/lib/superadminImpersonationHandoff";

function createSessionStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

describe("superadmin impersonation handoff headers", () => {
  beforeEach(() => {
    const storage = createSessionStorageMock();
    Object.defineProperty(globalThis, "window", {
      value: { sessionStorage: storage },
      configurable: true,
    });
  });

  it("returns the impersonation header when a handoff token is present", () => {
    (globalThis.window as Window & { sessionStorage: Storage }).sessionStorage.setItem(
      "superadmin_impersonation_handoff_token",
      "token-123",
    );

    expect(buildImpersonationHeaders()).toEqual({ "x-impersonation-token": "token-123" });
  });

  it("merges impersonation headers into existing headers without overwriting explicit values", () => {
    (globalThis.window as Window & { sessionStorage: Storage }).sessionStorage.setItem(
      "superadmin_impersonation_handoff_token",
      "token-456",
    );

    const headers = withImpersonationHeaders({ "Content-Type": "application/json" });
    const parsed = new Headers(headers);

    expect(parsed.get("Content-Type")).toBe("application/json");
    expect(parsed.get("x-impersonation-token")).toBe("token-456");
  });
});
