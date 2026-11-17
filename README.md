# side by side

Collectors' shelf app (records, books, cards, watches, games) with 3D twins.

- `index.html` – the whole app
- `netlify/functions/cover.mjs` – cover service at `/api/cover` (GameTDB → IGDB → SteamGridDB, cached in Netlify Blobs)
- `netlify.toml` – Netlify settings (no build step)

Environment variables (Netlify → Site configuration → Environment variables):

| Name | Where to get it |
|---|---|
| `TWITCH_CLIENT_ID` | dev.twitch.tv → Your Console → Applications → your app |
| `TWITCH_CLIENT_SECRET` | same page → New Secret |
| `SGDB_KEY` | steamgriddb.com → Preferences → API |

Test: `https://<your-site>.netlify.app/api/cover?kind=game&title=Sifu&code=A7XDA&region=USA`
