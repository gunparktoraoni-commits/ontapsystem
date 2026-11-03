import { formatEventDateTimeRange } from "@/lib/calendar/calendar-utils";

export type CalendarEmailEvent = {
  title: string;
  description: string | null;
  place: string | null;
  starts_at: Date;
  ends_at: Date | null;
  ownerName: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildCalendarEventEmailHtml(params: {
  heading: string;
  intro: string;
  event: CalendarEmailEvent;
  eventUrl: string;
  ctaLabel?: string;
}): string {
  const { heading, intro, event, eventUrl, ctaLabel = "View appointment" } = params;
  const when = formatEventDateTimeRange(event.starts_at, event.ends_at);
  const rows: [string, string][] = [
    ["Title", event.title],
    ["Date & time", when],
    ...(event.place ? [["Place", event.place] as [string, string]] : []),
    ["Link", eventUrl],
    ...(event.description ? [["Description", event.description] as [string, string]] : []),
  ];

  const detailRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;vertical-align:top;width:110px;">${escapeHtml(label)}</td>
          <td style="padding:8px 0;color:#111827;font-size:14px;white-space:pre-wrap;">${label === "Link" ? `<a href="${escapeHtml(eventUrl)}" style="color:#2A4792;word-break:break-all;">${escapeHtml(value)}</a>` : escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827;">
      <h2 style="margin:0 0 12px;font-size:22px;color:#2A4792;">${escapeHtml(heading)}</h2>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#374151;">${escapeHtml(intro)}</p>
      <div style="border:1px solid #e5e7eb;border-radius:14px;padding:18px;background:#f8fafc;">
        <p style="margin:0 0 14px;font-size:13px;color:#4785B8;">Hosted by ${escapeHtml(event.ownerName)}</p>
        <table style="width:100%;border-collapse:collapse;">${detailRows}</table>
      </div>
      <p style="margin:22px 0 0;">
        <a href="${escapeHtml(eventUrl)}" style="display:inline-block;background:#2A4792;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;">
          ${escapeHtml(ctaLabel)}
        </a>
      </p>
    </div>
  `;
}

export function buildCalendarEventEmailText(params: {
  intro: string;
  event: CalendarEmailEvent;
  eventUrl: string;
}): string {
  const { intro, event, eventUrl } = params;
  const when = formatEventDateTimeRange(event.starts_at, event.ends_at);
  const lines = [
    intro,
    "",
    `Title: ${event.title}`,
    `Date & time: ${when}`,
    event.place ? `Place: ${event.place}` : null,
    `Link: ${eventUrl}`,
    event.description ? `Description: ${event.description}` : null,
    "",
    eventUrl,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}
