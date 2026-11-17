// side by side · art bundle
// POST /api/art  {items:[{key,k,a,t,code?,region?}]}  → {entries:{key:{img,spine?,text?}}, none:[keys], pending:[keys]}
// POST /api/art  {colours:{key:{spine,text}}}          → stores spine colours worked out by a browser, for everyone
// GET  /api/art/img/<key>                              → the stored image, cached for a year
// Each item is resolved once for ALL users (keyed by the item, not the person), resized to its category's size and stored.
import { getStore } from "@netlify/blobs";
import { RESOLVE, SIZE } from "./lib/sources.mjs";

export const config = { path: ["/api/art", "/api/art/img/*"] };
const CORS = { "Access-Control-Allow-Origin": "*" };
const BUDGET_MS = 8000, PARALLEL = 8, MAX_ITEMS = 400;
const safe = (k) => encodeURIComponent(String(k).slice(0, 200));

async function fetchImage(url, kind) {
  const [w, h] = SIZE[kind] || [600, 600];
  // wsrv.nl resizes and converts to WebP; fall back to the original if it is unavailable
  for (const u of [`https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${w}&h=${h}&fit=inside&output=webp&q=82`, url]) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "side-by-side/1.0" } });
      const type = r.headers.get("content-type") || "";
      if (r.ok && type.startsWith("image/")) { const buf = await r.arrayBuffer(); if (buf.byteLength > 3000) return { buf, type }; }
    } catch {}
  }
  return null;
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...CORS, "Access-Control-Allow-Methods": "GET,POST", "Access-Control-Allow-Headers": "Content-Type" } });
  const url = new URL(req.url), imgs = getStore("art-img"), meta = getStore("art-meta");

  if (url.pathname.startsWith("/api/art/img/")) {
    const key = decodeURIComponent(url.pathname.slice("/api/art/img/".length));
    const hit = await imgs.getWithMetadata(safe(key), { type: "arrayBuffer" });
    if (!hit?.data) return new Response("not found", { status: 404, headers: CORS });
    return new Response(hit.data, { headers: { ...CORS, "Content-Type": hit.metadata?.type || "image/webp", "Cache-Control": "public, max-age=31536000, immutable" } });
  }
  if (req.method !== "POST") return new Response("POST items", { status: 405, headers: CORS });

  let body; try { body = await req.json(); } catch { return new Response("bad json", { status: 400, headers: CORS }); }

  if (body.colours && typeof body.colours === "object") {
    let n = 0;
    for (const [key, c] of Object.entries(body.colours).slice(0, MAX_ITEMS)) {
      if (!/^#[0-9a-f]{6}$/i.test(c?.spine || "")) continue;
      const m = (await meta.get(safe(key), { type: "json" })) || {};
      if (m.img && !m.spine) { m.spine = c.spine; if (/^#[0-9a-f]{6}$/i.test(c.text || "")) m.text = c.text; await meta.setJSON(safe(key), m); n++; }
    }
    return Response.json({ saved: n }, { headers: CORS });
  }

  const items = (Array.isArray(body.items) ? body.items : []).filter((x) => x?.key).slice(0, MAX_ITEMS);
  const entries = {}, none = [], todo = [];
  // 1. what is already known comes back at once
  await Promise.all(items.map(async (x) => {
    const m = await meta.get(safe(x.key), { type: "json" });
    if (m?.img) entries[x.key] = { img: `/api/art/img/${encodeURIComponent(x.key)}`, spine: m.spine, text: m.text };
    else if (m?.none && Date.now() - m.none < 7 * 864e5) none.push(x.key); // retry misses after a week
    else if (RESOLVE[x.k]) todo.push(x); else none.push(x.key);
  }));
  // 2. resolve new ones in parallel until the time budget is used; the rest come back as pending
  const t0 = Date.now(), pending = [];
  const worker = async () => {
    while (todo.length) {
      const x = todo.shift();
      if (Date.now() - t0 > BUDGET_MS) { pending.push(x.key); continue; }
      let src = null; try { src = await RESOLVE[x.k]({ a: x.a || "", t: x.t || "", code: x.code || "", region: x.region || "" }); } catch {}
      const im = src && (await fetchImage(src, x.k));
      if (im) {
        await imgs.set(safe(x.key), im.buf, { metadata: { type: im.type, src } });
        await meta.setJSON(safe(x.key), { img: 1, src });
        entries[x.key] = { img: `/api/art/img/${encodeURIComponent(x.key)}` };
      } else { await meta.setJSON(safe(x.key), { none: Date.now() }); none.push(x.key); }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return Response.json({ entries, none, pending }, { headers: { ...CORS, "Cache-Control": "no-store" } });
};
