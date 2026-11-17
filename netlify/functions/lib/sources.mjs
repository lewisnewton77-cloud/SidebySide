// Cover sources for every category. Each resolver returns a public image URL (or null).
const env = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? "");
export const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^the /, "").replace(/[^a-z0-9]+/g, " ").trim();
const UA = { "User-Agent": "side-by-side/1.0 (collection app)" };
const json = async (url, init) => { try { const r = await fetch(url, init); return r.ok ? await r.json() : null; } catch { return null; } };
const best = (list, a, t, getA, getT) => {
  const A = norm(a), T = norm(t); let top = null, score = -1;
  for (const x of list || []) {
    const ra = norm(getA(x)), rt = norm(getT(x)); let s = 0;
    if (rt === T) s += 3; else if (rt && (rt.startsWith(T) || T.startsWith(rt))) s += 2; else if (rt.includes(T)) s += 1;
    if (ra === A) s += 3; else if (ra && (ra.includes(A) || A.includes(ra))) s += 2;
    if (s > score) { score = s; top = x; }
  }
  return score >= 4 ? top : null;
};
const ok = async (url) => { try { const r = await fetch(url, { method: "HEAD", headers: UA, redirect: "follow" }); return r.ok ? url : null; } catch { return null; } };

// LPs: iTunes, then MusicBrainz + Cover Art Archive
async function lp({ a, t }) {
  const d = await json(`https://itunes.apple.com/search?media=music&entity=album&limit=15&term=${encodeURIComponent(a + " " + t)}`);
  const x = best(d?.results, a, t, (r) => r.artistName, (r) => r.collectionName);
  if (x?.artworkUrl100) return x.artworkUrl100.replace(/\/\d+x\d+bb\./, "/600x600bb.");
  const q = `releasegroup:"${t.replace(/"/g, "")}" AND artist:"${a.replace(/"/g, "")}"`;
  const m = await json(`https://musicbrainz.org/ws/2/release-group/?fmt=json&limit=3&query=${encodeURIComponent(q)}`, { headers: UA });
  const rg = m?.["release-groups"]?.[0];
  return rg ? ok(`https://coverartarchive.org/release-group/${rg.id}/front-500`) : null;
}
// Books: iTunes books, then Open Library
async function book({ a, t }) {
  const d = await json(`https://itunes.apple.com/search?media=ebook&entity=ebook&limit=15&term=${encodeURIComponent(a + " " + t)}`);
  const x = best(d?.results, a, t, (r) => r.artistName, (r) => r.trackName);
  if (x?.artworkUrl100) return x.artworkUrl100.replace(/\/\d+x\d+bb\./, "/600x900bb.");
  const o = await json(`https://openlibrary.org/search.json?limit=5&fields=cover_i,title,author_name&title=${encodeURIComponent(t)}&author=${encodeURIComponent(a)}`, { headers: UA });
  const doc = (o?.docs || []).find((d) => d.cover_i);
  return doc ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null;
}
// Cards: Pokémon TCG API (a = set name, t = card name)
async function card({ a, t }) {
  let q = `name:"${t.replace(/"/g, "")}"`;
  if (a) q += ` set.name:"${a.replace(/"/g, "").replace(/ set$/i, "")}*"`;
  const d = await json(`https://api.pokemontcg.io/v2/cards?pageSize=5&q=${encodeURIComponent(q)}`, { headers: env("POKEMONTCG_KEY") ? { "X-Api-Key": env("POKEMONTCG_KEY") } : {} });
  return d?.data?.[0]?.images?.large || null;
}
// Games: GameTDB box scan by product code, then IGDB, then SteamGridDB
let tok = null, tokUntil = 0;
async function twitch() {
  const id = env("TWITCH_CLIENT_ID"), s = env("TWITCH_CLIENT_SECRET"); if (!id || !s) return null;
  if (tok && Date.now() < tokUntil) return tok;
  const j = await json(`https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${s}&grant_type=client_credentials`, { method: "POST" });
  if (!j) return null; tok = j.access_token; tokUntil = Date.now() + (j.expires_in - 300) * 1000; return tok;
}
async function game({ t, code, region }) {
  if (/^[A-Z0-9]{5}$/.test(code || "")) {
    const R = /JPN|JA/i.test(region) ? ["JA", "US", "EN"] : /USA|US/i.test(region) ? ["US", "EN", "JA"] : ["EN", "US", "JA"];
    for (const r of R) for (const k of ["coverHQ", "cover"]) { const u = await ok(`https://art.gametdb.com/switch/${k}/${r}/${code}.jpg`); if (u) return u; }
  }
  const tk = await twitch();
  if (tk) {
    try {
      const r = await fetch("https://api.igdb.com/v4/games", { method: "POST", headers: { "Client-ID": env("TWITCH_CLIENT_ID"), Authorization: `Bearer ${tk}` }, body: `search "${t.replace(/"/g, "")}"; fields name,cover.image_id; where platforms = (130) & cover != null; limit 8;` });
      const L = r.ok ? await r.json() : [], W = norm(t);
      const g = L.find((x) => norm(x.name) === W) || L[0];
      if (g?.cover?.image_id) return `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${g.cover.image_id}.jpg`;
    } catch {}
  }
  const key = env("SGDB_KEY");
  if (key) {
    const H = { Authorization: `Bearer ${key}` };
    const s = await json(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(t)}`, { headers: H });
    const g = s?.data?.[0];
    if (g) { const gr = await json(`https://www.steamgriddb.com/api/v2/grids/game/${g.id}?dimensions=600x900&types=static&nsfw=false&humor=false`, { headers: H }); if (gr?.data?.[0]?.url) return gr.data[0].url; }
  }
  return null;
}
export const RESOLVE = { lp, book, card, game };
// Largest size stored per category (the app fits them to each shape)
export const SIZE = { lp: [600, 600], book: [500, 750], card: [600, 840], game: [640, 1040], watch: [600, 600] };
