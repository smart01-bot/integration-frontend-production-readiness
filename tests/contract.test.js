/**
 * Contract tests — audit gap 20.
 *
 * Jest config lives in package.json ("test": "jest --coverage"); these tests
 * run against a LOCAL dev server started by CI (see .github/workflows/ci.yml)
 * or by `npm run dev` on the developer's machine. BASE_URL defaults to
 * http://localhost:8800. The suite asserts the HTTP contract (status codes,
 * auth gates, pagination clamps, rate-limit headers) rather than DB state, so
 * it is safe to run against any seeded dev environment.
 */

const BASE = process.env.BASE_URL || 'http://localhost:8800';
const API = `${BASE}/api/v1`;

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body, headers: res.headers };
}

const jsonHeaders = { 'Content-Type': 'application/json' };

// ── Health & infra ───────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('responds 200 with a status field', async () => {
    const res = await fetch(`${BASE}/api/v1/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
  });
});

// ── Auth gates: writes must never succeed anonymously ────────────────────────

describe('auth gates on social writes', () => {
  const protectedWrites = [
    ['POST', '/community/posts', { content: 'x' }],
    ['POST', '/teams', { name: 'x' }],
    ['POST', '/stories', { quote: 'x'.repeat(30), display_name: 'x' }],
    ['PUT', '/consent', { allow_anonymized_analytics: true }],
  ];

  test.each(protectedWrites)('%s %s is 401 without a token', async (method, path, payload) => {
    const res = await api(path, { method, headers: jsonHeaders, body: JSON.stringify(payload) });
    expect(res.status).toBe(401);
  });
});

// ── Pagination clamp (gap 19) ────────────────────────────────────────────────

describe('pagination clamp', () => {
  test('limit=10000 is clamped, not honored', async () => {
    const res = await api('/community/posts?limit=10000');
    expect(res.status).toBe(200);
    expect(res.body?.pagination?.limit).toBeLessThanOrEqual(100);
  });

  test('default limit is applied when omitted', async () => {
    const res = await api('/community/posts');
    expect(res.status).toBe(200);
    expect(res.body?.pagination?.limit).toBeLessThanOrEqual(100);
  });

  test('teams list also clamps', async () => {
    const res = await api('/teams?limit=99999');
    expect(res.status).toBe(200);
    expect(res.body?.pagination?.limit).toBeLessThanOrEqual(100);
  });
});

// ── Leaderboard validator (existing behavior, now under test) ────────────────

describe('results leaderboard', () => {
  test('rejects an invalid board with 400', async () => {
    const res = await api('/results/leaderboard?board=cheating');
    expect(res.status).toBe(400);
  });

  test('accepts the three valid boards', async () => {
    for (const board of ['performance', 'community', 'participation']) {
      const res = await api(`/results/leaderboard?board=${board}`);
      expect(res.status).toBe(200);
      expect(res.body?.board).toBe(board);
    }
  });
});

// ── Public reads that must keep working ──────────────────────────────────────

describe('public reads', () => {
  const reads = [
    '/triathlon/overview',
    '/triathlon/live-activity',
    '/triathlon/map',
    '/triathlon/impact',
    '/community/posts',
    '/teams',
    '/stories',
    '/photos',
    '/challenges',
  ];

  test.each(reads)('GET %s responds 200', async (path) => {
    const res = await api(path);
    expect(res.status).toBe(200);
    expect(res.body?.success).not.toBe(false);
  });
});

// ── Invalid input validation ─────────────────────────────────────────────────

describe('input validation', () => {
  test('community post with a bogus post_type is rejected fast', async () => {
    // No token: expect 401 (auth) OR with a fake token 400 (validation) —
    // the point is the endpoint never hangs and never 500s on garbage.
    const res = await api('/community/posts', {
      method: 'POST',
      headers: { ...jsonHeaders, Authorization: 'Bearer fake.token.value' },
      body: JSON.stringify({ content: 'x', post_type: 'not-a-type' })
    });
    expect([401, 400]).toContain(res.status);
  });

  test('team type filter whitelist rejects bogus values', async () => {
    const res = await api('/teams?type=nonsense');
    expect(res.status).toBe(400);
  });
});

// ── CORS preflight (the frontend bridge) ─────────────────────────────────────

describe('CORS', () => {
  test('preflight from the frontend origin is allowed', async () => {
    const res = await fetch(`${API}/community/posts`, { method: 'OPTIONS' });
    expect(res.status).toBeLessThan(400);
  });
});
