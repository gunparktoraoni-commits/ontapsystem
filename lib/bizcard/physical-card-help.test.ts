import { describe, expect, it } from "vitest";
import {
  hasVirtualBizCardWithoutSerial,
  physicalCardHelpStorageKey,
} from "./physical-card-help";

describe("hasVirtualBizCardWithoutSerial", () => {
  it("detects virtual cards with either supported serial field missing", () => {
    expect(hasVirtualBizCardWithoutSerial([{ serial_id: null }])).toBe(true);
    expect(hasVirtualBizCardWithoutSerial([{ serialId: "  " }])).toBe(true);
  });

  it("does not treat physical cards or invalid payloads as virtual cards", () => {
    expect(hasVirtualBizCardWithoutSerial([{ serial_id: "ABC234" }])).toBe(false);
    expect(hasVirtualBizCardWithoutSerial([{ serial_id: "", serialId: "ABC234" }]))
      .toBe(false);
    expect(hasVirtualBizCardWithoutSerial(null)).toBe(false);
    expect(hasVirtualBizCardWithoutSerial([null, "invalid"])).toBe(false);
  });
});

describe("physicalCardHelpStorageKey", () => {
  it("scopes persisted state to a normalized account identifier", () => {
    expect(physicalCardHelpStorageKey("help:", " USER@EXAMPLE.COM "))
      .toBe("help:user%40example.com");
  });
});
