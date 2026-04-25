import { jsonResponse } from "./http";

interface RateLimitRule {
  method: string;
  path: string;
  windowMs: number;
  maxRequests: number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_RULES: RateLimitRule[] = [
  {
    method: "GET",
    path: "/api/health",
    windowMs: 60_000,
    maxRequests: 120
  },
  {
    method: "GET",
    path: "/api/apple/developer-token",
    windowMs: 60_000,
    maxRequests: 60
  },
  {
    method: "POST",
    path: "/api/pairing/start",
    windowMs: 60_000,
    maxRequests: 20
  },
  {
    method: "POST",
    path: "/api/spotify/pairing/start",
    windowMs: 60_000,
    maxRequests: 20
  },
  {
    method: "POST",
    path: "/api/pairing/complete",
    windowMs: 60_000,
    maxRequests: 40
  },
  {
    method: "GET",
    path: "/api/pairing/status",
    windowMs: 60_000,
    maxRequests: 180
  },
  {
    method: "GET",
    path: "/api/spotify/pairing/status",
    windowMs: 60_000,
    maxRequests: 180
  }
];

const buckets = new Map<string, RateLimitBucket>();

export function rateLimitResponse(request: Request): Response | undefined {
  const rule = findRule(request);
  if (!rule) {
    return undefined;
  }

  const now = Date.now();
  removeExpiredBuckets(now);

  const bucketKey = createBucketKey(request, rule);
  const bucket =
    buckets.get(bucketKey) ?? {
      count: 0,
      resetAt: now + rule.windowMs
    };

  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + rule.windowMs;
  }

  if (bucket.count >= rule.maxRequests) {
    buckets.set(bucketKey, bucket);
    return jsonResponse(
      {
        error: "Too many requests",
        retryAfterSeconds: retryAfterSeconds(bucket, now)
      },
      {
        status: 429,
        headers: rateLimitHeaders(rule, bucket, now)
      }
    );
  }

  bucket.count += 1;
  buckets.set(bucketKey, bucket);
  return undefined;
}

export function clearRateLimitBuckets(): void {
  buckets.clear();
}

function findRule(request: Request): RateLimitRule | undefined {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  return RATE_LIMIT_RULES.find(
    (rule) => rule.method === method && rule.path === url.pathname
  );
}

function createBucketKey(
  request: Request,
  rule: RateLimitRule
): string {
  const url = new URL(request.url);
  return [
    clientAddress(request),
    rule.method,
    url.pathname
  ].join(":");
}

function clientAddress(request: Request): string {
  const connectingIp = request.headers.get("cf-connecting-ip")?.trim();
  if (connectingIp) {
    return connectingIp;
  }

  const forwardedFor = request.headers.get("x-forwarded-for")?.trim();
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return "unknown";
}

function removeExpiredBuckets(now: number): void {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

function rateLimitHeaders(
  rule: RateLimitRule,
  bucket: RateLimitBucket,
  now: number
): HeadersInit {
  const retryAfter = retryAfterSeconds(bucket, now).toString();
  return {
    "retry-after": retryAfter,
    "x-ratelimit-limit": rule.maxRequests.toString(),
    "x-ratelimit-remaining": "0",
    "x-ratelimit-reset": Math.ceil(bucket.resetAt / 1000).toString()
  };
}

function retryAfterSeconds(
  bucket: RateLimitBucket,
  now: number
): number {
  return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
}
