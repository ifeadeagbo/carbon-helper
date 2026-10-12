import type { Slot } from "./carbon";

export type Window = { start: number; length: number; average: number };

export function averageIntensity(slots: Slot[]): number {
  return slots.reduce((sum, slot) => sum + slot.forecast, 0) / slots.length;
}

/**
 * Finds the run of `length` consecutive half-hour slots with the lowest
 * average forecast intensity. Returns null if there aren't enough slots.
 */
export function findBestWindow(slots: Slot[], length: number): Window | null {
  if (length < 1 || slots.length < length) return null;

  let sum = 0;
  for (let i = 0; i < length; i++) sum += slots[i].forecast;

  let bestSum = sum;
  let bestStart = 0;
  for (let i = length; i < slots.length; i++) {
    sum += slots[i].forecast - slots[i - length].forecast;
    if (sum < bestSum) {
      bestSum = sum;
      bestStart = i - length + 1;
    }
  }
  return { start: bestStart, length, average: bestSum / length };
}

/** Compares the best window with starting straight away. `kwh` is null when the energy use isn't known. */
export function windowStats({
  slots,
  best,
  kwh,
}: {
  slots: Slot[];
  best: Window;
  kwh: number | null;
}) {
  const nowAverage = averageIntensity(slots.slice(0, best.length));
  return {
    nowAverage,
    savedGrams:
      kwh === null ? null : Math.round((nowAverage - best.average) * kwh),
    savedPercent: Math.round((1 - best.average / nowAverage) * 100),
    first: slots[best.start],
    last: slots[best.start + best.length - 1],
  };
}
