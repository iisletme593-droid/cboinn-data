// Builds bingx-listings.json — BingX new-listing announcements (Spot + Innovation zone).
// BingX's announcement API blocks our Cloudflare Worker egress IP, but GitHub's IP is fine,
// so this Action fetches it and commits the JSON for the Worker to read + merge with the OKX
// and Bybit listings it fetches directly. Keyless, public announcements only. Node 18+.

const BASE = 'https://open-api.bingx.com/openApi/content/v1/announcement';
const KEEP = 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (CBOINN-Listings/1.0)' } });
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await sleep(600);
  }
  return null;
}

async function one(contentType) {
  const d = await getJson(`${BASE}?contentType=${contentType}&pageSize=15`);
  const data = d?.data;
  const items = Array.isArray(data?.list) ? data.list : (Array.isArray(data) ? data : []);
  return items
    .filter((x) => x && !/delist/i.test(String(x.title || '')))
    .map((x) => {
      const raw = String(x.url || '');
      const url = /^https?:\/\//.test(raw) ? raw : (raw.startsWith('/') ? 'https://bingx.com' + raw : '');
      return { exchange: 'BingX', title: String(x.title || '').slice(0, 150), url, ts: Date.parse(String(x.releaseTime || '')) || 0 };
    })
    .filter((x) => x.title && /^https?:\/\//.test(x.url) && x.ts > 0);
}

async function main() {
  // Sequential (not parallel) — BingX rate-limits rapid bursts; a short gap keeps both calls happy.
  const spot = await one('SpotListing');
  await sleep(800);
  const innov = await one('InnovationListing');
  const byUrl = new Map();
  for (const l of [...spot, ...innov]) if (!byUrl.has(l.url)) byUrl.set(l.url, l);
  const rows = [...byUrl.values()].sort((a, b) => b.ts - a.ts).slice(0, KEEP);
  if (!rows.length) { console.log('no BingX listings this run — keeping last-good'); return; } // never overwrite empty
  const feed = { updatedAt: new Date().toISOString(), count: rows.length, rows };
  const { writeFileSync } = await import('node:fs');
  writeFileSync('bingx-listings.json', JSON.stringify(feed, null, 2) + '\n');
  console.log(`bingx-listings.json: ${rows.length} listings, newest "${rows[0]?.title?.slice(0, 40)}"`);
}
main().catch((e) => { console.error(e); process.exit(1); });
