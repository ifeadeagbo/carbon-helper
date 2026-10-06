import { afterEach, describe, expect, it, vi } from "vitest";
import { getRegionalForecast, parseOutwardCode } from "./carbon";

describe("parseOutwardCode", () => {
  it("accepts an outward code as typed", () => {
    expect(parseOutwardCode("SW1A")).toBe("SW1A");
    expect(parseOutwardCode("M1")).toBe("M1");
  });

  it("drops the inward part of a full postcode", () => {
    expect(parseOutwardCode("SW1A 1AA")).toBe("SW1A");
    expect(parseOutwardCode("M1 1AA")).toBe("M1");
    expect(parseOutwardCode("EH11BB")).toBe("EH1");
  });

  it("ignores case and stray whitespace", () => {
    expect(parseOutwardCode("  ls6 2ab ")).toBe("LS6");
  });

  it("rejects input that isn't a postcode", () => {
    expect(parseOutwardCode("")).toBeNull();
    expect(parseOutwardCode("London")).toBeNull();
    expect(parseOutwardCode("12345")).toBeNull();
    expect(parseOutwardCode("SW1A/../x")).toBeNull();
  });
});

describe("getRegionalForecast", () => {
  const now = new Date("2026-01-01T10:10:00Z");

  const API = "https://api.carbonintensity.org.uk";
  const LOOKUP = `${API}/regional/postcode/SW1A`;
  const FORECAST = `${API}/regional/intensity/2026-01-01T10:00Z/fw48h/regionid/13`;
  const found = { status: 200, body: { data: [{ regionid: 13 }] } };

  /** Stubs fetch with a response per URL; anything else is a 404. */
  function stubApi(responses: Record<string, { status: number; body: unknown }>) {
    const fetchMock = vi.fn(
      async (url: string, init?: { next?: { revalidate?: number } }) => {
        void init;
        const { status, body } = responses[url] ?? { status: 404, body: null };
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => body,
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("returns the region's upcoming slots and current mix", async () => {
    stubApi({
      [LOOKUP]: found,
      [FORECAST]: {
        status: 200,
        body: {
          data: {
            shortname: "London",
            data: [
              {
                from: "2026-01-01T09:30Z",
                to: "2026-01-01T10:00Z",
                intensity: { forecast: 300, index: "very high" },
                generationmix: [{ fuel: "coal", perc: 100 }],
              },
              {
                from: "2026-01-01T10:00Z",
                to: "2026-01-01T10:30Z",
                intensity: { forecast: 120, index: "moderate" },
                generationmix: [
                  { fuel: "solar", perc: 0 },
                  { fuel: "gas", perc: 30 },
                  { fuel: "wind", perc: 70 },
                ],
              },
            ],
          },
        },
      },
    });

    expect(await getRegionalForecast("SW1A", now)).toEqual({
      region: "London",
      slots: [
        {
          from: "2026-01-01T10:00Z",
          to: "2026-01-01T10:30Z",
          forecast: 120,
          actual: null,
          index: "moderate",
        },
      ],
      mix: [
        { fuel: "wind", perc: 70 },
        { fuel: "gas", perc: 30 },
      ],
    });
  });

  it("fetches the forecast by region so postcodes in a region share a cache entry", async () => {
    const fetchMock = stubApi({
      [LOOKUP]: found,
      [`${API}/regional/postcode/EC1A`]: found,
      [FORECAST]: {
        status: 200,
        body: { data: { shortname: "London", data: [] } },
      },
    });

    await getRegionalForecast("SW1A", now);
    await getRegionalForecast("EC1A", now);

    const revalidate = (url: string) =>
      fetchMock.mock.calls.find((call) => call[0] === url)?.[1]?.next?.revalidate;
    const forecastCalls = fetchMock.mock.calls.filter(([url]) =>
      url.includes("/fw48h/"),
    );
    expect(forecastCalls.map(([url]) => url)).toEqual([FORECAST, FORECAST]);
    // The forecast changes half-hourly; a postcode's region doesn't.
    expect(revalidate(FORECAST)).toBe(5 * 60);
    expect(revalidate(LOOKUP)).toBe(7 * 24 * 60 * 60);
  });

  it("returns null when the API doesn't know the postcode", async () => {
    const fetchMock = stubApi({
      [`${API}/regional/postcode/ZZ99`]: { status: 400, body: { error: {} } },
    });
    expect(await getRegionalForecast("ZZ99", now)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the region has no forecast", async () => {
    stubApi({ [LOOKUP]: found, [FORECAST]: { status: 200, body: null } });
    expect(await getRegionalForecast("SW1A", now)).toBeNull();
  });

  it("throws when the API fails", async () => {
    stubApi({ [LOOKUP]: { status: 500, body: null } });
    await expect(getRegionalForecast("SW1A", now)).rejects.toThrow("500");

    stubApi({ [LOOKUP]: found, [FORECAST]: { status: 500, body: null } });
    await expect(getRegionalForecast("SW1A", now)).rejects.toThrow("500");
  });
});
