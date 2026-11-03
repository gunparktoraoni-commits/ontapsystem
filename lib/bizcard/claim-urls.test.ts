import { describe, expect, it } from "vitest";
import { buildBlankCardNextPath } from "./claim-urls";

describe("buildBlankCardNextPath", () => {
  const serial = "CXVCG2";

  it("sends a guest to signup with the scanned serial", () => {
    expect(buildBlankCardNextPath(serial, "signup")).toBe(
      "/user/signup?ref=CXVCG2",
    );
  });

  it("sends a signed-in user without an eligible card to separate registration", () => {
    expect(buildBlankCardNextPath(serial, "manual_register")).toBe(
      "/user/bizcard/create-new?serial=CXVCG2",
    );
  });

  it("sends a signed-in user with an eligible card to merge confirmation", () => {
    expect(buildBlankCardNextPath(serial, "merge_choice", "card-123")).toBe(
      "/scan/CXVCG2/merge?virtualId=card-123",
    );
  });

  it("falls back to separate registration if merge data has no selectable card", () => {
    expect(buildBlankCardNextPath(serial, "merge_choice")).toBe(
      "/user/bizcard/create-new?serial=CXVCG2",
    );
  });
});
