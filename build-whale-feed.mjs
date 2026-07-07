// Builds whale-feed.json — the biggest recent DEX trades across CBOINN's trending tokens.
// Runs on GitHub Actions (whose IP is NOT GeckoTerminal-rate-limited like our Cloudflare
// egress), so it gets rich GT trade data the Worker can't fetch reliably itself. The Worker
// then reads this committed JSON from raw.githubusercontent.com and serves /api/tools/whale-feed.
// Zero dependencies (Node 18+ global fetch). Keyless, public on-chain data only.

const GT = 'https://api.geckoterminal.com/api/v2';
const GT_NET = { solana: 'solana', bsc: 'bsc', eth: 'eth' };
const MIN_USD = 1000;        // whale threshold
const TOKENS_PER_CHAIN = 6;  // top trending tokens to scan per chain
const KEEP = 40;             // biggest trades to keep overall

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

async function getJson(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'CBOINN-WhaleFeed/1.0' } });
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await sleep(700);
  }
  return null;
}

// trending tokens from CBOINN's own radar (public) — gives chain, token, pair(pool), symbol, price
async function trending(chain) {
  const d = await getJson(`https://cboinn.com/api/tools/radar?chain=${chain}&mode=trending`);
  const rows = Array.isArray(d?.rows) ? d.rows : [];
  return rows
    .filter((r) => r?.pair && r?.token)
    .sort((a, b) => num(b.volumeH24) - num(a.volumeH24))
    .slice(0, TOKENS_PER_CHAIN)
    .map((r) => ({ chain, token: String(r.token), pool: String(r.pair), symbol: String(r.symbol || '?').slice(0, 16), priceUsd: num(r.priceUsd) }));
}

async function poolWhales(t) {
  const net = GT_NET[t.chain];
  if (!net) return [];
  const d = await getJson(`${GT}/networks/${net}/pools/${t.pool}/trades?trade_volume_in_usd_greater_than=${MIN_USD}`);
  const rows = Array.isArray(d?.data) ? d.data : [];
  const tokLc = t.token.toLowerCase();
  const out = [];
  for (const it of rows) {
    const a = it?.attributes;
    if (!a) continue;
    const fromTok = String(a.from_token_address || '').toLowerCase();
    const toTok = String(a.to_token_address || '').toLowerCase();
    let dir; let amount;
    if (toTok === tokLc) { dir = 'buy'; amount = num(a.to_token_amount); }
    else if (fromTok === tokLc) { dir = 'sell'; amount = num(a.from_token_amount); }
    else continue;
    if (!(amount > 0)) continue;
    out.push({
      chain: t.chain, token: t.token, symbol: t.symbol, dir, amount,
      usd: num(a.volume_in_usd), trader: String(a.tx_from_address || ''),
      txHash: String(a.tx_hash || ''), ts: Date.parse(String(a.block_timestamp || '')) || 0,
    });
  }
  return out;
}

async function main() {
  const tokens = [...(await trending('solana')), ...(await trending('bsc'))];
  const all = [];
  for (const t of tokens) {
    all.push(...(await poolWhales(t)));
    await sleep(500); // be gentle on GT even from GitHub's IP
  }
  // dedup by txHash, rank by USD, keep the biggest
  const byTx = new Map();
  for (const w of all) { const p = byTx.get(w.txHash); if (!p || w.usd > p.usd) byTx.set(w.txHash, w); }
  const whales = [...byTx.values()].sort((a, b) => b.usd - a.usd).slice(0, KEEP);
  // Never overwrite a good feed with an empty one — a transient cold radar / GT blip must not
  // wipe the last-good data (same "never cache empty" discipline the Worker uses).
  if (!whales.length) { console.log(`no whales this run (${tokens.length} tokens) — keeping last-good feed`); return; }
  const feed = { updatedAt: new Date().toISOString(), count: whales.length, whales };
  const { writeFileSync } = await import('node:fs');
  writeFileSync('whale-feed.json', JSON.stringify(feed, null, 2) + '\n');
  console.log(`whale-feed.json: ${whales.length} whales from ${tokens.length} tokens, top $${Math.round(whales[0]?.usd || 0)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
