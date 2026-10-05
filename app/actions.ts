"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getRegionalForecast, parseOutwardCode } from "@/lib/carbon";
import { POSTCODE_COOKIE } from "@/lib/postcode-cookie";

const ONE_YEAR_S = 365 * 24 * 60 * 60;

/** Remembers the submitted postcode if it maps to a region, then shows it. */
export async function savePostcode(formData: FormData) {
  const input = String(formData.get("postcode") ?? "").trim();
  if (!input) redirect("/");

  const outwardCode = parseOutwardCode(input);
  // Only remember postcodes the API recognises; the page reports the rest.
  const known =
    outwardCode !== null &&
    (await getRegionalForecast(outwardCode).catch(() => null)) !== null;
  if (known) {
    (await cookies()).set(POSTCODE_COOKIE, outwardCode, {
      maxAge: ONE_YEAR_S,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  redirect(`/?postcode=${encodeURIComponent(outwardCode ?? input)}`);
}

/** Forgets the remembered postcode and goes back to Great Britain. */
export async function clearPostcode() {
  (await cookies()).delete(POSTCODE_COOKIE);
  redirect("/");
}
