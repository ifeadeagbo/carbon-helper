import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRegionalForecast } from "@/lib/carbon";
import { clearPostcode, savePostcode } from "./actions";

const { cookieStore, Redirect } = vi.hoisted(() => {
  // Like Next's redirect(), ours throws so the action stops where it's called.
  class Redirect extends Error {
    constructor(public url: string) {
      super(`redirect to ${url}`);
    }
  }
  return { cookieStore: { set: vi.fn(), delete: vi.fn() }, Redirect };
});

vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("@/lib/carbon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/carbon")>()),
  getRegionalForecast: vi.fn(),
}));

const regionalForecast = vi.mocked(getRegionalForecast);

/** Runs an action and returns the URL it redirected to. */
async function redirectOf(action: Promise<void>): Promise<string> {
  const error = await action.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof Redirect)) throw error ?? new Error("no redirect");
  return error.url;
}

function submit(postcode?: string) {
  const formData = new FormData();
  if (postcode !== undefined) formData.set("postcode", postcode);
  return redirectOf(savePostcode(formData));
}

beforeEach(() => {
  vi.clearAllMocks();
  regionalForecast.mockResolvedValue({ region: "London", slots: [], mix: [] });
});

describe("savePostcode", () => {
  it("remembers the outward code of a known postcode for a year", async () => {
    expect(await submit(" eh1 1bb ")).toBe("/?postcode=EH1");
    expect(regionalForecast).toHaveBeenCalledWith("EH1");
    expect(cookieStore.set).toHaveBeenCalledWith(
      "postcode",
      "EH1",
      expect.objectContaining({
        maxAge: 365 * 24 * 60 * 60,
        httpOnly: true,
        sameSite: "lax",
      }),
    );
  });

  it("doesn't remember a postcode the API has no region for", async () => {
    regionalForecast.mockResolvedValue(null);
    expect(await submit("ZZ99")).toBe("/?postcode=ZZ99");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("doesn't remember anything when the API fails", async () => {
    regionalForecast.mockRejectedValue(new Error("API down"));
    expect(await submit("SW1A")).toBe("/?postcode=SW1A");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("passes malformed input through for the page to report", async () => {
    expect(await submit("not a postcode?")).toBe(
      "/?postcode=not%20a%20postcode%3F",
    );
    expect(regionalForecast).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("goes back to the home page for an empty or missing postcode", async () => {
    expect(await submit("   ")).toBe("/");
    expect(await submit()).toBe("/");
    expect(regionalForecast).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});

describe("clearPostcode", () => {
  it("forgets the postcode and returns to Great Britain", async () => {
    expect(await redirectOf(clearPostcode())).toBe("/");
    expect(cookieStore.delete).toHaveBeenCalledWith("postcode");
  });
});
