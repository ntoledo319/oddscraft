/**
 * graduate.mjs — push a DBC pool over its migration threshold with a PartialFill
 * buy (exact-in swaps fail near the top of the curve), readying it for
 * `pnpm studio dbc-migrate-to-damm-v2 --baseMint <MINT>`.
 *
 * Usage: node scripts/graduate.mjs <keypair.json> <baseMint> [rpcUrl]
 */
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import { DynamicBondingCurveClient, SwapMode } from '@meteora-ag/dynamic-bonding-curve-sdk';
import BN from 'bn.js';
import fs from 'node:fs';

const [keypairPath, mintStr, rpc = 'http://localhost:8899'] = process.argv.slice(2);
if (!keypairPath || !mintStr) {
  console.error('usage: node scripts/graduate.mjs <keypair.json> <baseMint> [rpcUrl]');
  process.exit(1);
}
const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8'))),
);
const connection = new Connection(rpc, 'confirmed');
const client = new DynamicBondingCurveClient(connection, 'confirmed');

const pool = await client.state.getPoolByBaseMint(new PublicKey(mintStr));
if (!pool) throw new Error('pool not found');
const state = await client.state.getPool(pool.publicKey);
const config = await client.state.getPoolConfig(state.poolState.config);

const threshold = await client.state.getPoolMigrationQuoteThreshold(pool.publicKey);
const quoteReserve = state.poolState.quoteReserve;
const remaining = threshold.sub(quoteReserve);
console.log('threshold:', threshold.toString(), 'reserve:', quoteReserve.toString(), 'remaining:', remaining.toString());
if (remaining.lte(new BN(0))) {
  console.log('already at/over threshold — migrate now');
  process.exit(0);
}

// PartialFill caps the fill at the threshold; overfund by 3x to absorb fees.
const amountIn = remaining.muln(3);
const bal = new BN(await connection.getBalance(wallet.publicKey));
if (bal.lt(amountIn)) {
  console.log(`wallet balance ${bal.toString()} < amountIn ${amountIn.toString()} — clamping (PartialFill refunds unspent)`);
  amountIn.copy(bal.sub(new BN(20_000_000))); // leave 0.02 SOL for fees
}

const slot = await connection.getSlot();
const currentPoint =
  config.activationType === 0 ? new BN(slot) : new BN(await connection.getBlockTime(slot));

const tx = await client.pool.swap2({
  swapMode: SwapMode.PartialFill,
  amountIn,
  minimumAmountOut: new BN(0),
  owner: wallet.publicKey,
  pool: pool.publicKey,
  swapBaseForQuote: false,
  referralTokenAccount: null,
  payer: wallet.publicKey,
});
const sig = await sendAndConfirmTransaction(connection, tx, [wallet], { commitment: 'confirmed' });
console.log('partial-fill buy sig:', sig);

const after = await client.state.getPool(pool.publicKey);
const progress = await client.state.getPoolQuoteTokenCurveProgress(pool.publicKey);
console.log('reserve after:', after.poolState.quoteReserve.toString(), 'progress:', (progress * 100).toFixed(2) + '%');
