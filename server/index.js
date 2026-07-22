/* =========================================================
   Word Train — Discord Activity server
   ---------------------------------------------------------
   Serves the built game (public/) and the leaderboard API.

     POST /api/token        code  -> access_token   (OAuth swap)
     POST /api/scores       submit a score          (auth required)
     GET  /api/leaderboard  top scores per map/guild

   Identity is never taken from the client: we hand Discord the
   access token and let Discord tell us who the player is.
   ========================================================= */

import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initDb, addScore, topScores, recentCount, usingPostgres } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, '..', 'public')

const CLIENT_ID = process.env.DISCORD_CLIENT_ID
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET
const PORT = process.env.PORT || 3001

// A score above this is treated as bogus. Raise it if real scores get big.
const MAX_PLAUSIBLE_SCORE = 1_000_000
const MAX_SUBMITS_PER_MIN = 12

const app = express()
app.use(express.json({ limit: '16kb' }))

/* ---------- tiny cache so we don't hit Discord on every request ---------- */
const userCache = new Map() // token -> { user, expires }
const CACHE_MS = 5 * 60 * 1000

async function userFromToken(token) {
  const hit = userCache.get(token)
  if (hit && hit.expires > Date.now()) return hit.user

  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) return null
  const user = await res.json()
  userCache.set(token, { user, expires: Date.now() + CACHE_MS })
  return user
}

function bearer(req) {
  const h = req.get('Authorization') || ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

/* ---------- OAuth: swap the code for a token (secret stays here) ---------- */
app.post('/api/token', async (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: 'Server is missing DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET.' })
  }
  const code = String(req.body?.code || '')
  if (!code) return res.status(400).json({ error: 'Missing code.' })

  try {
    const r = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code
      })
    })
    const data = await r.json()
    if (!r.ok || !data.access_token) {
      return res.status(502).json({ error: data.error_description || 'Token exchange failed.' })
    }
    // Only the access token goes back to the browser.
    res.json({ access_token: data.access_token })
  } catch (e) {
    res.status(502).json({ error: 'Could not reach Discord.' })
  }
})

/* ---------- submit a score ---------- */
app.post('/api/scores', async (req, res) => {
  const token = bearer(req)
  if (!token) return res.status(401).json({ error: 'Sign in to post a score.' })

  const user = await userFromToken(token)
  if (!user?.id) return res.status(401).json({ error: 'Discord did not recognize that session.' })

  const score = Number(req.body?.score)
  const map = String(req.body?.map || '').slice(0, 60)
  const guildId = req.body?.guildId ? String(req.body.guildId).slice(0, 40) : null

  if (!Number.isInteger(score) || score < 0 || score > MAX_PLAUSIBLE_SCORE) {
    return res.status(400).json({ error: 'That score does not look right.' })
  }
  if (!map) return res.status(400).json({ error: 'Missing map.' })

  if (await recentCount(user.id, 60) >= MAX_SUBMITS_PER_MIN) {
    return res.status(429).json({ error: 'Slow down a moment.' })
  }

  await addScore({
    userId: user.id,
    username: user.global_name || user.username,
    avatar: user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
      : null,
    guildId, map, score
  })

  const board = await topScores({ map, guildId, limit: 10 })
  const rank = board.findIndex(r => r.userId === user.id)
  res.json({ ok: true, leaderboard: board, rank: rank === -1 ? null : rank + 1 })
})

/* ---------- read the board ---------- */
app.get('/api/leaderboard', async (req, res) => {
  const map = req.query.map ? String(req.query.map) : null
  const guildId = req.query.guildId ? String(req.query.guildId) : null
  const limit = Math.min(Number(req.query.limit) || 10, 50)
  try {
    res.json({ leaderboard: await topScores({ map, guildId, limit }) })
  } catch (e) {
    res.status(500).json({ error: 'Could not load the leaderboard.' })
  }
})

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, store: usingPostgres ? 'postgres' : 'file', configured: Boolean(CLIENT_ID && CLIENT_SECRET) }))

/* ---------- the game itself ---------- */
app.use(express.static(PUBLIC_DIR))
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')))

initDb()
  .then(() => app.listen(PORT, () => console.log(`[wordtrain] listening on :${PORT}`)))
  .catch(err => { console.error('[wordtrain] startup failed', err); process.exit(1) })
