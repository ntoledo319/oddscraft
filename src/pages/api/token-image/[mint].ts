/**
 * GET /api/token-image/[mint] — serves the token image stored at launch time
 * (uploaded logo or the generated default SVG).
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { getImage } from '@/lib/store';

const CT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const mint = String(req.query.mint ?? '').replace(/\.[a-z]+$/, '');
  const img = getImage(mint);
  if (!img) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', CT[img.ext] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).send(img.buf);
}
