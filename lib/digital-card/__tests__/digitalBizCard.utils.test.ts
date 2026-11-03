import { describe, expect, it } from "vitest";
import {
  buildDigitalBizCardData,
  buildDisplayName,
  buildInitials,
  cleanCardField,
  formatPortfolioLabel,
} from "@/app/components/digital-card/digitalBizCard.utils";

describe("digitalBizCard.utils", () => {
  it("cleans placeholder values", () => {
    expect(cleanCardField(" n/a ")).toBe("");
    expect(cleanCardField("Jane Doe")).toBe("Jane Doe");
  });

  it("builds display names from profile parts", () => {
    expect(
      buildDisplayName({
        firstName: "John",
        lastName: "Doe",
      }),
    ).toBe("John Doe");
  });

  it("builds initials from a full name", () => {
    expect(buildInitials("John Doe")).toBe("JD");
    expect(buildInitials("Jane")).toBe("JA");
  });

  it("formats portfolio labels without protocol", () => {
    expect(formatPortfolioLabel("https://portal.ontap.ph/johndoe")).toBe(
      "portal.ontap.ph/johndoe",
    );
    expect(formatPortfolioLabel("", "johndoe")).toBe("portal.ontap.ph/johndoe");
  });

  it("builds card data with vcard payload when portfolio url exists", () => {
    const card = buildDigitalBizCardData({
      firstName: "John",
      lastName: "Doe",
      jobTitle: "Developer",
      phone: "+63 912 345 6789",
      email: "john@example.com",
      alias: "johndoe",
      portfolioUrl: "https://portal.ontap.ph/johndoe",
    });

    expect(card).not.toBeNull();
    expect(card?.displayName).toBe("John Doe");
    expect(card?.portfolioLabel).toBe("portal.ontap.ph/johndoe");
    expect(card?.fileName).toBe("johndoe-digital-card.png");
    expect(card?.vcardQrPayload).toContain("BEGIN:VCARD");
    expect(card?.vcardQrPayload).toContain("john@example.com");
  });

  it("returns null when no portfolio url can be resolved", () => {
    expect(
      buildDigitalBizCardData({
        firstName: "John",
        lastName: "Doe",
      }),
    ).toBeNull();
  });
});
