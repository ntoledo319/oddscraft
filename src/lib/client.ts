/**
 * Browser-side helpers: our API routes + unsigned-tx assembly for Panta flows.
 * Adapted from github.com/Kaito-HQ/panta-api-playground (MIT-style reference).
 */
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { BuiltInstruction } from './panta';

export async function apiFetch<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const qs = opts.query ? '?' + new URLSearchParams(opts.query).toString() : '';
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${path}${qs}`, { method: opts.method ?? 'GET', headers, body });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const msg =
      parsed && typeof parsed === 'object'
        ? ((parsed as Record<string, unknown>).error ??
          (parsed as Record<string, unknown>).code ??
          `HTTP ${res.status}`)
        : `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return parsed as T;
}

/** Calls the server-side Panta proxy (/api/panta/*) which holds the API key. */
export function pantaProxy<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  return apiFetch<T>(`/api/panta${path.startsWith('/') ? path : `/${path}`}`, opts);
}

export function deserializeVersionedTx(base64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
}

export function instructionsToVersionedTx(
  instructions: BuiltInstruction[],
  feePayer: PublicKey,
  recentBlockhash: string,
): VersionedTransaction {
  const ixs = instructions.map(
    (ix) =>
      new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.accounts.map((a) => ({
          pubkey: new PublicKey(a.pubkey),
          isSigner: a.isSigner,
          isWritable: a.isWritable,
        })),
        data: Buffer.from(ix.data, 'base64'),
      }),
  );
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash,
    instructions: ixs,
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

export function explorerTx(sig: string, cluster: string): string {
  const base = `https://solscan.io/tx/${sig}`;
  return cluster === 'mainnet-beta' ? base : `${base}?cluster=${cluster}`;
}

export function explorerAccount(addr: string, cluster: string): string {
  const base = `https://solscan.io/account/${addr}`;
  return cluster === 'mainnet-beta' ? base : `${base}?cluster=${cluster}`;
}
