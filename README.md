# Word Train — Discord Activity

The Word Train arcade game, playable **inside Discord**, with a live
server-wide leaderboard.

```
WordTrainDiscord/
├── client/          the game + Discord SDK  (Vite → public/)
│   ├── index.html   the game (patched copy of wordtrain.html)
│   └── src/discord.js  handshake, sign-in, score posting, leaderboard UI
├── server/
│   ├── index.js     Express: serves the game + leaderboard API
│   └── db.js        Postgres (falls back to a JSON file locally)
├── public/          built game (generated — gitignored)
└── package.json     `npm run build` then `npm start`
```

**API**

| Route | Purpose |
| --- | --- |
| `POST /api/token` | Swaps Discord's OAuth code for a token (secret stays server-side) |
| `POST /api/scores` | Submit a score — requires a valid Discord token |
| `GET /api/leaderboard` | Top scores, filterable by `map` and `guildId` |
| `GET /api/health` | Sanity check |

Scores are stored per player *per Discord server*, so every guild gets its own
board. The board shows each player's **personal best**, highest first.

---

## Deploy: GitHub → Railway

### 1. Push this folder to GitHub
```bash
cd WordTrainDiscord
git init
git add .
git commit -m "Word Train Discord Activity"
git branch -M main
git remote add origin https://github.com/<you>/wordtrain-discord.git
git push -u origin main
```

### 2. Create the Railway project
1. Railway → **New Project** → **Deploy from GitHub repo** → pick this repo.
2. In that project: **+ New** → **Database** → **Add PostgreSQL**.
   Railway wires `DATABASE_URL` in automatically — the tables create themselves
   on first boot.
3. Open your app service → **Variables** → add:
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
   - `VITE_DISCORD_CLIENT_ID`  *(same value as the Client ID)*
4. **Settings → Networking → Generate Domain.** Copy it, e.g.
   `wordtrain-production.up.railway.app`.

Every `git push` redeploys from here on.

### 3. Set up the Discord app
1. <https://discord.com/developers/applications> → **New Application** → *Word Train*.
2. **OAuth2** → copy the **Client ID** and **Client Secret** into Railway (step 2.3).
   Under *Redirects* add `https://127.0.0.1` and save.
3. **Installation** → enable both **User Install** and **Guild Install**.
4. **Activities** → toggle **Enable Activities** on.
5. **Activities → URL Mappings** → add:

   | Prefix | Target |
   | --- | --- |
   | `/` | `wordtrain-production.up.railway.app` |

   (host only — no `https://`)

### 4. Play
Join a **voice channel** in your server → click the **rocket** 🚀 → **Word Train**.
Finish a run and your score lands on the server board automatically.

---

## Local development

```bash
cp .env.example .env      # fill in your IDs
npm install
npm run build             # build the client into public/
npm start                 # http://localhost:3001 — game + API
```

Or, for hot-reloading the game while the API runs alongside:

```bash
npm run dev:server        # API on :3001
npm run dev               # game on :5174, proxies /api to :3001
```

Without `DATABASE_URL` the server keeps scores in `.local-scores.json`, so you
can develop with no database installed.

> Activities only fully work **inside Discord**. Opening the URL in a browser
> runs the game standalone with local scores — handy for testing gameplay.
> For live iteration inside Discord, run
> `cloudflared tunnel --url http://localhost:3001` and point the URL Mapping
> at the tunnel while you work.

---

## Notes

- **The game files are a patched copy.** `client/index.html` came from
  `NewApp/wordtrain-exe/wordtrain.html` with three surgical edits: guarded
  `localStorage` writes (they throw in Discord's sandbox), an injected SDK
  `<script type="module">`, and `window.MAPS=MAPS;` so the leaderboard can read
  the map list. It's 1.7 MB — patch it with a script, not an editor.
- **Score trust.** Scores are reported by the browser, so a determined player
  could forge one. Identity can't be faked (the server asks Discord who the
  token belongs to), and there's a sanity ceiling plus a per-user rate limit.
  That's the right level of rigor for a community board; true anti-cheat would
  mean simulating the game server-side.
- **Never** put `DISCORD_CLIENT_SECRET` in anything under `client/` — only
  `VITE_`-prefixed vars reach the browser, and the secret must not be one.
