import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/** Questions one visitor can ask in a day. */
export const VISITOR_DAILY_LIMIT = 10;
/** Questions the whole site answers in a day, whoever asks. */
export const SITE_DAILY_LIMIT = 50;
// Give up on the store after this long, and refuse the question.
const STORE_TIMEOUT_MS = 3000;

/** The part of an Upstash limiter the check uses, so tests can fake it. */
export type Limiter = Pick<Ratelimit, "limit">;

export type LimitCheck =
  | { allowed: true }
  | { allowed: false; reason: "visitor" | "site" | "unavailable" };

/**
 * Counts one question against the visitor's limit, then the site's. A
 * visitor already over their limit doesn't use up the site's.
 * Fails closed: if the store can't be reached, the question is refused,
 * because answering it would spend credit with nothing counting it.
 */
export async function checkChatLimits(
  visitor: string,
  limiters: { visitor: Limiter; site: Limiter },
): Promise<LimitCheck> {
  try {
    const perVisitor = await limiters.visitor.limit(visitor);
    // On a timeout Upstash answers success, so it has to be checked separately.
    if (perVisitor.reason === "timeout") return { allowed: false, reason: "unavailable" };
    if (!perVisitor.success) return { allowed: false, reason: "visitor" };

    const site = await limiters.site.limit("all");
    if (site.reason === "timeout") return { allowed: false, reason: "unavailable" };
    if (!site.success) return { allowed: false, reason: "site" };
    return { allowed: true };
  } catch (error) {
    console.error(error);
    return { allowed: false, reason: "unavailable" };
  }
}

/** Who is asking: the visitor's IP address as Vercel reports it. */
export function visitorId(headers: Headers): string {
  // Vercel sets this header itself, so a visitor can't choose their own value.
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

/**
 * The limiters backed by the Upstash database, or null when it isn't
 * configured. Reads UPSTASH_REDIS_REST_URL and _TOKEN, or the KV_REST_API_
 * names Vercel's integration uses.
 */
export function chatLimiters(): { visitor: Limiter; site: Limiter } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  const redis = new Redis({ url, token });
  return {
    visitor: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(VISITOR_DAILY_LIMIT, "1 d"),
      prefix: "chat:visitor",
      timeout: STORE_TIMEOUT_MS,
    }),
    site: new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(SITE_DAILY_LIMIT, "1 d"),
      prefix: "chat:site",
      timeout: STORE_TIMEOUT_MS,
    }),
  };
}
