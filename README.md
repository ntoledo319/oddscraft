# OddsCraft

**Every prediction market gets a token.**

OddsCraft is a prediction-market launchpad terminal: anyone spins up a prediction
market (via the [Panta API](https://docs.panta.market/)) **and** a companion
"conviction token" launched on a custom-configured
[Meteora Dynamic Bonding Curve](https://docs.meteora.ag/developer-guides/dbc) that
graduates to DAMM v2 — plus a live Solana mainnet terminal (Solami) streaming
launch/trade data.

Built for the Colosseum **Crypto World's Fair** hackathon (Sep 14 – Oct 12, 2026)
— main competition, Solana track.

**Live demo: https://oddscraft.vercel.app** (Panta sandbox data via pk_test key;
DBC side pointed at devnet RPC — pool creation activates when the devnet config
lands, see `docs/`). Forked from
[`meteora-invent/scaffolds/fun-launch`](https://github.com/MeteoraAg/meteora-invent)
with Panta integration patterns from
[`panta-api-playground`](https://github.com/Kaito-HQ/panta-api-playground).

## Why this exists

Prediction markets and token launches are the same primitive — a crowd pricing an
outcome — but they live in separate products. OddsCraft pairs them at launch time:

- the **market** (Panta) is where the crowd trades YES/NO on the event;
- the **conviction token** (Meteora DBC) is a tradeable asset whose curve is tuned
  for thin, event-driven markets: a **long/flat custom sqrt-price curve** (heavy
  liquidity in the low-price band so small tickets move price predictably, steep
  tail into graduation) with an **anti-snipe fee schedule** (2.5% → 0.5% linear
  decay over the first hour) and graduation to **DAMM v2**.

The pair is recorded (`marketId ↔ mint/pool`) and shown together in the app.

## Architecture

```
Next.js (pages router) + Tailwind
├── /launch        paired launch: Panta market-create + DBC pool-create, one form
├── /markets       Panta catalog browse, YES/NO primary buys, positions, launches
├── /              token explore + /token/[id] pages (fun-launch scaffold)
├── /create-pool   token-only DBC launch (scaffold flow, R2 removed)
└── /api/*
    ├── launch/prepare    Panta quote + metadata store + unsigned DBC pool tx
    ├── launch/finalize   Panta register + marketId↔pool mapping
    ├── panta/[...path]   proxy injecting the server-held Panta API key
    ├── metadata/[mint]   Metaplex-style token metadata (pool URI target)
    ├── token-image/[mint] token image (uploaded or generated default)
    ├── launches          launch records
    ├── upload            scaffold-compatible pool-tx builder (no R2)
    └── send-transaction  broadcasts a signed legacy tx
```

On-chain: `@meteora-ag/dynamic-bonding-curve-sdk@1.5.11` (web3.js v1, Anchor 0.31).
DBC program id is identical on devnet and mainnet.

## Quickstart

Prereqs: Node ≥ 22.12, pnpm ≥ 10.

```bash
pnpm install
cp .env.example .env      # fill in (below)
pnpm dev                  # http://localhost:3000
```

### Env vars

| Var | What |
|---|---|
| `RPC_URL` / `NEXT_PUBLIC_RPC_URL` | Solana RPC (devnet for the demo: `https://api.devnet.solana.com`, or `http://localhost:8899` for localnet) |
| `NEXT_PUBLIC_CLUSTER` | `devnet` / `localnet` / `mainnet-beta` (wallet adapter + explorer links) |
| `POOL_CONFIG_KEY` / `NEXT_PUBLIC_POOL_CONFIG_KEY` | DBC config account new pools launch on — create your own (below) |
| `PANTA_API_KEY` | self-serve: `POST https://live-api.panta.market/api/v1/auth/register/` then `POST /account/keys/` with `{"env":"test"}`. `pk_test_` keys get **sandbox fixtures**; `pk_live_` hits the live API. |
| `APP_ORIGIN` | public origin used to build absolute metadata/image URLs (default: request host) |

### Create your own curve config (devnet, free)

```bash
git clone https://github.com/MeteoraAg/meteora-invent && cd meteora-invent && pnpm install
# generate keypair (needs PRIVATE_KEY in studio/.env), airdrop 5 devnet SOL:
pnpm studio generate-keypair --network devnet --airdrop
# edit studio/config/dbc_config.jsonc — the OddsCraft "conviction curve" preset
# (custom long/flat sqrt-price curve + anti-snipe fee decay) is in this repo at
# docs/conviction-curve.dbc_config.jsonc — copy it over, set rpcUrl/dryRun, then:
pnpm studio dbc-create-config        # prints the config pubkey → POOL_CONFIG_KEY
```

### Headless end-to-end test

With the app running and a funded keypair (devnet or localnet):

```bash
node scripts/e2e-launch.mjs <keypair.json> http://localhost:3000
```

Runs the whole paired flow without a browser: prepare → sign+broadcast DBC pool →
Panta build/sign/broadcast → register → verifies the mint on-chain and the stored
mapping.

## Status / honest limitations

- **Panta `pk_test_` keys are sandboxed** — Panta serves fixture data and fixture
  transactions for test keys; the quote/build/register code paths are exercised
  for real, but broadcasting a sandbox-built transaction on-chain is a no-op by
  design. Switching to a `pk_live_` key makes the same flow live (mainnet, real
  USDC).
- Token metadata/images are served by the app itself and stored under `data/`
  locally (gitignored) or `/tmp` on Vercel (ephemeral) — fine for a demo; swap in
  permanent storage (e.g. Irys/Arweave) for production.
- The deployed demo uses devnet RPC for the DBC side (reads are free); the
  `POOL_CONFIG_KEY` env must point at a config created on that cluster —
  presets in `docs/conviction-curve*.dbc_config.jsonc`.

## License

MIT — see LICENSE. Scaffold originally by MeteoraAg (meteora-invent, fun-launch).
