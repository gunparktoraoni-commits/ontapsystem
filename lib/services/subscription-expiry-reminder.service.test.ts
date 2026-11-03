/// <reference types="node" />
import { describe, expect, it } from "vitest";
import {
  buildReminderKey,
  buildReminderMessage,
  buildReminderTitle,
  computeDaysRemaining,
  shouldWarnForExpiry,
} from "./subscription-expiry-reminder.service";

describe("subscription-expiry-reminder.service helpers", () => {
  it("computeDaysRemaining uses ceiling day math", () => {
    const now = new Date("2026-07-31T12:00:00.000Z");
    expect(computeDaysRemaining(new Date("2026-08-01T11:00:00.000Z"), now)).toBe(1);
    expect(computeDaysRemaining(new Date("2026-08-03T12:00:00.000Z"), now)).toBe(3);
    expect(computeDaysRemaining(new Date("2026-07-30T12:00:00.000Z"), now)).toBe(0);
  });

  it("buildReminderKey encodes kind, days, and UTC date", () => {
    const date = new Date("2026-07-31T15:30:00.000Z");
    expect(buildReminderKey({ kind: "free_trial", daysRemaining: 1, date })).toBe(
      "trial:1:2026-07-31",
    );
    expect(buildReminderKey({ kind: "paid_subscription", daysRemaining: 3, date })).toBe(
      "paid:3:2026-07-31",
    );
    expect(buildReminderKey({ kind: "expired", daysRemaining: 0, date })).toBe(
      "expired:2026-07-31",
    );
  });

  it("buildReminderMessage returns required copy", () => {
    expect(buildReminderMessage("free_trial", 1)).toBe(
      "Your free trial is about to expire. Subscribe now to continue using the service.",
    );
    expect(buildReminderMessage("paid_subscription", 3)).toBe(
      "Your subscription will expire in 3 days. Renew now to avoid interruption.",
    );
    expect(buildReminderMessage("paid_subscription", 1)).toBe(
      "Your subscription will expire in 1 day. Renew now to avoid interruption.",
    );
    expect(buildReminderMessage("expired", 0)).toBe(
      "Your subscription has expired. Please renew to continue using the service.",
    );
  });

  it("buildReminderTitle maps kind", () => {
    expect(buildReminderTitle("free_trial")).toBe("Free trial ending");
    expect(buildReminderTitle("paid_subscription")).toBe("Subscription expiring");
    expect(buildReminderTitle("expired")).toBe("Subscription expired");
  });

  it("shouldWarnForExpiry matches trial 1d, paid 3/1, and expired", () => {
    expect(
      shouldWarnForExpiry({ kind: "free_trial", daysRemaining: 1, expired: false }),
    ).toBe(true);
    expect(
      shouldWarnForExpiry({ kind: "free_trial", daysRemaining: 2, expired: false }),
    ).toBe(false);
    expect(
      shouldWarnForExpiry({ kind: "paid_subscription", daysRemaining: 3, expired: false }),
    ).toBe(true);
    expect(
      shouldWarnForExpiry({ kind: "paid_subscription", daysRemaining: 1, expired: false }),
    ).toBe(true);
    expect(
      shouldWarnForExpiry({ kind: "paid_subscription", daysRemaining: 7, expired: false }),
    ).toBe(false);
    expect(
      shouldWarnForExpiry({ kind: "paid_subscription", daysRemaining: 0, expired: true }),
    ).toBe(true);
  });
});
