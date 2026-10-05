/** Cookie holding the visitor's planner choices as JSON. */
export const PLANNER_COOKIE = "planner";

/** Longest custom run time, in half-hour slots (12 hours). */
export const MAX_CUSTOM_SLOTS = 24;

/** Planning horizons offered, in hours. */
export const HORIZONS = [12, 24, 48];

const ONE_YEAR_S = 365 * 24 * 60 * 60;

export type PlannerPrefs = {
  applianceId: string;
  /** Custom appliance run time, in half-hour slots. */
  customSlots: number;
  /** Custom appliance energy in kWh, kept as typed. */
  customKwh: string;
  /** How far ahead to look, in hours. */
  horizon: number;
};

export const DEFAULT_PREFS: PlannerPrefs = {
  applianceId: "washer",
  customSlots: 2,
  customKwh: "1",
  horizon: 24,
};

/** Reads the planner cookie, falling back to the default for anything missing or malformed. */
export function parsePlannerPrefs(raw: string | undefined): PlannerPrefs {
  if (!raw) return DEFAULT_PREFS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFS;
  }
  if (typeof value !== "object" || value === null) return DEFAULT_PREFS;
  const { applianceId, customSlots, customKwh, horizon } = value as Record<
    string,
    unknown
  >;
  return {
    applianceId:
      typeof applianceId === "string" && /^[a-z]{1,20}$/.test(applianceId)
        ? applianceId
        : DEFAULT_PREFS.applianceId,
    customSlots:
      Number.isInteger(customSlots) &&
      (customSlots as number) >= 1 &&
      (customSlots as number) <= MAX_CUSTOM_SLOTS
        ? (customSlots as number)
        : DEFAULT_PREFS.customSlots,
    customKwh:
      typeof customKwh === "string" && /^\d{0,3}(\.\d{0,3})?$/.test(customKwh)
        ? customKwh
        : DEFAULT_PREFS.customKwh,
    horizon: HORIZONS.includes(horizon as number)
      ? (horizon as number)
      : DEFAULT_PREFS.horizon,
  };
}

/** Remembers the planner choices for a year. Browser only. */
export function savePlannerPrefs(prefs: PlannerPrefs) {
  const value = encodeURIComponent(JSON.stringify(prefs));
  document.cookie = `${PLANNER_COOKIE}=${value}; max-age=${ONE_YEAR_S}; path=/; samesite=lax`;
}
