/**
 * /launch — the OddsCraft paired launch: one form creates
 *   (a) a Panta prediction market (quote → build → sign → broadcast → register)
 *   (b) a companion conviction token on the OddsCraft Meteora DBC curve config
 * and records the marketId ↔ pool mapping.
 */
import { useMemo, useState } from 'react';
import Head from 'next/head';
import { useUnifiedWalletContext, useWallet } from '@jup-ag/wallet-adapter';
import { Connection, Keypair, Transaction } from '@solana/web3.js';
import { toast } from 'sonner';
import Header from '@/components/Header';
import { Button } from '@/components/ui/button';
import {
  apiFetch,
  deserializeVersionedTx,
  explorerAccount,
  explorerTx,
  pantaProxy,
} from '@/lib/client';
import type { CreateBuildResponse, CreateQuoteResponse, CreateRegisterResponse } from '@/lib/panta';

const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? 'devnet';
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.devnet.solana.com';

const CATEGORIES = ['crypto', 'sports', 'politics', 'entertainment', 'finance', 'science', 'world', 'other'];

const inputClassName =
  'w-full rounded-lg border border-neutral-750 bg-background p-3 text-sm text-foreground placeholder:text-neutral-500 transition-colors focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/40';

type Step = 'idle' | 'preparing' | 'pool' | 'panta-build' | 'panta-send' | 'register' | 'done';

const STEP_LABELS: Record<Step, string> = {
  idle: '',
  preparing: 'Quoting Panta market + building DBC pool tx…',
  pool: 'Sign & broadcast the conviction-token pool (Meteora DBC)…',
  'panta-build': 'Building the Panta market-create transaction…',
  'panta-send': 'Sign & broadcast the Panta market create…',
  register: 'Registering the market with Panta + recording the pair…',
  done: 'Launched',
};

export default function LaunchPage() {
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const { setShowModal } = useUnifiedWalletContext();
  const wallet = useMemo(() => publicKey?.toBase58(), [publicKey]);

  const [question, setQuestion] = useState('');
  const [resolutionRule, setResolutionRule] = useState('');
  const [sources, setSources] = useState('');
  const [category, setCategory] = useState('crypto');
  const [days, setDays] = useState(7);
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');

  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    mint: string;
    poolTxSignature?: string;
    marketId?: string;
    poolAddress?: string;
    quote?: CreateQuoteResponse;
    register?: CreateRegisterResponse;
    pantaError?: string;
  } | null>(null);

  const busy = step !== 'idle' && step !== 'done';

  const suggestToken = (q: string) => {
    if (tokenName) return;
    const clean = q.replace(/[^a-zA-Z0-9 $>?]/g, '').slice(0, 28);
    if (clean) setTokenName(`${clean} Conviction`);
    const words = q.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(' ').filter(Boolean);
    if (words.length) setTokenSymbol(('YES' + words.slice(0, 2).join('')).slice(0, 10));
  };

  const run = async () => {
    if (!wallet || !signTransaction) {
      setShowModal(true);
      return;
    }
    setError(null);
    setResult(null);
    try {
      if (!question.trim() || !resolutionRule.trim() || !tokenName.trim() || !tokenSymbol.trim()) {
        throw new Error('Fill in question, resolution rule, token name and symbol');
      }
      if (!Number.isFinite(days) || days < 1 || days > 90) {
        throw new Error('Market duration must be between 1 and 90 days');
      }
      const now = Math.floor(Date.now() / 1000);
      const startTime = now + 3600; // Panta requires start ≥ ~1h ahead
      const endTime = startTime + days * 24 * 3600;
      const resolutionTime = endTime + 3600;
      const mintKeypair = Keypair.generate();
      const mint = mintKeypair.publicKey.toBase58();

      // 1. prepare: Panta quote + DBC pool tx
      setStep('preparing');
      const prep = await apiFetch<{
        createId: string;
        quote: CreateQuoteResponse;
        poolTx: string;
        metadataUri: string;
      }>('/api/launch/prepare', {
        method: 'POST',
        body: {
          wallet,
          mint,
          question: question.trim(),
          resolutionRule: resolutionRule.trim(),
          sourcesOfTruth: sources.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          category,
          startTime,
          endTime,
          resolutionTime,
          marketType: 'standard',
          region: 'Global',
          tokenName: tokenName.trim(),
          tokenSymbol: tokenSymbol.trim().toUpperCase(),
          description: `Prediction market + conviction token launched via OddsCraft. ${question.trim()}`,
        },
      });

      // 2. DBC pool: sign (mint + wallet) and broadcast
      setStep('pool');
      const poolTx = Transaction.from(Buffer.from(prep.poolTx, 'base64'));
      poolTx.partialSign(mintKeypair);
      const signedPoolTx = await signTransaction(poolTx);
      const sendRes = await apiFetch<{ success: boolean; signature: string }>(
        '/api/send-transaction',
        {
          method: 'POST',
          body: { signedTransaction: signedPoolTx.serialize().toString('base64') },
        },
      );
      toast.success(`Conviction token pool created on Meteora DBC`);
      const partial: NonNullable<typeof result> = {
        mint,
        poolTxSignature: sendRes.signature,
        quote: prep.quote,
      };
      setResult({ ...partial });

      // 3. Panta build → sign → broadcast
      setStep('panta-build');
      try {
        const build = await pantaProxy<CreateBuildResponse>('/markets/create/build/', {
          method: 'POST',
          body: { createId: prep.createId, wallet },
        });
        setStep('panta-send');
        const vtx = deserializeVersionedTx(build.transaction);
        const signedVtx = await signTransaction(vtx);
        const connection = new Connection(RPC_URL, 'confirmed');
        const sig = await connection.sendRawTransaction(signedVtx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        // 4. register with Panta + record mapping
        setStep('register');
        const fin = await apiFetch<{ register: CreateRegisterResponse; poolAddress?: string }>(
          '/api/launch/finalize',
          {
            method: 'POST',
            body: {
              createId: prep.createId,
              signature: sig,
              mint,
              wallet,
              poolTxSignature: sendRes.signature,
            },
          },
        );
        setResult({ ...partial, register: fin.register, marketId: fin.register.marketId, poolAddress: fin.poolAddress });
        toast.success('Prediction market registered with Panta');
      } catch (e) {
        // DBC side already landed — record the pool, report Panta failure without losing the pair.
        const msg = e instanceof Error ? e.message : 'Panta step failed';
        try {
          await apiFetch('/api/launch/finalize', {
            method: 'POST',
            body: { createId: prep.createId, mint, wallet, poolTxSignature: sendRes.signature },
          });
        } catch {
          /* best-effort record */
        }
        partial.pantaError = msg;
        setResult({ ...partial });
        setError(`Pool launched, but the Panta market step failed: ${msg}`);
        toast.error(msg);
      }
      setStep('done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Launch failed';
      setError(msg);
      toast.error(msg);
      setStep('idle');
    }
  };

  return (
    <>
      <Head>
        <title>Launch — OddsCraft</title>
        <meta
          name="description"
          content="Launch a Panta prediction market paired with a Meteora DBC conviction token."
        />
      </Head>
      <div className="min-h-screen bg-background text-foreground">
        <Header />
        <main className="mx-auto w-full max-w-3xl px-4 py-8 md:py-12">
          <h1 className="text-3xl md:text-4xl font-bold mb-2 tracking-tight">Launch a market</h1>
          <p className="text-neutral-400 mb-8">
            Every prediction market gets a token. One form → a Panta market + a conviction token on
            an OddsCraft Meteora DBC curve (long/flat preset tuned for thin, event-driven assets,
            graduating to DAMM v2).
          </p>

          <div className="rounded-xl border border-neutral-850 bg-neutral-925 p-5 sm:p-8 space-y-5">
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                Market question*
              </label>
              <textarea
                rows={2}
                className={inputClassName}
                placeholder="Will SOL trade above $300 on Oct 12, 2026?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onBlur={() => suggestToken(question)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                Resolution rule*
              </label>
              <textarea
                rows={2}
                className={inputClassName}
                placeholder="Resolves YES if the CoinGecko daily close (UTC) on Oct 12, 2026 is ≥ $300"
                value={resolutionRule}
                onChange={(e) => setResolutionRule(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                Sources of truth (comma separated)
              </label>
              <input
                className={inputClassName}
                placeholder="https://www.coingecko.com"
                value={sources}
                onChange={(e) => setSources(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1.5">Category</label>
                <select
                  className={inputClassName}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                  Runs for (days)
                </label>
                <input
                  type="number"
                  min={1}
                  max={90}
                  className={inputClassName}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                  Conviction token name*
                </label>
                <input
                  className={inputClassName}
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  placeholder="SOL>300 Oct12 Conviction"
                  maxLength={32}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                  Token symbol*
                </label>
                <input
                  className={inputClassName}
                  value={tokenSymbol}
                  onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                  placeholder="SOLYES300"
                  maxLength={10}
                />
              </div>
            </div>

            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 text-xs text-neutral-400 space-y-1">
              <p>
                <span className="text-neutral-200 font-medium">Curve preset:</span> OddsCraft
                conviction curve — custom sqrt-price curve with a long flat band (heavy liquidity in
                low-price segments) and an accelerating tail into graduation; anti-snipe fee decay
                2.5% → 0.5% over 1h; graduates to DAMM v2.
              </p>
              <p>
                <span className="text-neutral-200 font-medium">Network:</span> {CLUSTER} (DBC side).
                Panta API key env decides the market backend (test keys return sandbox fixtures).
              </p>
            </div>

            {error && (
              <div className="rounded-lg border border-rose/40 bg-rose/10 p-4 text-sm text-rose">
                {error}
              </div>
            )}

            <div className="flex justify-end">
              {!wallet ? (
                <Button type="button" onClick={() => setShowModal(true)}>
                  Connect Wallet
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void run()}
                  className="flex items-center gap-2"
                >
                  {busy ? (
                    <>
                      <span className="iconify ph--spinner w-5 h-5 animate-spin" />
                      <span>{STEP_LABELS[step]}</span>
                    </>
                  ) : (
                    <>
                      <span className="iconify ph--rocket-bold w-5 h-5" />
                      <span>Launch market + token</span>
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>

          {result && (
            <div className="mt-8 rounded-xl border border-emerald/30 bg-neutral-925 p-5 sm:p-8 space-y-3">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <span className="iconify ph--check-circle-bold w-6 h-6 text-emerald" />
                Pair launched
              </h2>
              <div className="text-sm space-y-2 break-all">
                <p>
                  <span className="text-neutral-400">Conviction token mint:</span>{' '}
                  <a
                    className="text-primary hover:underline"
                    href={explorerAccount(result.mint, CLUSTER)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {result.mint}
                  </a>
                </p>
                {result.poolTxSignature && (
                  <p>
                    <span className="text-neutral-400">DBC pool tx:</span>{' '}
                    <a
                      className="text-primary hover:underline"
                      href={explorerTx(result.poolTxSignature, CLUSTER)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {result.poolTxSignature}
                    </a>
                  </p>
                )}
                {result.poolAddress && (
                  <p>
                    <span className="text-neutral-400">DBC pool:</span>{' '}
                    <a
                      className="text-primary hover:underline"
                      href={explorerAccount(result.poolAddress, CLUSTER)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {result.poolAddress}
                    </a>
                  </p>
                )}
                {result.marketId && (
                  <p>
                    <span className="text-neutral-400">Panta market:</span>{' '}
                    <code>{result.marketId}</code>
                  </p>
                )}
                {result.quote && (
                  <p className="text-neutral-500">
                    Panta create fee quoted: {Number(result.quote.paymentUsdc) / 1_000_000} USDC
                  </p>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
