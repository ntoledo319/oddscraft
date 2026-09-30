/**
 * Panta API client wrapper (server-side only — holds the API key).
 * Docs: https://docs.panta.market · base: https://live-api.panta.market/api/v1
 * Auth: X-Api-Key header (pk_test_… or pk_live_…). Trailing slashes required.
 *
 * Note: pk_test_ keys are served sandbox fixtures by Panta (no Solana mainnet
 * access). The same code paths work unchanged with a pk_live_ key.
 */

const PANTA_BASE = (
  process.env.PANTA_API_BASE_URL ?? 'https://live-api.panta.market/api/v1'
).replace(/\/$/, '');

export class PantaError extends Error {
  status: number;
  code: string;
  body: unknown;
  constructor(status: number, body: unknown) {
    const code =
      body && typeof body === 'object' && 'code' in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).code)
        : `HTTP ${status}`;
    super(code);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string>; apiKey?: string } = {},
): Promise<T> {
  const apiKey = opts.apiKey ?? process.env.PANTA_API_KEY;
  if (!apiKey) throw new Error('PANTA_API_KEY not configured');
  const qs = opts.query ? '?' + new URLSearchParams(opts.query).toString() : '';
  const url = `${PANTA_BASE}${path.startsWith('/') ? path : `/${path}`}${qs}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Api-Key': apiKey,
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, { method: opts.method ?? 'GET', headers, body, cache: 'no-store' });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) throw new PantaError(res.status, parsed);
  return parsed as T;
}

/* ---------- types (mirrors panta-api-playground src/lib/types.ts) ---------- */

export type CreateQuoteResponse = {
  createId: string;
  expectedEventPda: string;
  paymentUsdc: string;
  liquidityInjectionUsdc?: string;
  platformRevenueUsdc?: string;
  marketType: string;
  expiresAt: string;
};

export type CreateBuildResponse = {
  createId: string;
  expectedEventPda: string;
  transaction: string; // base64 versioned tx (unsigned)
  recentBlockhash: string;
  lastValidBlockHeight?: number;
  paymentUsdc: string;
  marketType: string;
  expiresAt?: string;
};

export type CreateRegisterResponse = {
  createId: string;
  marketId: string;
  status: string;
  signature: string;
  category?: string;
  title?: string;
};

export type PrimaryQuoteResponse = {
  quoteId: string;
  marketId: string;
  side: string;
  amountUsdc: string;
  shares: string;
  avgPrice: string;
  feeUsdc: string;
  expiresAt: string;
};

export type BuiltInstruction = {
  programId: string;
  data: string; // base64
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
};

export type PrimaryBuildResponse = {
  orderId: string;
  quoteId: string;
  wallet: string;
  marketId: string;
  side: string;
  amountUsdc: string;
  expectedShares: string;
  feeUsdc: string;
  status: string;
  instructions: BuiltInstruction[];
  recentBlockhash: string;
  expiresAt?: string;
};

export type MarketCatalogItem = {
  marketId: string;
  category: string;
  title: string;
  description?: string;
  images?: string[];
  phase: string;
  marketType?: string;
  startTime?: number | null;
  endTime?: number | null;
  resolutionTime?: number | null;
  region?: string;
  resolved?: boolean;
  status?: string;
  volumeUsdc?: string;
  yesPrice?: string | null;
  noPrice?: string | null;
  primaryYesPrice?: string | null;
  primaryNoPrice?: string | null;
  disclaimer?: string;
};

export type MarketsListResponse = {
  items: MarketCatalogItem[];
  nextCursor?: string | null;
  disclaimer?: string;
};

export type PositionRow = {
  marketId: string;
  title?: string;
  side?: string;
  shares?: string;
  phase?: string;
  claimable?: boolean;
  [key: string]: unknown;
};

export type CreateMarketParams = {
  wallet: string;
  question: string;
  resolutionRule: string;
  sourcesOfTruth: string[];
  category: string;
  startTime: number;
  endTime: number;
  resolutionTime: number;
  marketType: 'standard' | 'breaking';
  title?: string;
  description?: string;
  imageUrl: string;
  region?: string;
  oracle?: string;
  eventInProgress?: boolean;
};

/* ---------- endpoints ---------- */

export const panta = {
  whoami: () => request<Record<string, unknown>>('/account/'),

  listMarkets: (query?: Record<string, string>) =>
    request<MarketsListResponse>('/markets/', { query }),

  getMarket: (marketId: string) =>
    request<MarketCatalogItem>(`/markets/${encodeURIComponent(marketId)}/`),

  marketTrades: (marketId: string) =>
    request<Record<string, unknown>>(`/markets/${encodeURIComponent(marketId)}/trades/`),

  createQuote: (params: CreateMarketParams) =>
    request<CreateQuoteResponse>('/markets/create/quote/', { method: 'POST', body: params }),

  createBuild: (createId: string, wallet: string) =>
    request<CreateBuildResponse>('/markets/create/build/', {
      method: 'POST',
      body: { createId, wallet },
    }),

  createRegister: (createId: string, signature: string) =>
    request<CreateRegisterResponse>('/markets/register/', {
      method: 'POST',
      body: { createId, signature },
    }),

  primaryQuote: (params: {
    wallet: string;
    marketId: string;
    side: 'yes' | 'no';
    amountUsdc: string;
    userId?: string;
  }) => request<PrimaryQuoteResponse>('/primaryorderquote/', { method: 'POST', body: params }),

  primaryBuild: (params: {
    quoteId: string;
    wallet: string;
    maxSlippageBps: number;
    userId?: string;
  }) => request<PrimaryBuildResponse>('/primaryorderbuild/', { method: 'POST', body: params }),

  primarySubmit: (params: { orderId: string; signature: string; wallet: string }) =>
    request<Json>('/primaryordersubmit/', { method: 'POST', body: params }),

  primaryVerify: (params: { orderId: string; signature?: string; wallet: string }) =>
    request<Json>('/primaryorderverify/', { method: 'POST', body: params }),

  positions: (wallet: string) =>
    request<{ items?: PositionRow[]; positions?: PositionRow[] } & Record<string, unknown>>(
      '/positions/',
      { query: { wallet } },
    ),

  reportTrade: (signature: string) =>
    request<Json>('/trades/report/', { method: 'POST', body: { signature } }),

  tradeStatus: (signature: string) =>
    request<Json>(`/trades/${encodeURIComponent(signature)}/`),
};
