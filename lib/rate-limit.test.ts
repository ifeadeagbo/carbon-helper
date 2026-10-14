import { afterEach, describe, expect, it, vi } from "vitest";
import { type Limiter, checkChatLimits, visitorId } from "./rate-limit";

type Response = Awaited<ReturnType<Limiter["limit"]>>;

/** A limiter that gives the same answer every time and records who it counted. */
function fakeLimiter(answer: Partial<Response> | Error) {
  const counted: string[] = [];
  const limiter: Limiter = {
    limit: async (id: string) => {
      counted.push(id);
      if (answer instanceof Error) throw answer;
      return { success: true, limit: 10, remaining: 9, reset: 0, pending: Promise.resolve(), ...answer };
    },
  };
  return Object.assign(limiter, { counted });
}

afterEach(() => vi.restoreAllMocks());

describe("checkChatLimits", () => {
  it("allows a question while both limits have room, counting it against both", async () => {
    const visitor = fakeLimiter({ success: true });
    const site = fakeLimiter({ success: true });

    expect(await checkChatLimits("1.2.3.4", { visitor, site })).toEqual({ allowed: true });
    expect(visitor.counted).toEqual(["1.2.3.4"]);
    expect(site.counted).toEqual(["all"]);
  });

  it("refuses a visitor over their limit without using up the site's", async () => {
    const visitor = fakeLimiter({ success: false });
    const site = fakeLimiter({ success: true });

    expect(await checkChatLimits("1.2.3.4", { visitor, site })).toEqual({
      allowed: false,
      reason: "visitor",
    });
    expect(site.counted).toEqual([]);
  });

  it("refuses everyone once the site's limit is reached", async () => {
    const visitor = fakeLimiter({ success: true });
    const site = fakeLimiter({ success: false });

    expect(await checkChatLimits("1.2.3.4", { visitor, site })).toEqual({
      allowed: false,
      reason: "site",
    });
  });

  it("refuses when the store times out, although Upstash then reports success", async () => {
    for (const limiters of [
      { visitor: fakeLimiter({ success: true, reason: "timeout" }), site: fakeLimiter({}) },
      { visitor: fakeLimiter({}), site: fakeLimiter({ success: true, reason: "timeout" }) },
    ]) {
      expect(await checkChatLimits("1.2.3.4", limiters)).toEqual({
        allowed: false,
        reason: "unavailable",
      });
    }
  });

  it("refuses when the store can't be reached", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("fetch failed");

    expect(
      await checkChatLimits("1.2.3.4", { visitor: fakeLimiter(failure), site: fakeLimiter({}) }),
    ).toEqual({ allowed: false, reason: "unavailable" });
    expect(logged).toHaveBeenCalledWith(failure);
  });
});

describe("visitorId", () => {
  it("takes the first address the proxy reports", () => {
    expect(visitorId(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });

  it("puts visitors with no address in one shared bucket", () => {
    expect(visitorId(new Headers())).toBe("unknown");
  });
});
