import { describe, expect, it } from "vitest";
import {
  buildLeadVisitorKey,
  normalizeLeadEmail,
} from "../lib/services/portfolio-lead.service";
import { isPortfolioLeadStatus } from "../app/lib/portfolioLeadConstants";

describe("portfolio lead uniqueness helpers", () => {
  it("normalizes emails for visitor keys", () => {
    expect(normalizeLeadEmail("  Alex@Email.COM ")).toBe("alex@email.com");
    expect(buildLeadVisitorKey("Alex@Email.COM")).toBe("alex@email.com");
  });

  it("accepts known lead statuses only", () => {
    expect(isPortfolioLeadStatus("new")).toBe(true);
    expect(isPortfolioLeadStatus("contacted")).toBe(true);
    expect(isPortfolioLeadStatus("unknown")).toBe(false);
  });
});
