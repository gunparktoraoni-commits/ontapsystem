import { describe, expect, it } from "vitest";
import {
  buildCalendarEventEmailHtml,
  buildCalendarEventEmailText,
} from "@/lib/calendar/calendar-email";
import { parsePublicity } from "@/lib/services/calendar-event.service";

describe("parsePublicity", () => {
  it("accepts company visibility", () => {
    expect(parsePublicity("company")).toBe("company");
  });

  it("rejects unknown values", () => {
    expect(parsePublicity("everyone")).toBeNull();
  });
});

describe("buildCalendarEventEmailHtml", () => {
  const event = {
    title: "Quarterly Planning",
    description: "Bring your roadmap notes.",
    place: "Conference Room B",
    starts_at: new Date("2026-09-15T14:00:00.000Z"),
    ends_at: new Date("2026-09-15T15:00:00.000Z"),
    ownerName: "Developer Two",
  };
  const eventUrl = "https://portal.ontap.ph/user/calendar?event=42";

  it("includes appointment title, place, link, date/time, and description", () => {
    const html = buildCalendarEventEmailHtml({
      heading: "You're invited to an appointment",
      intro: "Developer Two scheduled an appointment and shared it with you.",
      event,
      eventUrl,
    });

    expect(html).toContain("Quarterly Planning");
    expect(html).toContain("Conference Room B");
    expect(html).toContain(eventUrl);
    expect(html).toContain("Bring your roadmap notes.");
    expect(html).toContain("Date &amp; time");
    expect(html).toContain("Link");
    expect(html).toContain("Description");
  });

  it("escapes unsafe html in user-provided fields", () => {
    const html = buildCalendarEventEmailHtml({
      heading: "Invite",
      intro: "Hello",
      event: {
        ...event,
        title: "<script>alert(1)</script>",
        description: "<img onerror=alert(1)>",
      },
      eventUrl,
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("buildCalendarEventEmailText", () => {
  it("includes plain-text appointment details", () => {
    const event = {
      title: "Client Demo",
      description: "Walk through the portfolio.",
      place: "https://meet.example.com/room",
      starts_at: new Date("2026-09-20T09:30:00.000Z"),
      ends_at: null,
      ownerName: "Alex Admin",
    };
    const eventUrl = "https://portal.ontap.ph/user/calendar?event=99";
    const text = buildCalendarEventEmailText({
      intro: "Alex Admin scheduled an appointment and shared it with you.",
      event,
      eventUrl,
    });

    expect(text).toContain("Title: Client Demo");
    expect(text).toContain("Place: https://meet.example.com/room");
    expect(text).toContain(`Link: ${eventUrl}`);
    expect(text).toContain("Description: Walk through the portfolio.");
    expect(text).toContain("Date & time:");
  });
});
