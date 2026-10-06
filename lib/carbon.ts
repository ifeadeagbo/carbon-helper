const API = "https://api.carbonintensity.org.uk";
const HALF_HOUR_MS = 30 * 60 * 1000;
// The API publishes new figures every half hour.
const FORECAST_CACHE_S = 5 * 60;
// Which region a postcode belongs to all but never changes.
const REGION_LOOKUP_CACHE_S = 7 * 24 * 60 * 60;

export type IntensityIndex =
  | "very low"
  | "low"
  | "moderate"
  | "high"
  | "very high";

/** CSS colour for each intensity band. */
export const INDEX_COLOR: Record<IntensityIndex, string> = {
  "very low": "var(--status-good)",
  low: "var(--status-good)",
  moderate: "var(--status-warning)",
  high: "var(--status-serious)",
  "very high": "var(--status-critical)",
};

export type Slot = {
  from: string;
  to: string;
  /** gCO2 per kWh */
  forecast: number;
  actual: number | null;
  index: IntensityIndex;
};

export type FuelShare = { fuel: string; perc: number };

export type RegionalForecast = {
  /** Region name, e.g. "London" */
  region: string;
  slots: Slot[];
  /** Forecast generation mix for the current slot, largest share first. */
  mix: FuelShare[];
};

type ApiSlot = {
  from: string;
  to: string;
  intensity: { forecast: number; actual?: number | null; index: IntensityIndex };
};

type ApiRegion = {
  shortname: string;
  data: (ApiSlot & { generationmix: FuelShare[] })[];
};

/**
 * Returns null when the API has no data for the path: it answers 200 with a
 * `null` body, or with the status given as `missingStatus`.
 */
async function get<T>(
  path: string,
  { revalidate = FORECAST_CACHE_S, missingStatus = 0 } = {},
): Promise<T | null> {
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: "application/json" },
    next: { revalidate },
  });
  if (res.status === missingStatus) return null;
  if (!res.ok) {
    throw new Error(`Carbon Intensity API ${path} returned ${res.status}`);
  }
  const body: { data: T } | null = await res.json();
  return body?.data ?? null;
}

function toSlots(data: ApiSlot[], now: Date): Slot[] {
  return data
    .filter((slot) => new Date(slot.to) > now)
    .map(({ from, to, intensity }) => ({
      from,
      to,
      forecast: intensity.forecast,
      actual: intensity.actual ?? null,
      index: intensity.index,
    }));
}

function sortMix(mix: FuelShare[]): FuelShare[] {
  return mix.filter((share) => share.perc > 0).sort((a, b) => b.perc - a.perc);
}

// Round down to the half hour so the URL (and so the cache key) is stable.
function slotStart(now: Date): string {
  const start = new Date(
    Math.floor(now.getTime() / HALF_HOUR_MS) * HALF_HOUR_MS,
  );
  return `${start.toISOString().slice(0, 16)}Z`;
}

/**
 * Extracts the outward code ("SW1A") from a full or partial UK postcode.
 * Returns null if the input doesn't look like one.
 */
export function parseOutwardCode(input: string): string | null {
  const compact = input.replace(/\s+/g, "").toUpperCase();
  const match = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})?$/);
  return match ? match[1] : null;
}

/** Half-hourly national forecast for the next 48 hours, starting with the current slot. */
export async function getForecast(now = new Date()): Promise<Slot[]> {
  const path = `/intensity/${slotStart(now)}/fw48h`;
  const data = await get<ApiSlot[]>(path);
  if (!data) throw new Error(`Carbon Intensity API ${path} returned no data`);
  return toSlots(data, now);
}

/** Current national generation mix, largest share first. */
export async function getGenerationMix(): Promise<FuelShare[]> {
  const data = await get<{ generationmix: FuelShare[] }>("/generation");
  if (!data) throw new Error("Carbon Intensity API /generation returned no data");
  return sortMix(data.generationmix);
}

/**
 * Half-hourly forecast for the region containing an outward postcode, for the
 * next 48 hours. Returns null if the API doesn't recognise the postcode.
 */
export async function getRegionalForecast(
  outwardCode: string,
  now = new Date(),
): Promise<RegionalForecast | null> {
  // Look the region up first and fetch the forecast by region, so everyone in
  // the same region shares one cached forecast whatever their postcode.
  const lookup = await get<{ regionid: number }[]>(
    `/regional/postcode/${encodeURIComponent(outwardCode)}`,
    { revalidate: REGION_LOOKUP_CACHE_S, missingStatus: 400 },
  );
  const regionId = lookup?.[0]?.regionid;
  if (regionId === undefined) return null;

  const region = await get<ApiRegion>(
    `/regional/intensity/${slotStart(now)}/fw48h/regionid/${regionId}`,
  );
  if (!region) return null;
  const current = region.data.find((slot) => new Date(slot.to) > now);
  return {
    region: region.shortname,
    slots: toSlots(region.data, now),
    mix: sortMix(current?.generationmix ?? []),
  };
}
