/**
 * Minimal sliding-window rate limiter (no dependencies).
 *
 * Public-demo safeguard: the extractive engine costs nothing to run, but a
 * public URL still needs protection from abusive loops. Limits are generous —
 * a human exploring the demo never hits them.
 *
 * Per-IP limits (behind a reverse proxy, express 'trust proxy' must be on):
 *   /api/query  → 20 requests / 60 s   (burst 5 / 10 s)
 *   /api/*      → 120 requests / 60 s
 */
const buckets = new Map();

function prune(now) {
  if (buckets.size < 5000) return;
  for (const [k, v] of buckets) {
    if (now - v.windowStart > 60000 && now - v.burstStart > 10000) buckets.delete(k);
  }
}

function rateLimit({ windowMs = 60000, max = 120, burstMs = 10000, burstMax = 40, key = 'global' }) {
  return (req, res, next) => {
    const now = Date.now();
    prune(now);
    const ip = (req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
    const id = `${key}:${ip}`;
    let b = buckets.get(id);
    if (!b || now - b.windowStart > windowMs) {
      b = { windowStart: now, count: 0, burstStart: now, burstCount: 0 };
      buckets.set(id, b);
    }
    if (now - b.burstStart > burstMs) {
      b.burstStart = now;
      b.burstCount = 0;
    }
    b.count += 1;
    b.burstCount += 1;
    res.setHeader('x-ratelimit-limit', max);
    res.setHeader('x-ratelimit-remaining', Math.max(0, max - b.count));
    if (b.count > max || b.burstCount > burstMax) {
      const retryAfter = Math.ceil((windowMs - (now - b.windowStart)) / 1000);
      res.setHeader('retry-after', Math.min(retryAfter, 60));
      return res.status(429).json({
        error: 'Too many requests — the demo is rate-limited to stay available for everyone. Try again in a minute.',
      });
    }
    next();
  };
}

module.exports = { rateLimit };
