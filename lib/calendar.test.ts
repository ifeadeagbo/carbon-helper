import { describe, expect, it } from "vitest";
import {
  buildCalendarFile,
  calendarHref,
  parseCalendarEvent,
} from "./calendar";

const query = (href: string) => new URL(href, "http://x").searchParams;

describe("parseCalendarEvent", () => {
  it("round-trips a link built for the planner", () => {
    const href = calendarHref("2026-01-01T10:30Z", "2026-01-01T12:00Z", "washer");
    expect(parseCalendarEvent(query(href))).toEqual({
      start: new Date("2026-01-01T10:30:00Z"),
      end: new Date("2026-01-01T12:00:00Z"),
      title: "Run the washing machine",
    });
  });

  it("uses a generic title for custom or unknown appliances", () => {
    const href = calendarHref("2026-01-01T10:30Z", "2026-01-01T11:00Z", "custom");
    expect(parseCalendarEvent(query(href))?.title).toBe("Run your appliance");
  });

  it("rejects missing, malformed or implausible times", () => {
    const bad = [
      "/calendar.ics",
      "/calendar.ics?start=2026-01-01T10:30Z",
      "/calendar.ics?start=tomorrow&end=2026-01-01T11:00Z",
      "/calendar.ics?start=2026-01-01T11:00Z&end=2026-01-01T10:30Z",
      "/calendar.ics?start=2026-01-01T10:30Z&end=2026-01-01T10:30Z",
      "/calendar.ics?start=2026-01-01T10:30Z&end=2026-01-03T10:30Z",
      "/calendar.ics?start=2026-13-45T10:30Z&end=2026-13-45T11:30Z",
    ];
    for (const href of bad) expect(parseCalendarEvent(query(href))).toBeNull();
  });
});

describe("buildCalendarFile", () => {
  const file = buildCalendarFile(
    {
      start: new Date("2026-01-01T10:30:00Z"),
      end: new Date("2026-01-01T12:00:00Z"),
      title: "Run the dishwasher",
    },
    new Date("2026-01-01T08:00:00Z"),
  );

  it("writes the event in UTC with CRLF line endings", () => {
    const lines = file.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("DTSTART:20260101T103000Z");
    expect(lines).toContain("DTEND:20260101T120000Z");
    expect(lines).toContain("DTSTAMP:20260101T080000Z");
    expect(lines).toContain("SUMMARY:Run the dishwasher");
    expect(lines.at(-2)).toBe("END:VCALENDAR");
    expect(file).not.toMatch(/[^\r]\n/);
  });

  it("includes a reminder five minutes before the start", () => {
    expect(file).toContain("BEGIN:VALARM\r\nACTION:DISPLAY");
    expect(file).toContain("TRIGGER:-PT5M");
  });
});
