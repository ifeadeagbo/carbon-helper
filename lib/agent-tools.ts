import type Anthropic from "@anthropic-ai/sdk";
import { APPLIANCES, CUSTOM_ID, MAX_CUSTOM_KWH } from "./appliances";
import { calendarHref } from "./calendar";
import {
  getForecast,
  getGenerationMix,
  getRegionalForecast,
  parseOutwardCode,
} from "./carbon";
import { findBestWindow, windowStats } from "./planner";
import { MAX_CUSTOM_SLOTS } from "./planner-prefs";

const MAX_HOURS = 48;
const SLOT_MINUTES = 30;

/**
 * A failure the model can do something about. Its message is sent back as the
 * tool result, so write it for the model: say what was wrong and what to try.
 */
export class ToolError extends Error {}

export type AgentTool = {
  /** What the model sees: name, description and input schema. */
  definition: Anthropic.Beta.BetaTool;
  /** What the server runs. The result is sent to the model as JSON. */
  run: (input: Record<string, unknown>) => Promise<unknown>;
};

// Fixed locale and time zone: the model is told every time is UK local time.
const localTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
/** "Wed 7 Oct, 14:30" */
export const ukTime = (date: string | Date) => localTime.format(new Date(date));

// The schemas run in strict mode, which guarantees the shape of the input but
// can't express ranges, so those are checked here.
function wholeNumber(value: unknown, name: string, min: number, max: number) {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ToolError(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return value as number;
}

/** Loads the forecast for a postcode's region, or for Great Britain when it is null. */
async function loadArea(postcode: unknown) {
  if (postcode === null) {
    return { area: "Great Britain", slots: await getForecast(), mix: null };
  }
  const outwardCode =
    typeof postcode === "string" ? parseOutwardCode(postcode) : null;
  if (!outwardCode) {
    throw new ToolError(
      "That is not a UK postcode. Ask the user for theirs, or pass null for Great Britain.",
    );
  }
  const regional = await getRegionalForecast(outwardCode);
  if (!regional) {
    throw new ToolError(
      `No region found for ${outwardCode}. Pass null for Great Britain instead.`,
    );
  }
  return { area: regional.region, slots: regional.slots, mix: regional.mix };
}

const POSTCODE_PROPERTY = {
  type: ["string", "null"],
  description:
    'UK postcode or just its first half, e.g. "SW1A", for regional figures. Null for Great Britain as a whole.',
};

const getCurrentIntensity: AgentTool = {
  definition: {
    name: "get_current_intensity",
    description:
      "Carbon intensity of the electricity grid for the current half hour, in gCO2 per kWh, with its band (very low to very high) and the generation mix by fuel. Use it for questions about how clean the grid is right now.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { postcode: POSTCODE_PROPERTY },
      required: ["postcode"],
      additionalProperties: false,
    },
  },
  async run({ postcode }) {
    const { area, slots, mix } = await loadArea(postcode);
    const current = slots[0];
    if (!current) throw new ToolError("No forecast is available right now.");
    return {
      area,
      from: ukTime(current.from),
      to: ukTime(current.to),
      gco2_per_kwh: current.forecast,
      band: current.index,
      generation_mix_percent: mix ?? (await getGenerationMix()),
    };
  },
};

const getForecastTool: AgentTool = {
  definition: {
    name: "get_forecast",
    description:
      "Half-hourly carbon intensity forecast, starting with the current half hour. Use it for questions about how the grid changes over time, such as when it is dirtiest or what tomorrow morning looks like. To pick a time to run something, use find_greenest_window instead: it does the arithmetic.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        postcode: POSTCODE_PROPERTY,
        hours: {
          type: "integer",
          description: `How many hours ahead to return, from 1 to ${MAX_HOURS}.`,
        },
      },
      required: ["postcode", "hours"],
      additionalProperties: false,
    },
  },
  async run({ postcode, hours }) {
    const count = wholeNumber(hours, "hours", 1, MAX_HOURS) * 2;
    const { area, slots } = await loadArea(postcode);
    return {
      area,
      slot_minutes: SLOT_MINUTES,
      slots: slots.slice(0, count).map((slot) => ({
        from: ukTime(slot.from),
        gco2_per_kwh: slot.forecast,
        band: slot.index,
      })),
    };
  },
};

const findGreenestWindow: AgentTool = {
  definition: {
    name: "find_greenest_window",
    description:
      "Finds the start time with the lowest average carbon intensity for running an appliance, and how much CO2 that saves compared with starting now. Use it whenever the user asks when to run, charge or start something.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        postcode: POSTCODE_PROPERTY,
        appliance: {
          type: "string",
          enum: [...APPLIANCES.map((a) => a.id), CUSTOM_ID],
          description: `${APPLIANCES.map((a) => `"${a.id}" is ${a.label.toLowerCase()}`).join(", ")}. These use typical run times and energy figures. Use "${CUSTOM_ID}" for anything else.`,
        },
        custom_minutes: {
          type: ["integer", "null"],
          description: `Run time for a "${CUSTOM_ID}" appliance: a multiple of ${SLOT_MINUTES}, up to ${MAX_CUSTOM_SLOTS * SLOT_MINUTES}. Null otherwise.`,
        },
        custom_kwh: {
          type: ["number", "null"],
          description: `Energy one run of a "${CUSTOM_ID}" appliance uses, in kWh, up to ${MAX_CUSTOM_KWH}. Null if unknown; the CO2 saving is then left out.`,
        },
        within_hours: {
          type: "integer",
          description: `The run must finish within this many hours from now, from 1 to ${MAX_HOURS}. Use 24 unless the user says otherwise.`,
        },
      },
      required: [
        "postcode",
        "appliance",
        "custom_minutes",
        "custom_kwh",
        "within_hours",
      ],
      additionalProperties: false,
    },
  },
  async run({ postcode, appliance, custom_minutes, custom_kwh, within_hours }) {
    const horizon = wholeNumber(within_hours, "within_hours", 1, MAX_HOURS);
    const known = APPLIANCES.find((a) => a.id === appliance);
    let length: number;
    let kwh: number | null;
    if (known) {
      ({ slots: length, kwh } = known);
    } else if (appliance === CUSTOM_ID) {
      const minutes = wholeNumber(
        custom_minutes,
        "custom_minutes",
        SLOT_MINUTES,
        MAX_CUSTOM_SLOTS * SLOT_MINUTES,
      );
      if (minutes % SLOT_MINUTES !== 0) {
        throw new ToolError(
          `custom_minutes must be a multiple of ${SLOT_MINUTES}. Round up.`,
        );
      }
      length = minutes / SLOT_MINUTES;
      if (
        custom_kwh !== null &&
        !(typeof custom_kwh === "number" && custom_kwh > 0 && custom_kwh <= MAX_CUSTOM_KWH)
      ) {
        throw new ToolError(
          `custom_kwh must be above 0 and at most ${MAX_CUSTOM_KWH}, or null.`,
        );
      }
      kwh = custom_kwh;
    } else {
      throw new ToolError("Unknown appliance.");
    }

    const { area, slots } = await loadArea(postcode);
    const visible = slots.slice(0, horizon * 2);
    const best = findBestWindow(visible, length);
    if (!best) {
      throw new ToolError(
        "The run does not fit in that many hours. Use a longer within_hours.",
      );
    }
    const { nowAverage, savedGrams, savedPercent, first, last } = windowStats({
      slots: visible,
      best,
      kwh,
    });
    const startsNow = best.start === 0;
    return {
      area,
      appliance: known?.label ?? "Custom appliance",
      run_minutes: length * SLOT_MINUTES,
      starts_now: startsNow,
      start: ukTime(first.from),
      end: ukTime(last.to),
      average_gco2_per_kwh: Math.round(best.average),
      if_started_now_gco2_per_kwh: Math.round(nowAverage),
      // A regional forecast can be zero throughout, which has no percentage.
      percent_cleaner_than_now: nowAverage > 0 ? savedPercent : 0,
      co2_saved_grams: savedGrams,
      // The chat page turns this into an "Add to calendar" button.
      calendar_link: startsNow
        ? null
        : calendarHref(first.from, last.to, String(appliance)),
    };
  },
};

export const TOOLS: AgentTool[] = [
  getCurrentIntensity,
  getForecastTool,
  findGreenestWindow,
];
