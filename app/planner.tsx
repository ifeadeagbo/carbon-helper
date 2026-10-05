"use client";

import { useState } from "react";
import type { IntensityIndex, Slot } from "@/lib/carbon";
import { averageIntensity, findBestWindow } from "@/lib/planner";

// Typical figures per cycle; real appliances vary.
const APPLIANCES = [
  { id: "washer", label: "Washing machine", slots: 3, kwh: 0.8 },
  { id: "dishwasher", label: "Dishwasher", slots: 4, kwh: 1.2 },
  { id: "dryer", label: "Tumble dryer", slots: 3, kwh: 2.5 },
  { id: "ev", label: "EV charge (4h at 7kW)", slots: 8, kwh: 28 },
];

const HORIZONS = [12, 24, 48];

export const INDEX_COLOR: Record<IntensityIndex, string> = {
  "very low": "var(--status-good)",
  low: "var(--status-good)",
  moderate: "var(--status-warning)",
  high: "var(--status-serious)",
  "very high": "var(--status-critical)",
};

const LEGEND: IntensityIndex[] = ["low", "moderate", "high", "very high"];

// Fixed locale and time zone so server and client render identical text.
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
});
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
});

const time = (iso: string) => timeFormat.format(new Date(iso));
const dayTime = (iso: string) =>
  `${dayFormat.format(new Date(iso))} ${time(iso)}`;

export function Planner({ slots }: { slots: Slot[] }) {
  const [applianceId, setApplianceId] = useState(APPLIANCES[0].id);
  const [horizon, setHorizon] = useState(24);
  const [hovered, setHovered] = useState<number | null>(null);

  const appliance = APPLIANCES.find((a) => a.id === applianceId)!;
  const visible = slots.slice(0, horizon * 2);
  const best = findBestWindow(visible, appliance.slots);
  const max = Math.max(...visible.map((slot) => slot.forecast), 1);

  const inBest = (i: number) =>
    best !== null && i >= best.start && i < best.start + best.length;
  const detail = hovered !== null ? visible[hovered] : null;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm text-muted">
          I want to run
          <select
            value={applianceId}
            onChange={(e) => setApplianceId(e.target.value)}
            className="rounded-md border border-grid bg-background px-3 py-2 text-base text-foreground"
          >
            {APPLIANCES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          finishing within
          <select
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            className="rounded-md border border-grid bg-background px-3 py-2 text-base text-foreground"
          >
            {HORIZONS.map((h) => (
              <option key={h} value={h}>
                {h} hours
              </option>
            ))}
          </select>
        </label>
      </div>

      {best && <Recommendation slots={visible} best={best} kwh={appliance.kwh} />}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted">
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {LEGEND.map((index) => (
              <li key={index} className="flex items-center gap-1.5 capitalize">
                <span
                  className="size-2.5 rounded-sm"
                  style={{ background: INDEX_COLOR[index] }}
                />
                {index}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-foreground/15" />
              Best window
            </li>
          </ul>
          <p className="tabular-nums" aria-live="polite">
            {detail
              ? `${dayTime(detail.from)}–${time(detail.to)} · ${detail.forecast} gCO₂/kWh · ${detail.index}`
              : `Peak ${max} gCO₂/kWh · hover a bar for detail`}
          </p>
        </div>

        <div
          className="flex h-40 items-end gap-px border-b border-grid"
          onPointerLeave={() => setHovered(null)}
        >
          {visible.map((slot, i) => (
            <div
              key={slot.from}
              onPointerEnter={() => setHovered(i)}
              onPointerDown={() => setHovered(i)}
              className={`flex h-full flex-1 items-end ${
                inBest(i) ? "bg-foreground/15" : ""
              } ${hovered === i ? "opacity-60" : ""}`}
            >
              <div
                className="w-full rounded-t-sm"
                style={{
                  height: `${(slot.forecast / max) * 100}%`,
                  background: INDEX_COLOR[slot.index],
                }}
              />
            </div>
          ))}
        </div>

        <div className="flex justify-between text-xs text-muted tabular-nums">
          <span>{dayTime(visible[0].from)}</span>
          <span>{dayTime(visible[Math.floor(visible.length / 2)].from)}</span>
          <span>{dayTime(visible[visible.length - 1].to)}</span>
        </div>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted">
          Show forecast as a table
        </summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead className="text-muted">
            <tr>
              <th className="py-1 font-normal">Time</th>
              <th className="py-1 font-normal">gCO₂/kWh</th>
              <th className="py-1 font-normal">Index</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((slot) => (
              <tr key={slot.from} className="border-t border-grid">
                <td className="py-1">
                  {dayTime(slot.from)}–{time(slot.to)}
                </td>
                <td className="py-1">{slot.forecast}</td>
                <td className="py-1 capitalize">{slot.index}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function Recommendation({
  slots,
  best,
  kwh,
}: {
  slots: Slot[];
  best: { start: number; length: number; average: number };
  kwh: number;
}) {
  const nowAverage = averageIntensity(slots.slice(0, best.length));
  const savedGrams = Math.round((nowAverage - best.average) * kwh);
  const savedPercent = Math.round((1 - best.average / nowAverage) * 100);
  const first = slots[best.start];
  const last = slots[best.start + best.length - 1];

  return (
    <div className="rounded-lg border border-grid p-5">
      <p className="text-sm text-muted">Greenest time to start</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">
        {best.start === 0 ? "Now" : dayTime(first.from)}
        <span className="text-lg font-normal text-muted">
          {" "}
          until {time(last.to)}
        </span>
      </p>
      <p className="mt-2 text-sm text-muted">
        {best.start === 0 || savedGrams <= 0
          ? `It won't get cleaner than right now (about ${Math.round(best.average)} gCO₂/kWh).`
          : `About ${Math.round(best.average)} gCO₂/kWh instead of ${Math.round(nowAverage)} if you started now: roughly ${savedGrams.toLocaleString("en-GB")} g CO₂ saved (${savedPercent}% less).`}
      </p>
    </div>
  );
}
