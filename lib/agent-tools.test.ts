import { beforeEach, describe, expect, it, vi } from "vitest";
import { TOOLS, ToolError } from "./agent-tools";
import {
  getForecast,
  getGenerationMix,
  getRegionalForecast,
  type Slot,
} from "./carbon";

// Keep parseOutwardCode real; only the functions that call the API are faked.
vi.mock("./carbon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./carbon")>()),
  getForecast: vi.fn(),
  getGenerationMix: vi.fn(),
  getRegionalForecast: vi.fn(),
}));

/** Half-hour slots from 10:00 UTC on 1 January 2026 with the given forecasts. */
function slots(forecasts: number[]): Slot[] {
  const start = Date.UTC(2026, 0, 1, 10);
  const iso = (i: number) =>
    `${new Date(start + i * 30 * 60 * 1000).toISOString().slice(0, 16)}Z`;
  return forecasts.map((forecast, i) => ({
    from: iso(i),
    to: iso(i + 1),
    forecast,
    actual: null,
    index: "moderate",
  }));
}

const run = (name: string, input: Record<string, unknown>) =>
  TOOLS.find((tool) => tool.definition.name === name)!.run(input);

beforeEach(() => {
  vi.mocked(getForecast).mockReset();
  vi.mocked(getGenerationMix).mockReset();
  vi.mocked(getRegionalForecast).mockReset();
});

describe("tool definitions", () => {
  it("are all strict, with every property required", () => {
    for (const { definition } of TOOLS) {
      const schema = definition.input_schema;
      expect(definition.strict).toBe(true);
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(Object.keys(schema.properties as object));
    }
  });
});

describe("get_current_intensity", () => {
  it("reports the current slot and national mix for Great Britain", async () => {
    vi.mocked(getForecast).mockResolvedValue(slots([120, 90]));
    vi.mocked(getGenerationMix).mockResolvedValue([{ fuel: "wind", perc: 40 }]);

    expect(await run("get_current_intensity", { postcode: null })).toEqual({
      area: "Great Britain",
      from: "Thu 1 Jan, 10:00",
      to: "Thu 1 Jan, 10:30",
      gco2_per_kwh: 120,
      band: "moderate",
      generation_mix_percent: [{ fuel: "wind", perc: 40 }],
    });
  });

  it("uses the region's own figures for a postcode", async () => {
    vi.mocked(getRegionalForecast).mockResolvedValue({
      region: "London",
      slots: slots([60]),
      mix: [{ fuel: "gas", perc: 55 }],
    });

    const result = await run("get_current_intensity", { postcode: "sw1a 1aa" });

    expect(getRegionalForecast).toHaveBeenCalledWith("SW1A");
    expect(result).toMatchObject({
      area: "London",
      gco2_per_kwh: 60,
      generation_mix_percent: [{ fuel: "gas", perc: 55 }],
    });
    expect(getGenerationMix).not.toHaveBeenCalled();
  });

  it("tells the model what to do about a bad or unknown postcode", async () => {
    await expect(
      run("get_current_intensity", { postcode: "London" }),
    ).rejects.toThrow(ToolError);
    expect(getRegionalForecast).not.toHaveBeenCalled();

    vi.mocked(getRegionalForecast).mockResolvedValue(null);
    await expect(
      run("get_current_intensity", { postcode: "ZZ99" }),
    ).rejects.toThrow("No region found for ZZ99");
  });
});

describe("get_forecast", () => {
  it("returns two slots per hour asked for", async () => {
    vi.mocked(getForecast).mockResolvedValue(slots([10, 20, 30, 40, 50]));

    expect(await run("get_forecast", { postcode: null, hours: 1 })).toEqual({
      area: "Great Britain",
      slot_minutes: 30,
      slots: [
        { from: "Thu 1 Jan, 10:00", gco2_per_kwh: 10, band: "moderate" },
        { from: "Thu 1 Jan, 10:30", gco2_per_kwh: 20, band: "moderate" },
      ],
    });
  });

  it("rejects hours outside 1 to 48 before fetching anything", async () => {
    for (const hours of [0, 49, 1.5, "12"]) {
      await expect(
        run("get_forecast", { postcode: null, hours }),
      ).rejects.toThrow("hours must be a whole number from 1 to 48");
    }
    expect(getForecast).not.toHaveBeenCalled();
  });
});

describe("find_greenest_window", () => {
  const washer = {
    postcode: null,
    appliance: "washer",
    custom_minutes: null,
    custom_kwh: null,
    within_hours: 24,
  };

  it("finds the cleanest run and the saving against starting now", async () => {
    // The washer runs for three slots: the cleanest three start at 11:30.
    vi.mocked(getForecast).mockResolvedValue(
      slots([200, 200, 200, 100, 100, 100, 300]),
    );

    expect(await run("find_greenest_window", washer)).toEqual({
      area: "Great Britain",
      appliance: "Washing machine",
      run_minutes: 90,
      starts_now: false,
      start: "Thu 1 Jan, 11:30",
      end: "Thu 1 Jan, 13:00",
      average_gco2_per_kwh: 100,
      if_started_now_gco2_per_kwh: 200,
      percent_cleaner_than_now: 50,
      // (200 - 100) gCO2/kWh x 0.8 kWh
      co2_saved_grams: 80,
      calendar_link:
        "/calendar.ics?start=2026-01-01T11%3A30Z&end=2026-01-01T13%3A00Z&appliance=washer",
    });
  });

  it("offers no calendar link when the best time is now", async () => {
    vi.mocked(getForecast).mockResolvedValue(slots([50, 50, 50, 200, 200]));

    expect(await run("find_greenest_window", washer)).toMatchObject({
      starts_now: true,
      percent_cleaner_than_now: 0,
      co2_saved_grams: 0,
      calendar_link: null,
    });
  });

  it("only looks as far ahead as within_hours", async () => {
    vi.mocked(getForecast).mockResolvedValue(
      slots([200, 200, 200, 200, 10, 10, 10]),
    );

    expect(
      await run("find_greenest_window", { ...washer, within_hours: 2 }),
    ).toMatchObject({ starts_now: true, average_gco2_per_kwh: 200 });
  });

  it("takes the run time and energy of a custom appliance", async () => {
    vi.mocked(getForecast).mockResolvedValue(slots([300, 100, 100, 300]));

    expect(
      await run("find_greenest_window", {
        ...washer,
        appliance: "custom",
        custom_minutes: 60,
        custom_kwh: 2,
      }),
    ).toMatchObject({
      appliance: "Custom appliance",
      run_minutes: 60,
      start: "Thu 1 Jan, 10:30",
      co2_saved_grams: 200,
    });
  });

  it("leaves the saving out when a custom appliance's energy is unknown", async () => {
    vi.mocked(getForecast).mockResolvedValue(slots([300, 100, 100, 300]));

    expect(
      await run("find_greenest_window", {
        ...washer,
        appliance: "custom",
        custom_minutes: 60,
      }),
    ).toMatchObject({ co2_saved_grams: null, percent_cleaner_than_now: 50 });
  });

  it("rejects custom figures out of range", async () => {
    const custom = { ...washer, appliance: "custom", custom_minutes: 60 };
    for (const input of [
      { ...custom, custom_minutes: null },
      { ...custom, custom_minutes: 45 },
      { ...custom, custom_minutes: 750 },
      { ...custom, custom_kwh: 0 },
      { ...custom, custom_kwh: 101 },
      { ...custom, appliance: "kettle" },
    ]) {
      await expect(run("find_greenest_window", input)).rejects.toThrow(ToolError);
    }
    expect(getForecast).not.toHaveBeenCalled();
  });

  it("says so when the run doesn't fit in the hours given", async () => {
    vi.mocked(getForecast).mockResolvedValue(slots([100, 100, 100, 100]));

    await expect(
      run("find_greenest_window", { ...washer, within_hours: 1 }),
    ).rejects.toThrow("does not fit");
  });

  it("copes with a regional forecast of zero throughout", async () => {
    vi.mocked(getRegionalForecast).mockResolvedValue({
      region: "North Scotland",
      slots: slots([0, 0, 0, 0]),
      mix: [],
    });

    expect(
      await run("find_greenest_window", { ...washer, postcode: "IV1" }),
    ).toMatchObject({ area: "North Scotland", percent_cleaner_than_now: 0 });
  });
});
