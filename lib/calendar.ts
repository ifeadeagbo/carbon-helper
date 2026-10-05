const MAX_EVENT_MS = 12 * 60 * 60 * 1000;
// Slot times as the Carbon Intensity API writes them, e.g. "2026-01-01T10:30Z".
const SLOT_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;

/** Calendar event titles by appliance id. */
const EVENT_TITLES: Record<string, string> = {
  washer: "Run the washing machine",
  dishwasher: "Run the dishwasher",
  dryer: "Run the tumble dryer",
  ev: "Charge the car",
};
const DEFAULT_TITLE = "Run your appliance";

export type CalendarEvent = { start: Date; end: Date; title: string };

/** Validates the query of a calendar link. Returns null if it isn't a usable event. */
export function parseCalendarEvent(params: URLSearchParams): CalendarEvent | null {
  const from = params.get("start") ?? "";
  const to = params.get("end") ?? "";
  if (!SLOT_TIME.test(from) || !SLOT_TIME.test(to)) return null;

  const start = new Date(from);
  const end = new Date(to);
  const length = end.getTime() - start.getTime();
  if (!(length > 0 && length <= MAX_EVENT_MS)) return null;

  const title = EVENT_TITLES[params.get("appliance") ?? ""] ?? DEFAULT_TITLE;
  return { start, end, title };
}

/** Link to the calendar file for a window, for use in the planner. */
export function calendarHref(start: string, end: string, applianceId: string) {
  return `/calendar.ics?${new URLSearchParams({ start, end, appliance: applianceId })}`;
}

// 20260101T103000Z
const stamp = (date: Date) =>
  `${date.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;

/** An iCalendar file with one event and a reminder five minutes before it starts. */
export function buildCalendarFile(event: CalendarEvent, now = new Date()): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Carbon Helper//EN",
    "BEGIN:VEVENT",
    `UID:${stamp(event.start)}-${stamp(event.end)}@carbon-helper`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(event.end)}`,
    `SUMMARY:${event.title}`,
    "DESCRIPTION:The greenest time to run it\\, found by Carbon Helper.",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${event.title}`,
    "TRIGGER:-PT5M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
