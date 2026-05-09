// PlainOrder — per-IP daily rate limiter backed by Cloudflare KV.
//
// Key shape: `rl:<YYYY-MM-DD>:<ipHash>` -> integer count.
// Each successful translation increments by 1 (with TTL = 36h so the
// key expires naturally; we don't need the count to live longer than
// the day-bucket).
//
// If the KV binding is missing (local dev without RATELIMIT) we
// short-circuit to "allow" so the dev loop isn't blocked on infra
// setup. A warning is logged.

const DAILY_CAP = 5;
const KV_TTL_SECONDS = 36 * 60 * 60;

export interface RateLimitEnv {
  RATELIMIT?: KVNamespace;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  reason?: string;
}

export async function checkAndConsume(
  env: RateLimitEnv,
  request: Request,
): Promise<RateLimitDecision> {
  if (!env.RATELIMIT) {
    console.warn('plainorder: RATELIMIT KV binding missing — allowing request without limit');
    return { allowed: true, remaining: DAILY_CAP - 1 };
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = await sha256Hex(ip);
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${day}:${ipHash}`;
  const raw = await env.RATELIMIT.get(key);
  const current = raw ? parseInt(raw, 10) || 0 : 0;
  if (current >= DAILY_CAP) {
    return {
      allowed: false,
      remaining: 0,
      reason: `daily cap of ${DAILY_CAP} translations reached`,
    };
  }
  const next = current + 1;
  await env.RATELIMIT.put(key, String(next), { expirationTtl: KV_TTL_SECONDS });
  return { allowed: true, remaining: DAILY_CAP - next };
}

async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
