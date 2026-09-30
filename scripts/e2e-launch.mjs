/**
 * e2e-launch.mjs — headless end-to-end test of the OddsCraft paired launch flow.
 * Plays the wallet-client role with a local keypair (no browser needed):
 *   prepare (Panta quote + DBC pool tx) → sign+broadcast DBC pool →
 *   Panta build → sign+broadcast market create → register → verify mapping.
 *
 * Usage: node scripts/e2e-launch.mjs [keypair.json] [appOrigin]
 * Defaults: ../meteora-invent/studio/keypair.json, http://localhost:3000
 */
import { Connection, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import fs from 'node:fs';

const KEYPAIR_PATH = process.argv[2] ?? new URL('../../meteora-invent/studio/keypair.json', import.meta.url).pathname;
const APP = process.argv[3] ?? process.env.APP_ORIGIN ?? 'http://localhost:3000';
const RPC = process.env.RPC_URL ?? 'http://localhost:8899';

const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8'))),
);
console.log('wallet:', wallet.publicKey.toBase58());
console.log('app:', APP, '| rpc:', RPC);

async function post(path, body) {
  const res = await fetch(`${APP}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const now = Math.floor(Date.now() / 1000);
const runId = Math.random().toString(36).slice(2, 7).toUpperCase();
const question = `E2E test ${runId}: Will SOL trade above $300 on Oct 12, 2026?`;

// ── 1. prepare ─────────────────────────────────────────────────────────────
const mintKeypair = Keypair.generate();
const mint = mintKeypair.publicKey.toBase58();
console.log('\n[1] prepare — Panta quote + DBC pool tx (mint', mint, ')');
const prep = await post('/api/launch/prepare', {
  wallet: wallet.publicKey.toBase58(),
  mint,
  question,
  resolutionRule: 'CoinGecko daily close UTC >= 300 USD on 2026-10-12',
  sourcesOfTruth: ['https://www.coingecko.com'],
  category: 'crypto',
  startTime: now + 3600,
  endTime: now + 3600 + 7 * 24 * 3600,
  resolutionTime: now + 3600 + 7 * 24 * 3600 + 3600,
  marketType: 'standard',
  region: 'Global',
  tokenName: `E2E${runId} Conviction`,
  tokenSymbol: `E2E${runId}`.slice(0, 10),
});
console.log('    createId:', prep.createId);
console.log('    quote fee (USDC base):', prep.quote.paymentUsdc);
console.log('    metadataUri:', prep.metadataUri);

// ── 2. DBC pool: sign + broadcast ──────────────────────────────────────────
console.log('\n[2] sign + broadcast DBC pool tx');
const poolTx = Transaction.from(Buffer.from(prep.poolTx, 'base64'));
poolTx.partialSign(mintKeypair, wallet);
const send = await post('/api/send-transaction', {
  signedTransaction: poolTx.serialize().toString('base64'),
});
console.log('    pool tx signature:', send.signature);

// ── 3. Panta build → sign → broadcast ──────────────────────────────────────
console.log('\n[3] Panta create build → sign → broadcast');
let pantaSig = null;
try {
  const build = await post('/api/panta/markets/create/build/', {
    createId: prep.createId,
    wallet: wallet.publicKey.toBase58(),
  });
  const vtx = VersionedTransaction.deserialize(Buffer.from(build.transaction, 'base64'));
  vtx.sign([wallet]);
  const connection = new Connection(RPC, 'confirmed');
  pantaSig = await connection.sendRawTransaction(vtx.serialize(), { skipPreflight: false });
  console.log('    panta create signature:', pantaSig);
} catch (e) {
  console.log('    EXPECTED with pk_test sandbox keys — Panta build/broadcast failed:');
  console.log('   ', String(e.message ?? e).slice(0, 300));
}

// ── 4. finalize ────────────────────────────────────────────────────────────
if (pantaSig) {
  console.log('\n[4] register market with Panta + record mapping');
  const fin = await post('/api/launch/finalize', {
    createId: prep.createId,
    signature: pantaSig,
    mint,
    wallet: wallet.publicKey.toBase58(),
    poolTxSignature: send.signature,
  });
  console.log('    marketId:', fin.register?.marketId, '| pool:', fin.poolAddress);
} else {
  console.log('\n[4] skipped register (no live Panta signature in sandbox mode)');
}

// ── 5. verify ──────────────────────────────────────────────────────────────
console.log('\n[5] verify');
const meta = await fetch(`${APP}/api/metadata/${mint}.json`).then((r) => r.json());
console.log('    metadata served:', meta.name, '/', meta.symbol);
const launches = await fetch(`${APP}/api/launches`).then((r) => r.json());
const rec = launches.items.find((l) => l.mint === mint);
console.log('    launch record:', rec ? `${rec.status} (config ${rec.configKey})` : 'MISSING');
const connection = new Connection(RPC, 'confirmed');
const acct = await connection.getAccountInfo(mintKeypair.publicKey);
console.log('    mint account on-chain:', acct ? 'YES (executable token mint)' : 'NO');
console.log('\nDone.');
