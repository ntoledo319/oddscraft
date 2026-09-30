/**
 * POST /api/launch/prepare
 * One call that starts the paired launch:
 *   1. stores the conviction-token image + metadata (served from /api/token-image, /api/metadata)
 *   2. gets a Panta market-create quote (fee, createId)
 *   3. builds the unsigned Meteora DBC pool-create transaction on our OddsCraft curve config
 * Returns both so the client can sign the DBC tx (mint keypair + wallet) and broadcast it,
 * then proceed to /api/panta/markets/create/build + /api/launch/finalize.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { Connection, PublicKey } from '@solana/web3.js';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { panta, PantaError, CreateMarketParams } from '@/lib/panta';
import { saveImage, saveLaunch, saveMetadata } from '@/lib/store';

const RPC_URL = process.env.RPC_URL as string;
const POOL_CONFIG_KEY = process.env.POOL_CONFIG_KEY as string;
const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? 'devnet';

function origin(req: NextApiRequest): string {
  return process.env.APP_ORIGIN ?? `http://${req.headers.host ?? 'localhost:3000'}`;
}

export function defaultImageSvg(symbol: string): string {
  const s = symbol.slice(0, 6).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1a1b2e"/><stop offset="1" stop-color="#2d1b4e"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><circle cx="256" cy="216" r="110" fill="none" stroke="#a78bfa" stroke-width="10" opacity="0.6"/><text x="256" y="250" font-family="monospace" font-size="64" font-weight="bold" fill="#e9e4ff" text-anchor="middle">${s}</text><text x="256" y="430" font-family="monospace" font-size="30" fill="#8b86a8" text-anchor="middle">ODDSCRAFT</text></svg>`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!RPC_URL || !POOL_CONFIG_KEY)
    return res.status(500).json({ error: 'Server missing RPC_URL / POOL_CONFIG_KEY' });

  try {
    const {
      wallet,
      mint,
      question,
      resolutionRule,
      sourcesOfTruth,
      category = 'crypto',
      startTime,
      endTime,
      resolutionTime,
      marketType = 'standard',
      region = 'Global',
      tokenName,
      tokenSymbol,
      tokenLogo, // optional data URI
      description,
    } = req.body;

    if (!wallet || !mint || !question || !resolutionRule || !tokenName || !tokenSymbol) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!startTime || !endTime || !resolutionTime || !(startTime < endTime && endTime <= resolutionTime)) {
      return res.status(400).json({ error: 'Require startTime < endTime <= resolutionTime' });
    }

    const base = origin(req);

    // 1. token image: uploaded logo or generated default
    let imageExt = 'svg';
    let imageBuf: Buffer = Buffer.from(defaultImageSvg(tokenSymbol), 'utf8');
    if (typeof tokenLogo === 'string' && tokenLogo.startsWith('data:')) {
      const m = tokenLogo.match(/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,(.+)$/);
      if (m) {
        imageExt = m[1] === 'svg+xml' ? 'svg' : m[1] === 'jpeg' ? 'jpg' : m[1];
        imageBuf = Buffer.from(m[2], 'base64');
      }
    }
    saveImage(mint, imageBuf, imageExt);
    const imageUrl = `${base}/api/token-image/${mint}`;

    // 2. token metadata (Metaplex-style JSON)
    const metadataUri = `${base}/api/metadata/${mint}.json`;
    saveMetadata(mint, {
      name: tokenName,
      symbol: tokenSymbol,
      description:
        description ??
        `Conviction token for the OddsCraft prediction market: ${question}`,
      image: imageUrl,
      website: base,
      extensions: { marketQuestion: question, platform: 'oddscraft' },
    });

    // 3. Panta market-create quote
    const quoteParams: CreateMarketParams = {
      wallet,
      question,
      resolutionRule,
      sourcesOfTruth: Array.isArray(sourcesOfTruth) ? sourcesOfTruth : [],
      category,
      startTime,
      endTime,
      resolutionTime,
      marketType,
      title: question,
      description: description ?? '',
      imageUrl,
      region,
    };
    const quote = await panta.createQuote(quoteParams);

    // 4. Unsigned DBC pool-create transaction on the OddsCraft conviction-curve config
    const connection = new Connection(RPC_URL, 'confirmed');
    const dbc = new DynamicBondingCurveClient(connection, 'confirmed');
    const poolTx = await dbc.creator.createPool({
      config: new PublicKey(POOL_CONFIG_KEY),
      baseMint: new PublicKey(mint),
      name: tokenName,
      symbol: tokenSymbol,
      uri: metadataUri,
      payer: new PublicKey(wallet),
      poolCreator: new PublicKey(wallet),
    });
    const { blockhash } = await connection.getLatestBlockhash();
    poolTx.feePayer = new PublicKey(wallet);
    poolTx.recentBlockhash = blockhash;

    saveLaunch({
      id: mint,
      createdAt: new Date().toISOString(),
      wallet,
      cluster: CLUSTER,
      createId: quote.createId,
      question,
      category,
      endTime,
      mint,
      configKey: POOL_CONFIG_KEY,
      tokenName,
      tokenSymbol,
      metadataUri,
      status: 'prepared',
    });

    return res.status(200).json({
      createId: quote.createId,
      quote,
      metadataUri,
      imageUrl,
      poolTx: poolTx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64'),
    });
  } catch (e) {
    if (e instanceof PantaError) {
      return res.status(e.status).json({ error: e.code, detail: e.body });
    }
    console.error('launch/prepare error:', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
}
