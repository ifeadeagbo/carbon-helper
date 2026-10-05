import Form from "next/form";
import Link from "next/link";
import {
  getForecast,
  getGenerationMix,
  getRegionalForecast,
  parseOutwardCode,
} from "@/lib/carbon";
import { INDEX_COLOR, Planner } from "./planner";

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
  const query = (Array.isArray(postcode) ? postcode[0] : postcode)?.trim() ?? "";
  const outwardCode = parseOutwardCode(query);
  const data = await loadData(outwardCode);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-12 sm:px-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Carbon Helper</h1>
        <p className="mt-1 text-muted">
          Run your appliances when Great Britain&apos;s electricity is cleanest.
        </p>
      </header>

      <Form action="/" className="flex flex-col gap-2">
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
            className="rounded-md border border-grid px-4 py-2 text-base"
          >
            Use my area
          </button>
          {query && (
            <Link href="/" className="py-2 text-sm text-muted underline">
              Show all of Great Britain
            </Link>
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
      </Form>

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

          <Planner slots={data.slots} />
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
