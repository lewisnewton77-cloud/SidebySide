// side by side · cover service (Netlify Function)
// GET /api/cover?kind=game&title=Sifu&code=A7XDA&region=USA[&not=gametdb,igdb]
// Looks up a cover once, stores it in Netlify Blobs, then serves the stored copy to every user.
// Order for games: GameTDB box scan (by product code) → IGDB (by title, Switch only) → SteamGridDB (by title).
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/cover" };

const env = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? "");
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "X-Cover-Source" };
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

async function grab(url, init) {
  try {
    const r = await fetch(url, init);
    if (!r.ok) return null;
    const type = r.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return null;
    const buf = await r.arrayBuffer();
    return buf.byteLength > 6000 ? { buf, type } : null; // tiny files are placeholders
  } catch { return null; }
}

// 1. GameTDB: scans of the real box, keyed by the 5-character product code printed on the game card (LA-H-XXXXX-…)
async function gametdb(code, region) {
  if (!/^[A-Z0-9]{5}$/.test(code)) return null;
  const R = /JPN|JA/i.test(region) ? ["JA", "US", "EN"] : /USA|US/i.test(region) ? ["US", "EN", "JA"] : ["EN", "US", "JA"];
  for (const r of R) for (const kind of ["coverHQ", "cover"]) {
    const hit = await grab(`https://art.gametdb.com/switch/${kind}/${r}/${code}.jpg`);
    if (hit) return hit;
  }
  return null;
}

// 2. IGDB (Twitch): official covers for nearly every game. Needs TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET.
let token = null, tokenUntil = 0;
async function twitchToken() {
  const id = env("TWITCH_CLIENT_ID"), secret = env("TWITCH_CLIENT_SECRET");
  if (!id || !secret) return null;
  if (token && Date.now() < tokenUntil) return token;
  const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`, { method: "POST" });
  if (!r.ok) return null;
  const j = await r.json();
  token = j.access_token; tokenUntil = Date.now() + (j.expires_in - 300) * 1000;
  return token;
}
async function igdb(title) {
  const t = await twitchToken(); if (!t || !title) return null;
  const q = `search "${title.replace(/"/g, "")}"; fields name,cover.image_id; where platforms = (130) & cover != null; limit 8;`; // 130 = Nintendo Switch
  try {
    const r = await fetch("https://api.igdb.com/v4/games", { method: "POST", headers: { "Client-ID": env("TWITCH_CLIENT_ID"), Authorization: `Bearer ${t}`, "Content-Type": "text/plain" }, body: q });
    if (!r.ok) return null;
    const list = await r.json(), want = norm(title);
    const g = list.find((x) => norm(x.name) === want) || list.find((x) => norm(x.name).includes(want) || want.includes(norm(x.name))) || list[0];
    if (!g?.cover?.image_id) return null;
    return grab(`https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${g.cover.image_id}.jpg`);
  } catch { return null; }
}

// 3. SteamGridDB: tall 600×900 covers by name. Needs SGDB_KEY.
async function sgdb(title) {
  const key = env("SGDB_KEY"); if (!key || !title) return null;
  const H = { Authorization: `Bearer ${key}` };
  try {
    const s = await (await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(title)}`, { headers: H })).json();
    const want = norm(title), games = s?.data || [];
    const g = games.find((x) => norm(x.name) === want) || games[0]; if (!g) return null;
    const grids = await (await fetch(`https://www.steamgriddb.com/api/v2/grids/game/${g.id}?dimensions=600x900,342x482,660x930&types=static&nsfw=false&humor=false`, { headers: H })).json();
    const rank = (x) => (x.style === "alternate" ? 30 : x.style === "material" ? 20 : 8) + (x.score || 0) * 0.5;
    for (const x of (grids?.data || []).sort((a, b) => rank(b) - rank(a)).slice(0, 4)) {
      const hit = await grab(x.url); if (hit) return hit;
    }
  } catch {}
  return null;
}

const SOURCES = { gametdb: (p) => gametdb(p.code, p.region), igdb: (p) => igdb(p.title), sgdb: (p) => sgdb(p.title) };

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...CORS, "Access-Control-Allow-Methods": "GET" } });
  const u = new URL(req.url);
  const p = { kind: u.searchParams.get("kind") || "game", title: (u.searchParams.get("title") || "").slice(0, 120), code: (u.searchParams.get("code") || "").toUpperCase(), region: u.searchParams.get("region") || "" };
  const not = new Set((u.searchParams.get("not") || "").split(",").filter(Boolean));
  if (p.kind !== "game" || (!p.title && !p.code)) return new Response("unsupported", { status: 400, headers: CORS });

  const key = `game/${p.code || norm(p.title).replace(/ /g, "-")}/${p.region || "any"}/${[...not].sort().join("+") || "all"}`;
  let store = null;
  try { store = getStore("covers"); } catch {}
  if (store) {
    try {
      const hit = await store.getWithMetadata(key, { type: "arrayBuffer" });
      if (hit?.data) return new Response(hit.data, { headers: { ...CORS, "Content-Type": hit.metadata?.type || "image/jpeg", "X-Cover-Source": hit.metadata?.source || "", "Cache-Control": "public, max-age=604800" } });
    } catch {}
  }
  for (const name of ["gametdb", "igdb", "sgdb"]) {
    if (not.has(name)) continue;
    const got = await SOURCES[name](p);
    if (!got) continue;
    if (store) { try { await store.set(key, got.buf, { metadata: { type: got.type, source: name } }); } catch {} }
    return new Response(got.buf, { headers: { ...CORS, "Content-Type": got.type, "X-Cover-Source": name, "Cache-Control": "public, max-age=604800" } });
  }
  return new Response("no cover", { status: 404, headers: CORS });
};
