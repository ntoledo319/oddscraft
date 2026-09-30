/**
 * POST /api/upload — builds an unsigned DBC pool-create transaction.
 * Forked from meteora-invent fun-launch; Cloudflare R2 replaced with the app's
 * own /api/token-image + /api/metadata endpoints ($0, no external storage).
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { Connection, PublicKey } from '@solana/web3.js';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { saveImage, saveMetadata } from '@/lib/store';
import { defaultImageSvg } from '@/pages/api/launch/prepare';

const RPC_URL = process.env.RPC_URL as string;
const POOL_CONFIG_KEY = process.env.POOL_CONFIG_KEY as string;

if (!RPC_URL || !POOL_CONFIG_KEY) {
  throw new Error('Missing required environment variables (RPC_URL, POOL_CONFIG_KEY)');
}

type UploadRequest = {
  tokenLogo?: string; // data URI (optional — default SVG generated)
  tokenName: string;
  tokenSymbol: string;
  mint: string;
  userWallet: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tokenLogo, tokenName, tokenSymbol, mint, userWallet } = req.body as UploadRequest;

    if (!tokenName || !tokenSymbol || !mint || !userWallet) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const base = process.env.APP_ORIGIN ?? `http://${req.headers.host ?? 'localhost:3000'}`;

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

    const metadataUrl = `${base}/api/metadata/${mint}.json`;
    saveMetadata(mint, { name: tokenName, symbol: tokenSymbol, image: imageUrl });

    const connection = new Connection(RPC_URL, 'confirmed');
    const client = new DynamicBondingCurveClient(connection, 'confirmed');

    const poolTx = await client.creator.createPool({
      config: new PublicKey(POOL_CONFIG_KEY),
      baseMint: new PublicKey(mint),
      name: tokenName,
      symbol: tokenSymbol,
      uri: metadataUrl,
      payer: new PublicKey(userWallet),
      poolCreator: new PublicKey(userWallet),
    });

    const { blockhash } = await connection.getLatestBlockhash();
    poolTx.feePayer = new PublicKey(userWallet);
    poolTx.recentBlockhash = blockhash;

    res.status(200).json({
      success: true,
      metadataUrl,
      poolTx: poolTx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64'),
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
