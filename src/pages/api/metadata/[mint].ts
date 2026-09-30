/**
 * GET /api/metadata/[mint].json — serves the Metaplex-style token metadata
 * stored at launch time. The DBC pool's on-chain URI points here.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { getMetadata } from '@/lib/store';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const mint = String(req.query.mint ?? '').replace(/\.json$/, '');
  const meta = getMetadata(mint);
  if (!meta) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json(meta);
}
