/**
 * Tiny file-backed store for launch records, token metadata and images.
 * Data lives in <app>/data/ (gitignored). Good enough for the hackathon demo;
 * swap for a real DB before any production use.
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.VERCEL
  ? path.join('/tmp', 'oddscraft-data') // serverless FS is read-only except /tmp (ephemeral)
  : path.join(process.cwd(), 'data');
const LAUNCHES_FILE = path.join(DATA_DIR, 'launches.json');
const META_DIR = path.join(DATA_DIR, 'metadata');
const IMG_DIR = path.join(DATA_DIR, 'images');

function ensureDirs() {
  for (const d of [DATA_DIR, META_DIR, IMG_DIR]) fs.mkdirSync(d, { recursive: true });
}

export type LaunchRecord = {
  id: string; // mint
  createdAt: string;
  wallet: string;
  cluster: string;
  // Panta side
  createId: string;
  marketId?: string;
  pantaSignature?: string;
  question: string;
  category: string;
  endTime: number;
  // Meteora DBC side
  mint: string;
  poolTxSignature?: string;
  poolAddress?: string;
  configKey: string;
  tokenName: string;
  tokenSymbol: string;
  metadataUri: string;
  status: 'prepared' | 'pool_created' | 'registered' | 'failed';
  error?: string;
};

export function saveLaunch(rec: LaunchRecord) {
  ensureDirs();
  const all = listLaunches();
  const idx = all.findIndex((r) => r.id === rec.id);
  if (idx >= 0) all[idx] = rec;
  else all.push(rec);
  fs.writeFileSync(LAUNCHES_FILE, JSON.stringify(all, null, 2));
}

export function listLaunches(): LaunchRecord[] {
  ensureDirs();
  if (!fs.existsSync(LAUNCHES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LAUNCHES_FILE, 'utf8')) as LaunchRecord[];
  } catch {
    return [];
  }
}

export function getLaunch(id: string): LaunchRecord | undefined {
  return listLaunches().find((r) => r.id === id || r.marketId === id || r.mint === id);
}

export type TokenMetadata = {
  name: string;
  symbol: string;
  description?: string;
  image: string;
  website?: string;
  twitter?: string;
  extensions?: Record<string, string>;
};

export function saveMetadata(mint: string, meta: TokenMetadata) {
  ensureDirs();
  fs.writeFileSync(path.join(META_DIR, `${mint}.json`), JSON.stringify(meta, null, 2));
}

export function getMetadata(mint: string): TokenMetadata | null {
  const p = path.join(META_DIR, `${mint}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as TokenMetadata;
  } catch {
    return null;
  }
}

export function saveImage(mint: string, buf: Buffer, ext: string) {
  ensureDirs();
  fs.writeFileSync(path.join(IMG_DIR, `${mint}.${ext}`), buf);
}

export function getImage(mint: string): { buf: Buffer; ext: string } | null {
  ensureDirs();
  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']) {
    const p = path.join(IMG_DIR, `${mint}.${ext}`);
    if (fs.existsSync(p)) return { buf: fs.readFileSync(p), ext };
  }
  return null;
}
