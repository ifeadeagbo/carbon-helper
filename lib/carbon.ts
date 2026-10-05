const API = "https://api.carbonintensity.org.uk";
const HALF_HOUR_MS = 30 * 60 * 1000;

export type IntensityIndex =
  | "very low"
  | "low"
  | "moderate"
  | "high"
  | "very high";

export type Slot = {
  from: string;
  to: string;
  /** gCO2 per kWh */
  forecast: number;
  actual: number | null;
  index: IntensityIndex;
};

export type FuelShare = { fuel: string; perc: number };

type ApiSlot = {
  from: string;
  to: string;
  intensity: { forecast: number; actual: number | null; index: IntensityIndex };
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: "application/json" },
    // The API publishes new figures every half hour.
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`Carbon Intensity API ${path} returned ${res.status}`);
  }
  const body: { data: T } = await res.json();
  return body.data;
}

/** Half-hourly national forecast for the next 48 hours, starting with the current slot. */
export async function getForecast(now = new Date()): Promise<Slot[]> {
  // Round down to the half hour so the URL (and so the cache key) is stable.
  const start = new Date(
    Math.floor(now.getTime() / HALF_HOUR_MS) * HALF_HOUR_MS,
  );
  const from = `${start.toISOString().slice(0, 16)}Z`;
  const data = await get<ApiSlot[]>(`/intensity/${from}/fw48h`);
  return data
    .filter((slot) => new Date(slot.to) > now)
    .map(({ from, to, intensity }) => ({ from, to, ...intensity }));
}

/** Current national generation mix, largest share first. */
export async function getGenerationMix(): Promise<FuelShare[]> {
  const data = await get<{ generationmix: FuelShare[] }>("/generation");
  return data.generationmix
    .filter((share) => share.perc > 0)
    .sort((a, b) => b.perc - a.perc);
}
