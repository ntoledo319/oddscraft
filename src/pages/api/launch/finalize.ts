/**
 * POST /api/launch/finalize
 * After the client has broadcast (a) the DBC pool-create tx and (b) the Panta
 * market-create tx, this registers the market with Panta and records the
 * marketId ↔ DBC pool/mint mapping that powers the OddsCraft paired view.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { Connection, PublicKey } from '@solana/web3.js';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { panta, PantaError } from '@/lib/panta';
import { getLaunch, saveLaunch } from '@/lib/store';

const RPC_URL = process.env.RPC_URL as string;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { createId, signature, mint, wallet, poolTxSignature } = req.body ?? {};
  if (!createId || !signature || !mint || !wallet) {
    return res.status(400).json({ error: 'Missing createId/signature/mint/wallet' });
  }

  const rec = getLaunch(mint);
  if (rec && poolTxSignature) {
    saveLaunch({ ...rec, poolTxSignature, status: 'pool_created' });
  }

  try {
    const register = await panta.createRegister(createId, signature);

    // Resolve the on-chain DBC pool address from the mint (best-effort).
    let poolAddress: string | undefined;
    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const dbc = new DynamicBondingCurveClient(connection, 'confirmed');
      const pool = await dbc.state.getPoolByBaseMint(new PublicKey(mint));
      poolAddress = pool?.publicKey.toBase58();
    } catch (e) {
      console.warn('pool address resolution failed (non-fatal):', e);
    }

    const updated = getLaunch(mint);
    if (updated) {
      saveLaunch({
        ...updated,
        marketId: register.marketId,
        pantaSignature: signature,
        poolTxSignature: poolTxSignature ?? updated.poolTxSignature,
        poolAddress,
        status: 'registered',
      });
    }

    return res.status(200).json({ register, poolAddress });
  } catch (e) {
    if (e instanceof PantaError) {
      const failed = getLaunch(mint);
      if (failed) saveLaunch({ ...failed, status: 'failed', error: e.code });
      return res.status(e.status).json({ error: e.code, detail: e.body });
    }
    console.error('launch/finalize error:', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
}
