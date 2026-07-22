/* =========================================================
   Word Train — leaderboard storage
   ---------------------------------------------------------
   Uses Postgres when DATABASE_URL is set (Railway provides it
   automatically once you add a Postgres service). Falls back
   to a local JSON file so the whole thing still runs on your
   machine with no database installed.
   ========================================================= */

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const DATABASE_URL = process.env.DATABASE_URL
export const usingPostgres = Boolean(DATABASE_URL)

let pool = null
const FILE = path.join(process.cwd(), '.local-scores.json')

/* ---------- setup ---------- */

export async function initDb() {
  if (!usingPostgres) {
    if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '[]')
    console.log('[db] No DATABASE_URL — using local file store (dev only).')
    return
  }
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    // Railway's internal network doesn't need SSL; public URLs do.
    ssl: DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false }
  })
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scores (
      id         BIGSERIAL PRIMARY KEY,
      user_id    TEXT    NOT NULL,
      username   TEXT    NOT NULL,
      avatar     TEXT,
      guild_id   TEXT,
      map        TEXT    NOT NULL,
      score      INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_scores_board ON scores (map, guild_id, score DESC);`)
  console.log('[db] Postgres ready.')
}

/* ---------- writes ---------- */

export async function addScore({ userId, username, avatar, guildId, map, score }) {
  if (usingPostgres) {
    await pool.query(
      `INSERT INTO scores (user_id, username, avatar, guild_id, map, score)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, username, avatar, guildId, map, score]
    )
    return
  }
  const all = readFile()
  all.push({ userId, username, avatar, guildId, map, score, createdAt: new Date().toISOString() })
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2))
}

/* ---------- reads ---------- */

/* One row per player (their personal best), highest first. */
export async function topScores({ map, guildId, limit = 10 }) {
  if (usingPostgres) {
    const { rows } = await pool.query(
      `SELECT s.user_id AS "userId",
              (SELECT username FROM scores WHERE user_id = s.user_id ORDER BY created_at DESC LIMIT 1) AS username,
              (SELECT avatar   FROM scores WHERE user_id = s.user_id ORDER BY created_at DESC LIMIT 1) AS avatar,
              MAX(s.score) AS score,
              MAX(s.created_at) AS "at"
         FROM scores s
        WHERE ($1::text IS NULL OR s.map = $1)
          AND ($2::text IS NULL OR s.guild_id = $2)
        GROUP BY s.user_id
        ORDER BY score DESC
        LIMIT $3`,
      [map || null, guildId || null, limit]
    )
    return rows
  }

  const all = readFile().filter(r =>
    (!map || r.map === map) && (!guildId || r.guildId === guildId))
  const best = new Map()
  for (const r of all) {
    const cur = best.get(r.userId)
    if (!cur || r.score > cur.score) best.set(r.userId, { ...r })
    // keep the most recent display name
    if (cur && new Date(r.createdAt) > new Date(cur.at || 0)) {
      cur.username = r.username; cur.avatar = r.avatar
    }
  }
  return [...best.values()]
    .map(r => ({ userId: r.userId, username: r.username, avatar: r.avatar, score: r.score, at: r.createdAt }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/* How many submissions this user made recently (simple rate limit). */
export async function recentCount(userId, seconds = 60) {
  if (usingPostgres) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM scores
        WHERE user_id = $1 AND created_at > now() - ($2 || ' seconds')::interval`,
      [userId, String(seconds)]
    )
    return rows[0]?.n ?? 0
  }
  const cutoff = Date.now() - seconds * 1000
  return readFile().filter(r => r.userId === userId && new Date(r.createdAt).getTime() > cutoff).length
}

function readFile() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] }
}
