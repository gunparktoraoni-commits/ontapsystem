import { describe, expect, it } from "vitest";
import { renderNotificationTemplate } from "@/server/lib/notification-templates";
import { buildNotificationContent } from "@/server/lib/notifications";
import { buildCalendarEventUrl } from "@/lib/calendar/calendar-utils";
import { buildCalendarEventEmailHtml } from "@/lib/calendar/calendar-email";
import { redirectPathForCompanyRole } from "@/lib/services/company-employee-invite.service";
import {
  EMAIL_PORTAL_PATHS,
  INVITE_EMAIL_PATHS,
  NOTIFICATION_EVENT_ACTION_PATHS,
  NOTIFICATION_TEMPLATE_PATHS,
  TRANSACTIONAL_EMAIL_PATHS,
} from "@/lib/email/portal-paths";
import {
  collectPortalRoutes,
  normalizePortalPathname,
  portalPathExists,
} from "@/lib/email/portal-route-registry";
import {
  extractEmailHrefs,
  filterPortalHrefs,
  toPortalPathname,
} from "@/lib/email/extract-email-links";

const APP_BASE = "https://portal.ontap.ph";
const PORTAL_ROUTES = collectPortalRoutes();

function expectPathExists(pathOrUrl: string): void {
  const pathname = normalizePortalPathname(pathOrUrl);
  expect(
    portalPathExists(pathname, PORTAL_ROUTES),
    `Expected portal route to exist: ${pathname}`,
  ).toBe(true);
}

function renderTemplateLinks(
  template: string,
  data: Record<string, unknown> = {},
): string[] {
  const { html } = renderNotificationTemplate(template, {
    app_name: "OnTap",
    app_url: APP_BASE,
    user_name: "Test User",
    ...data,
  });
  return filterPortalHrefs(extractEmailHrefs(html), APP_BASE).map((href) =>
    toPortalPathname(href, APP_BASE),
  );
}

describe("portal route registry", () => {
  it("discovers core user and admin pages", () => {
    for (const path of [
      EMAIL_PORTAL_PATHS.userDashboard,
      EMAIL_PORTAL_PATHS.userAnalytics,
      EMAIL_PORTAL_PATHS.userEmarket,
      EMAIL_PORTAL_PATHS.adminDashboard,
      EMAIL_PORTAL_PATHS.staffOrders,
      EMAIL_PORTAL_PATHS.feedback,
    ]) {
      expectPathExists(path);
    }
  });
});

describe("canonical email portal paths", () => {
  it("maps every notification template path to an existing route", () => {
    for (const path of Object.values(NOTIFICATION_TEMPLATE_PATHS)) {
      expectPathExists(path);
    }
  });

  it("maps transactional email paths to existing routes", () => {
    for (const path of TRANSACTIONAL_EMAIL_PATHS) {
      expectPathExists(path);
    }
  });

  it("maps invite email paths to existing routes", () => {
    for (const path of INVITE_EMAIL_PATHS) {
      expectPathExists(path);
    }
  });

  it("maps notification event default actions to existing routes", () => {
    for (const path of Object.values(NOTIFICATION_EVENT_ACTION_PATHS)) {
      expectPathExists(path);
    }
  });
});

describe("renderNotificationTemplate button links", () => {
  const templateCases: Array<{ template: string; data?: Record<string, unknown> }> = [
    { template: "daily-digest" },
    { template: "weekly-roundup" },
    { template: "friend-request", data: { sender_name: "Alex" } },
    { template: "profile-view", data: { viewer_name: "Jamie" } },
    { template: "contact-download" },
    { template: "system-update", data: { update_title: "Maintenance", message: "Tonight" } },
    { template: "company-daily-summary", data: { company_name: "Acme Co" } },
    { template: "company-weekly-summary", data: { company_name: "Acme Co" } },
    { template: "company-top-performer", data: { company_name: "Acme Co", performer_name: "Pat" } },
    { template: "marketing_campaign", data: { title: "Promo", content: "Hello world" } },
    {
      template: "order-feedback-request",
      data: {
        order_number: "ORD-1001",
        item_summary: "BizCard Standard",
        feedback_url: `${APP_BASE}/feedback/11111111-2222-3333-4444-555555555555`,
      },
    },
    { template: "abandoned-cart", data: { items: [{ name: "BizCard", quantity: 1 }] } },
    {
      template: "subscription-expiry",
      data: { title: "Renew soon", message: "Your plan expires soon.", plan_label: "Premium" },
    },
    { template: "trial-experience-followup", data: { days_expired: 7 } },
    { template: "trial-upgrade-promo", data: { days_expired: 3 } },
    { template: "bizcard-daily-report", data: { report_date: "2026-09-01", inquiries: 2 } },
    { template: "default", data: { title: "Hello", message: "Update" } },
  ];

  it.each(templateCases)("template %s uses valid portal links", ({ template, data }) => {
    const links = renderTemplateLinks(template, data);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expectPathExists(link);
    }
  });

  it("order feedback without custom URL falls back to orders page", () => {
    const links = renderTemplateLinks("order-feedback-request", {
      order_number: "ORD-1001",
      item_summary: "BizCard Standard",
    });
    expect(links).toContain(EMAIL_PORTAL_PATHS.userOrders);
  });

  it("system-update honors custom action_url when valid", () => {
    const links = renderTemplateLinks("system-update", {
      action_url: EMAIL_PORTAL_PATHS.userAffiliate,
      action_text: "Affiliate dashboard",
    });
    expect(links).toContain(EMAIL_PORTAL_PATHS.userAffiliate);
  });
});

describe("buildNotificationContent action URLs", () => {
  it("defaults every known event type to an existing portal route", () => {
    for (const eventType of Object.keys(NOTIFICATION_EVENT_ACTION_PATHS)) {
      const content = buildNotificationContent(eventType, {});
      expectPathExists(content.action_url);
    }
  });
});

describe("calendar email links", () => {
  const roleCases = [
    { role: "user", path: EMAIL_PORTAL_PATHS.userCalendar },
    { role: "admin", path: EMAIL_PORTAL_PATHS.adminCalendar },
    { role: "company_admin", path: EMAIL_PORTAL_PATHS.adminCalendar },
    { role: "manager", path: EMAIL_PORTAL_PATHS.adminCalendar },
    { role: "staff", path: EMAIL_PORTAL_PATHS.staffCalendar },
    { role: "super_admin", path: EMAIL_PORTAL_PATHS.superadminCalendar },
  ] as const;

  it.each(roleCases)("buildCalendarEventUrl for $role targets an existing route", ({ role, path }) => {
    const relative = buildCalendarEventUrl(role, "evt-123");
    expect(relative.startsWith(path)).toBe(true);
    expectPathExists(relative.split("?")[0] ?? relative);
  });

  it("calendar email CTA points to a valid absolute portal URL", () => {
    const eventUrl = `${APP_BASE}${buildCalendarEventUrl("user", "42")}`;
    const html = buildCalendarEventEmailHtml({
      heading: "Reminder",
      intro: "Your appointment is soon.",
      event: {
        title: "Demo",
        description: "Walkthrough",
        place: "Room A",
        starts_at: new Date("2026-09-15T14:00:00.000Z"),
        ends_at: new Date("2026-09-15T15:00:00.000Z"),
        ownerName: "Alex",
      },
      eventUrl,
    });

    const links = filterPortalHrefs(extractEmailHrefs(html), APP_BASE);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expectPathExists(toPortalPathname(link, APP_BASE));
    }
    expect(links.every((link) => link === eventUrl)).toBe(true);
  });
});

describe("company invite confirmation links", () => {
  it("redirects admins and employees to existing dashboards", () => {
    expectPathExists(redirectPathForCompanyRole("admin"));
    expectPathExists(redirectPathForCompanyRole("manager"));
    expectPathExists(redirectPathForCompanyRole("employee"));
    expect(redirectPathForCompanyRole("admin")).toBe(EMAIL_PORTAL_PATHS.adminDashboard);
    expect(redirectPathForCompanyRole("employee")).toBe(EMAIL_PORTAL_PATHS.userDashboard);
  });
});

describe("invite URL patterns", () => {
  it("staff verify and company accept-invite routes exist", () => {
    expectPathExists(`${EMAIL_PORTAL_PATHS.staffVerify}?token=sample`);
    expectPathExists(`${EMAIL_PORTAL_PATHS.companyAcceptInvite}?token=sample`);
  });

  it("order detail path pattern is supported", () => {
    expectPathExists("/user/orders/ORD-1001");
  });
});
