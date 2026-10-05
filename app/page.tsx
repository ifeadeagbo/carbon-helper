import { cookies } from "next/headers";
import {
  INDEX_COLOR,
  getForecast,
  getGenerationMix,
  getRegionalForecast,
  parseOutwardCode,
} from "@/lib/carbon";
import { POSTCODE_COOKIE } from "@/lib/postcode-cookie";
import { clearPostcode, savePostcode } from "./actions";
import { averageIntensity, findBestWindow } from "@/lib/planner";
import { PLANNER_COOKIE, parsePlannerPrefs } from "@/lib/planner-prefs";
import { Planner } from "./planner";

const RECOMMENDED_APPLIANCE = {
  id: "washer",
  label: "Washing machine",
  slots: 3,
  kwh: 0.8,
};

const dayTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

/** Loads the forecast for the postcode's region, or for Great Britain (region: null). */
async function loadData(outwardCode: string | null) {
  try {
    if (outwardCode) {
      const regional = await getRegionalForecast(outwardCode);
      if (regional && regional.slots.length > 0) return regional;
    }
    const [slots, mix] = await Promise.all([getForecast(), getGenerationMix()]);
    return slots.length > 0 ? { region: null, slots, mix } : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const { postcode } = await searchParams;
  // A postcode in the URL wins over the remembered one.
  const cookieStore = await cookies();
  const remembered = cookieStore.get(POSTCODE_COOKIE)?.value;
  const plannerPrefs = parsePlannerPrefs(cookieStore.get(PLANNER_COOKIE)?.value);
  const query =
    ((Array.isArray(postcode) ? postcode[0] : postcode) ?? remembered)?.trim() ??
    "";
  const outwardCode = parseOutwardCode(query);
  const data = await loadData(outwardCode);
  const summary =
    data && data.slots.length > 0
      ? (() => {
          const best = findBestWindow(
            data.slots.slice(0, 48 * 2),
            RECOMMENDED_APPLIANCE.slots,
          );
          if (!best) return null;
          const nowAverage = averageIntensity(data.slots.slice(0, best.length));
          const savedGrams = Math.round((nowAverage - best.average) * RECOMMENDED_APPLIANCE.kwh);
          const first = data.slots[best.start];
          const last = data.slots[best.start + best.length - 1];
          return {
            best,
            savedGrams,
            first,
            last,
          };
        })()
      : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <header className="rounded-2xl border border-grid bg-background/80 p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex rounded-full border border-grid px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-muted">
            Live UK grid advice
          </span>
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          Shift your home to cleaner energy.
        </h1>
        <p className="mt-3 max-w-2xl text-base text-muted sm:text-lg">
          See when Britain&apos;s electricity is greenest and run your washing,
          drying, dishwashing or EV charging at the right moment.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-grid bg-background p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted">
              Live data
            </p>
            <p className="mt-2 text-lg font-semibold">Half-hourly forecasts</p>
          </div>
          <div className="rounded-xl border border-grid bg-background p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted">
              Local insight
            </p>
            <p className="mt-2 text-lg font-semibold">Postcode-aware advice</p>
          </div>
          <div className="rounded-xl border border-grid bg-background p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted">
              Lower impact
            </p>
            <p className="mt-2 text-lg font-semibold">Less CO₂ without changing plans</p>
          </div>
        </div>
      </header>

      <form action={savePostcode} className="flex flex-col gap-2 rounded-2xl border border-grid bg-background/60 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-muted">
            Your postcode
            <input
              name="postcode"
              defaultValue={outwardCode ?? query}
              placeholder="e.g. SW1A"
              autoComplete="postal-code"
              maxLength={8}
              className="w-36 rounded-md border border-grid bg-background px-3 py-2 text-base text-foreground uppercase placeholder:normal-case"
            />
          </label>
          <button
            type="submit"
            className="rounded-md border border-grid bg-foreground px-4 py-2 text-base text-background"
          >
            Use my area
          </button>
          {query && (
            <button
              type="submit"
              formAction={clearPostcode}
              className="cursor-pointer py-2 text-sm text-muted underline"
            >
              Show all of Great Britain
            </button>
          )}
        </div>
        {query && data && data.region === null && (
          <p className="text-sm" role="status">
            {outwardCode
              ? `No region found for ${outwardCode}.`
              : "That doesn't look like a UK postcode."}{" "}
            Showing Great Britain instead.
          </p>
        )}
      </form>

      {data ? (
        <>
          <section className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              {data.region
                ? `Forecast carbon intensity in ${data.region} right now`
                : "Grid carbon intensity right now"}
            </p>
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-5xl font-semibold tabular-nums">
                {data.slots[0].actual ?? data.slots[0].forecast}
              </span>
              <span className="text-muted">gCO₂/kWh</span>
              <span className="flex items-center gap-1.5 capitalize">
                <span
                  className="size-3 rounded-full"
                  style={{ background: INDEX_COLOR[data.slots[0].index] }}
                />
                {data.slots[0].index}
              </span>
            </p>
            <p className="text-sm text-muted">
              {data.mix
                .slice(0, 5)
                .map((share) => `${share.fuel} ${Math.round(share.perc)}%`)
                .join(" · ")}
            </p>
          </section>

          {summary && (
            <section className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-grid bg-background p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-muted">
                  Current grid
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {data.slots[0].actual ?? data.slots[0].forecast}
                </p>
                <p className="mt-1 text-sm text-muted">gCO₂/kWh right now</p>
              </div>
              <div className="rounded-xl border border-grid bg-background p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-muted">
                  Best window
                </p>
                <p className="mt-2 text-lg font-semibold">
                  {dayTime(summary.first.from)}
                </p>
                <p className="mt-1 text-sm text-muted">
                  until {dayTime(summary.last.to)}
                </p>
              </div>
              <div className="rounded-xl border border-grid bg-background p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-muted">
                  Potential saving
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {summary.savedGrams.toLocaleString("en-GB")}
                </p>
                <p className="mt-1 text-sm text-muted">g CO₂ for a wash cycle</p>
              </div>
            </section>
          )}

          <Planner slots={data.slots} initialPrefs={plannerPrefs} />
        </>
      ) : (
        <p>
          Couldn&apos;t reach the Carbon Intensity API just now. Try again in a
          minute.
        </p>
      )}

      <footer className="text-xs text-muted">
        Data from the{" "}
        <a className="underline" href="https://carbonintensity.org.uk">
          National Energy System Operator Carbon Intensity API
        </a>
        . Appliance energy figures are typical values.
      </footer>
    </main>
  );
}
