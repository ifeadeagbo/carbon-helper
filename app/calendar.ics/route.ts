import type { NextRequest } from "next/server";
import { buildCalendarFile, parseCalendarEvent } from "@/lib/calendar";

/** Calendar file for a planner window: /calendar.ics?start=…&end=…&appliance=… */
export async function GET(request: NextRequest) {
  const event = parseCalendarEvent(request.nextUrl.searchParams);
  if (!event) {
    return new Response("Invalid calendar event", { status: 400 });
  }
  return new Response(buildCalendarFile(event), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="carbon-helper.ics"',
    },
  });
}
