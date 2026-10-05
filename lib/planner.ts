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
