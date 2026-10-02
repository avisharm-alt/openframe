// Small in-memory sliding-window limiter. Suitable for a single-process deployment;
// document/replace with a shared store if you run several instances.
import { ServiceError } from "./errors";

const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const t = Date.now();
  const hits = (buckets.get(key) ?? []).filter((x) => t - x < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    throw new ServiceError(429, "rate_limited", "Too many requests. Please try again later.");
  }
  hits.push(t);
  buckets.set(key, hits);
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) if (!v.some((x) => t - x < windowMs)) buckets.delete(k);
  }
}

export function resetRateLimits() {
  buckets.clear();
}
