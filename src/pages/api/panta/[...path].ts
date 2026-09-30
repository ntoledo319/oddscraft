/**
 * /api/panta/[...path] — thin proxy to the Panta API that injects the
 * server-held API key, so the browser never sees it. Mirrors the pattern from
 * github.com/Kaito-HQ/panta-api-playground (app router) in a pages-router route.
 */
import { NextApiRequest, NextApiResponse } from 'next';

const UPSTREAM = (
  process.env.PANTA_API_BASE_URL ?? 'https://live-api.panta.market/api/v1'
).replace(/\/$/, '');

// Only product endpoints the app actually uses — never an open proxy.
const ALLOWED = [
  /^markets(\/|$)/,
  /^primaryorder(quote|build|submit|verify)\/?$/,
  /^positions\/?$/,
  /^trades\//,
  /^claims\//,
  /^account\/?$/,
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const segments = (req.query.path as string[] | undefined) ?? [];
  const suffix = segments.map(encodeURIComponent).join('/');
  if (!ALLOWED.some((re) => re.test(suffix))) {
    return res.status(403).json({ code: 'PROXY_PATH_NOT_ALLOWED' });
  }
  const apiKey = process.env.PANTA_API_KEY;
  if (!apiKey) return res.status(500).json({ code: 'PANTA_KEY_NOT_CONFIGURED' });

  const url = new URL(`${UPSTREAM}/${suffix}/`);
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'path') continue;
    url.searchParams.set(k, Array.isArray(v) ? v[0] : String(v));
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Api-Key': apiKey,
  };
  if (typeof req.headers['x-user-id'] === 'string') {
    headers['X-User-Id'] = req.headers['x-user-id'];
  }

  let body: string | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  try {
    const upstream = await fetch(url.toString(), {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
    } as RequestInit);
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
    return res.send(text);
  } catch (e) {
    return res.status(502).json({
      code: 'PROXY_UNREACHABLE',
      detail: e instanceof Error ? e.message : 'proxy_failed',
    });
  }
}
