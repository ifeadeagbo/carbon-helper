import { getForecast, getGenerationMix } from "@/lib/carbon";
import { INDEX_COLOR, Planner } from "./planner";

async function loadData() {
  try {
    const [slots, mix] = await Promise.all([getForecast(), getGenerationMix()]);
    return slots.length > 0 ? { slots, mix } : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

export default async function Home() {
  const data = await loadData();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-12 sm:px-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Carbon Helper</h1>
        <p className="mt-1 text-muted">
          Run your appliances when Great Britain&apos;s electricity is cleanest.
        </p>
      </header>

      {data ? (
        <>
          <section className="flex flex-col gap-3">
            <p className="text-sm text-muted">Grid carbon intensity right now</p>
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
