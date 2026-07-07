# cboinn-data

Free, scheduled **data pipeline** for [cboinn.com](https://cboinn.com) — powered by GitHub
Actions (free scheduled compute + hosting) so the CBOINN Cloudflare Worker can read data it
can't fetch reliably itself (GeckoTerminal rate-limits our shared CF egress IP; GitHub's IP has
headroom).

## Feeds

| File | Built by | Cadence | Used by |
|------|----------|---------|---------|
| `whale-feed.json` | `build-whale-feed.mjs` | every ~15 min | `GET https://cboinn.com/api/tools/whale-feed` → the Whale Feed |

`whale-feed.json` = the biggest recent DEX trades across CBOINN's trending tokens (Solana +
BSC), from GeckoTerminal — buy/sell, USD size, trader wallet, timestamp. Public on-chain data
only; keyless; no secrets. **For research, not financial advice — a whale move is not a signal.**

The Worker reads the raw file:
`https://raw.githubusercontent.com/<owner>/cboinn-data/main/whale-feed.json`

To run manually: Actions → whale-feed → Run workflow.
