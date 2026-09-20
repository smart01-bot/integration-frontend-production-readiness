/**
 * API hygiene middleware — audit gaps 19 (unbounded pagination, no rate limits).
 *
 * clampPagination: caps `?limit=` and `?page=` so no list endpoint can be
 * driven into an unbounded table scan. Controllers read req.pagination which
 * is ALWAYS defined: { page, limit, offset } with sane defaults.
 *
 * Rate limiters: the PayMe webhook had one; public social writes and hot
 * list endpoints did not. These tiers match a community app: generous for
 * reads, tight enough to make feed-spam loops useless.
 */
import rateLimit from 'express-rate-limit';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const MAX_PAGE = 10_000;

export function clampPagination(req, _res, next) {
  const rawLimit = parseInt(req.query.limit, 10);
  const rawPage = parseInt(req.query.page, 10);

  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;
  const page = Number.isFinite(rawPage) && rawPage > 0
    ? Math.min(rawPage, MAX_PAGE)
    : 1;

  req.pagination = { page, limit, offset: (page - 1) * limit };
  next();
}

const json = (msg) => ({ error: msg });

// Hot public reads — protects the DB from scrape loops.
export const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many requests. Slow down.')
});

// Community writes (posts, comments, reactions, reports) — the spam faucet.
export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many posts. The feed is for humans — try again in a minute.')
});

// Heavier mutations (teams, stories, challenges join/complete).
export const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many actions. Try again in a minute.')
});
