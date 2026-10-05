import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, parsePlannerPrefs } from "./planner-prefs";

describe("parsePlannerPrefs", () => {
  it("returns the defaults when there is no cookie", () => {
    expect(parsePlannerPrefs(undefined)).toEqual(DEFAULT_PREFS);
  });

  it("reads saved choices", () => {
    const saved = { applianceId: "custom", customSlots: 5, customKwh: "2.4" };
    expect(parsePlannerPrefs(JSON.stringify(saved))).toEqual(saved);
  });

  it("keeps an energy figure that is still being typed", () => {
    const raw = JSON.stringify({ ...DEFAULT_PREFS, customKwh: "" });
    expect(parsePlannerPrefs(raw).customKwh).toBe("");
  });

  it("falls back to the defaults for malformed input", () => {
    expect(parsePlannerPrefs("not json")).toEqual(DEFAULT_PREFS);
    expect(parsePlannerPrefs("null")).toEqual(DEFAULT_PREFS);
    expect(parsePlannerPrefs("[1,2]")).toEqual(DEFAULT_PREFS);
  });

  it("replaces only the fields that are out of range", () => {
    const raw = JSON.stringify({
      applianceId: "<script>",
      customSlots: 99,
      customKwh: "3",
    });
    expect(parsePlannerPrefs(raw)).toEqual({ ...DEFAULT_PREFS, customKwh: "3" });
    expect(
      parsePlannerPrefs(JSON.stringify({ customSlots: 1.5, customKwh: "1e9" })),
    ).toEqual(DEFAULT_PREFS);
  });
});
