# Carbon Helper

Find the greenest time to run your appliances. Carbon Helper reads the half-hourly forecast for Great Britain's electricity grid and tells you when a washing machine, dishwasher, tumble dryer or EV charge would cause the least CO₂.

**Live app:** [carbon-helper.vercel.app](https://carbon-helper.vercel.app)

## What it shows

- The grid's carbon intensity right now (gCO₂/kWh) and the current generation mix.
- The same for your own region if you enter a postcode (`/?postcode=SW1A`). Regional figures are forecasts; an unrecognised postcode falls back to Great Britain. A postcode you submit is remembered in a cookie for a year, until you choose "Show all of Great Britain".
- The cleanest window to start a chosen appliance within the next 12, 24 or 48 hours, and how much CO₂ that saves compared with starting now.
- An "Add to calendar" button that downloads the best window as a calendar event with a reminder.
- The forecast as a bar chart, with the best window highlighted, and as a table.

Appliance energy figures are typical values per cycle; real appliances vary. Choose "Something else…" to enter your own run time and energy use; your appliance choice, those figures and the "finishing within" setting are remembered in a cookie.

## Running it

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). No API key or environment variables are needed.

Other scripts: `npm run build`, `npm run start`, `npm run lint`, `npm test`.

## How it works

- `lib/carbon.ts` fetches the national and regional forecasts and generation mix from the [Carbon Intensity API](https://carbonintensity.org.uk), run by the National Energy System Operator. Responses are cached for five minutes. A postcode is first resolved to one of the 14 regions (cached for a week) and the forecast is fetched per region, so visitors across a region share one cached forecast.
- `lib/planner.ts` finds the run of consecutive half-hour slots with the lowest average forecast intensity.
- `app/page.tsx` renders the current figures on the server; `app/planner.tsx` is the interactive planner.

Built with Next.js 16, React 19 and Tailwind CSS 4.
