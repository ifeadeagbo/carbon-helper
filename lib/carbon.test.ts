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

  function stubApi(body: unknown, ok = true) {
    const fetchMock = vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("returns the region's upcoming slots and current mix", async () => {
    const fetchMock = stubApi({
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
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.carbonintensity.org.uk/regional/intensity/2026-01-01T10:00Z/fw48h/postcode/SW1A",
      expect.anything(),
    );
  });

  it("returns null when the API doesn't know the postcode", async () => {
    stubApi(null);
    expect(await getRegionalForecast("ZZ99", now)).toBeNull();
  });

  it("throws when the API fails", async () => {
    stubApi(null, false);
    await expect(getRegionalForecast("SW1A", now)).rejects.toThrow("500");
  });
});
