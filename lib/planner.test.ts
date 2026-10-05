import { describe, expect, it } from "vitest";
import type { Slot } from "./carbon";
import { averageIntensity, findBestWindow } from "./planner";

const START = Date.UTC(2026, 0, 1);
const HALF_HOUR_MS = 30 * 60 * 1000;

function slots(...forecasts: number[]): Slot[] {
  return forecasts.map((forecast, i) => ({
    from: new Date(START + i * HALF_HOUR_MS).toISOString(),
    to: new Date(START + (i + 1) * HALF_HOUR_MS).toISOString(),
    forecast,
    actual: null,
    index: "moderate",
  }));
}

describe("averageIntensity", () => {
  it("averages the forecast values", () => {
    expect(averageIntensity(slots(100, 200, 300))).toBe(200);
  });

  it("uses the forecast, not the actual reading", () => {
    const [slot] = slots(100);
    expect(averageIntensity([{ ...slot, actual: 500 }])).toBe(100);
  });
});

describe("findBestWindow", () => {
  it("finds the lowest-average run in the middle of the forecast", () => {
    expect(findBestWindow(slots(200, 180, 60, 40, 50, 190), 3)).toEqual({
      start: 2,
      length: 3,
      average: 50,
    });
  });

  it("picks the first slots when they are the cleanest", () => {
    expect(findBestWindow(slots(10, 20, 300, 300), 2)).toEqual({
      start: 0,
      length: 2,
      average: 15,
    });
  });

  it("picks the last slots when they are the cleanest", () => {
    expect(findBestWindow(slots(300, 300, 20, 10), 2)).toEqual({
      start: 2,
      length: 2,
      average: 15,
    });
  });

  it("prefers the earliest window when several tie", () => {
    expect(findBestWindow(slots(50, 50, 200, 50, 50), 2)?.start).toBe(0);
  });

  it("judges the whole window, not its single lowest slot", () => {
    // The 10 is the cleanest slot, but its neighbours make every window
    // containing it worse than the steady run at the end.
    expect(findBestWindow(slots(400, 10, 400, 100, 100), 2)).toEqual({
      start: 3,
      length: 2,
      average: 100,
    });
  });

  it("handles a single-slot window", () => {
    expect(findBestWindow(slots(90, 30, 70), 1)).toEqual({
      start: 1,
      length: 1,
      average: 30,
    });
  });

  it("returns the whole forecast when the window is exactly as long", () => {
    expect(findBestWindow(slots(100, 200, 300), 3)).toEqual({
      start: 0,
      length: 3,
      average: 200,
    });
  });

  it("returns null when there are fewer slots than the window needs", () => {
    expect(findBestWindow(slots(100, 200), 3)).toBeNull();
    expect(findBestWindow([], 1)).toBeNull();
  });

  it("returns null for a window shorter than one slot", () => {
    expect(findBestWindow(slots(100, 200), 0)).toBeNull();
    expect(findBestWindow(slots(100, 200), -1)).toBeNull();
  });
});
