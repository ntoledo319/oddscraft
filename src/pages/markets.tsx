/**
 * /markets — browse Panta prediction markets, buy YES/NO on the bonding curve,
 * view wallet positions, and see OddsCraft paired launches (market ↔ DBC pool).
 * All Panta calls go through /api/panta/* (server holds the API key).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useUnifiedWalletContext, useWallet } from '@jup-ag/wallet-adapter';
import { Connection } from '@solana/web3.js';
import { toast } from 'sonner';
import Header from '@/components/Header';
import { Button } from '@/components/ui/button';
import {
  apiFetch,
  explorerAccount,
  explorerTx,
  instructionsToVersionedTx,
  pantaProxy,
} from '@/lib/client';
import type {
  MarketsListResponse,
  MarketCatalogItem,
  PrimaryBuildResponse,
  PrimaryQuoteResponse,
} from '@/lib/panta';
import type { LaunchRecord } from '@/lib/store';

const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? 'devnet';
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.devnet.solana.com';

const inputClassName =
  'w-full rounded-lg border border-neutral-750 bg-background p-2.5 text-sm text-foreground placeholder:text-neutral-500 transition-colors focus:border-primary/60 focus:outline-none';

function fmtPrice(p?: string | null) {
  if (!p) return '—';
  const n = Number(p);
  return Number.isFinite(n) ? n.toFixed(3) : p;
}

function BuyPanel({ market, wallet }: { market: MarketCatalogItem; wallet: string }) {
  const { publicKey, signTransaction } = useWallet();
  const [side, setSide] = useState<'yes' | 'no'>('yes');
  const [amount, setAmount] = useState('1.00');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('');

  const buy = async () => {
    if (!publicKey || !signTransaction) return;
    setBusy(true);
    setStatus('');
    try {
      setStatus('Quoting…');
      const quote = await pantaProxy<PrimaryQuoteResponse>('/primaryorderquote/', {
        method: 'POST',
        body: { wallet, marketId: market.marketId, side, amountUsdc: amount },
      });
      setStatus(`Building tx (≈${quote.shares} shares, fee ${quote.feeUsdc} USDC)…`);
      const build = await pantaProxy<PrimaryBuildResponse>('/primaryorderbuild/', {
        method: 'POST',
        body: { quoteId: quote.quoteId, wallet, maxSlippageBps: 100 },
      });
      const tx = instructionsToVersionedTx(build.instructions, publicKey, build.recentBlockhash);
      setStatus('Sign in wallet…');
      const signed = await signTransaction(tx);
      setStatus('Broadcasting…');
      const connection = new Connection(RPC_URL, 'confirmed');
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      setStatus('Reporting to Panta…');
      await pantaProxy('/primaryordersubmit/', {
        method: 'POST',
        body: { orderId: build.orderId, signature: sig, wallet },
      });
      setStatus(`Filled. Sig: ${sig.slice(0, 20)}…`);
      toast.success(`${side.toUpperCase()} buy submitted`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Buy failed';
      setStatus(`Error: ${msg}`);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 space-y-2">
      <div className="flex gap-2">
        <select
          className={inputClassName}
          value={side}
          onChange={(e) => setSide(e.target.value as 'yes' | 'no')}
        >
          <option value="yes">YES</option>
          <option value="no">NO</option>
        </select>
        <input
          className={inputClassName}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount USDC"
          inputMode="decimal"
        />
        <Button type="button" disabled={busy} onClick={() => void buy()}>
          {busy ? '…' : 'Buy'}
        </Button>
      </div>
      {status && <p className="text-xs text-neutral-400 break-all">{status}</p>}
    </div>
  );
}

export default function MarketsPage() {
  const { publicKey } = useWallet();
  const { setShowModal } = useUnifiedWalletContext();
  const wallet = useMemo(() => publicKey?.toBase58(), [publicKey]);

  const [markets, setMarkets] = useState<MarketCatalogItem[]>([]);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const [launches, setLaunches] = useState<LaunchRecord[]>([]);
  const [positions, setPositions] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openBuy, setOpenBuy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, l] = await Promise.all([
        pantaProxy<MarketsListResponse>('/markets/', { query: { pageSize: '50' } }),
        apiFetch<{ items: LaunchRecord[] }>('/api/launches'),
      ]);
      setMarkets(m.items ?? []);
      setDisclaimer(m.disclaimer ?? null);
      setLaunches(l.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load markets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadPositions = useCallback(async () => {
    if (!wallet) return;
    try {
      const p = await pantaProxy<unknown>('/positions/', { query: { wallet } });
      setPositions(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Positions failed');
    }
  }, [wallet]);

  useEffect(() => {
    void loadPositions();
  }, [loadPositions]);

  const launchByMarket = useMemo(() => {
    const map = new Map<string, LaunchRecord>();
    for (const l of launches) if (l.marketId) map.set(l.marketId, l);
    return map;
  }, [launches]);

  return (
    <>
      <Head>
        <title>Markets — OddsCraft</title>
      </Head>
      <div className="min-h-screen bg-background text-foreground">
        <Header />
        <main className="mx-auto w-full max-w-5xl px-4 py-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Prediction markets</h1>
              <p className="text-neutral-400 text-sm mt-1">
                Discovered and traded via the Panta API — quote, build unsigned tx, sign in your
                wallet, broadcast, report attribution.
              </p>
            </div>
            <Button variant="secondary" onClick={() => void load()} disabled={loading}>
              <span className="iconify ph--arrows-clockwise-bold w-4 h-4" /> Refresh
            </Button>
          </div>

          {disclaimer && (
            <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
              {disclaimer}
            </div>
          )}
          {error && (
            <div className="mb-6 rounded-lg border border-rose/40 bg-rose/10 p-3 text-sm text-rose">
              {error}
            </div>
          )}

          {launches.length > 0 && (
            <section className="mb-10">
              <h2 className="text-lg font-semibold mb-3">Launched on OddsCraft</h2>
              <div className="grid gap-3">
                {launches.map((l) => (
                  <div
                    key={l.id}
                    className="rounded-xl border border-neutral-850 bg-neutral-925 p-4 text-sm break-all"
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-medium">{l.question}</span>
                      <span className="rounded-full bg-primary/15 text-primary px-2 py-0.5 text-xs">
                        {l.status}
                      </span>
                    </div>
                    <div className="text-neutral-400 space-y-1 text-xs">
                      <p>
                        token {l.tokenSymbol}{' '}
                        <a
                          className="text-primary hover:underline"
                          href={explorerAccount(l.mint, l.cluster)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {l.mint.slice(0, 12)}…
                        </a>
                        {l.poolTxSignature && (
                          <>
                            {' · pool tx '}
                            <a
                              className="text-primary hover:underline"
                              href={explorerTx(l.poolTxSignature, l.cluster)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {l.poolTxSignature.slice(0, 16)}…
                            </a>
                          </>
                        )}
                        {l.poolAddress && (
                          <>
                            {' · pool '}
                            <a
                              className="text-primary hover:underline"
                              href={explorerAccount(l.poolAddress, l.cluster)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {l.poolAddress.slice(0, 12)}…
                            </a>
                          </>
                        )}
                      </p>
                      {l.marketId && <p>Panta market: <code>{l.marketId}</code></p>}
                      {l.error && <p className="text-rose">error: {l.error}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-lg font-semibold mb-3">Panta catalog</h2>
            {loading ? (
              <p className="text-neutral-500 text-sm">Loading…</p>
            ) : markets.length === 0 ? (
              <p className="text-neutral-500 text-sm">No markets returned.</p>
            ) : (
              <div className="grid gap-3">
                {markets.map((m) => {
                  const paired = launchByMarket.get(m.marketId);
                  return (
                    <div
                      key={m.marketId}
                      className="rounded-xl border border-neutral-850 bg-neutral-925 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{m.title}</p>
                          <p className="text-xs text-neutral-500 mt-0.5">
                            {m.category} · {m.phase} · vol {m.volumeUsdc ?? '0'} USDC
                            {paired && (
                              <>
                                {' · '}
                                <span className="text-primary">
                                  conviction token {paired.tokenSymbol}
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                          <span className="text-emerald">YES {fmtPrice(m.primaryYesPrice ?? m.yesPrice)}</span>
                          <span className="text-rose">NO {fmtPrice(m.primaryNoPrice ?? m.noPrice)}</span>
                          {wallet ? (
                            <Button
                              variant="secondary"
                              onClick={() =>
                                setOpenBuy(openBuy === m.marketId ? null : m.marketId)
                              }
                            >
                              Trade
                            </Button>
                          ) : (
                            <Button variant="secondary" onClick={() => setShowModal(true)}>
                              Connect to trade
                            </Button>
                          )}
                        </div>
                      </div>
                      {openBuy === m.marketId && wallet && (
                        <BuyPanel market={m} wallet={wallet} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {wallet && positions != null && (
            <section className="mt-10">
              <h2 className="text-lg font-semibold mb-3">Your positions</h2>
              <pre className="rounded-xl border border-neutral-850 bg-neutral-925 p-4 text-xs overflow-auto max-h-80">
                {JSON.stringify(positions, null, 2)}
              </pre>
            </section>
          )}
        </main>
      </div>
    </>
  );
}
