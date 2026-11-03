import { describe, expect, it } from "vitest";
import {
  orderedUserPair,
  parseDirectMessageMetadata,
} from "./connection-messaging.service";

describe("orderedUserPair", () => {
  it("orders ascending regardless of input order", () => {
    expect(orderedUserPair(5n, 2n)).toEqual({ low: 2n, high: 5n });
    expect(orderedUserPair(2n, 5n)).toEqual({ low: 2n, high: 5n });
  });

  it("handles equal ids", () => {
    expect(orderedUserPair(9n, 9n)).toEqual({ low: 9n, high: 9n });
  });
});

describe("parseDirectMessageMetadata", () => {
  it("accepts a versioned associate snapshot", () => {
    const metadata = parseDirectMessageMetadata(JSON.stringify({
      associateCard: {
        version: "associate_card_v1",
        userId: "42",
        name: "Cris Associate",
        role: "user",
        position: "Designer",
        profileUrl: null,
        coverUrl: null,
        portfolioUrl: "/cris-associate",
      },
    }));

    expect(metadata?.associateCard?.userId).toBe("42");
  });

  it("rejects malformed or unsafe metadata", () => {
    expect(parseDirectMessageMetadata("{invalid")).toBeNull();
    expect(parseDirectMessageMetadata(JSON.stringify({
      associateCard: {
        version: "associate_card_v1",
        userId: "not-an-id",
        name: "",
        role: "user",
        position: null,
        profileUrl: null,
        coverUrl: null,
        portfolioUrl: "javascript:alert(1)",
      },
    }))).toBeNull();
  });
});
