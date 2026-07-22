/* =========================================================
   Word Train — Discord Activity + leaderboard integration
   ---------------------------------------------------------
   Runs alongside the game's own inline script. It:
     1. does the Discord handshake and signs the player in
     2. posts finished scores to our server
     3. replaces the HIGH SCORES screen with the live board

   Everything is defensive: outside Discord, or if the network
   is down, the game falls back to its original local scores.
   ========================================================= */

import { DiscordSDK } from '@discord/embedded-app-sdk'

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID
const inDiscord = new URLSearchParams(location.search).has('frame_id')

// Inside an Activity every request must travel through Discord's proxy.
const api = (p) => (inDiscord ? '/.proxy' : '') + p

const ctx = { inDiscord, ready: false, user: null, token: null, guildId: null }
window.WT_DISCORD = ctx

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/* ---------- leaderboard API ---------- */

async function fetchBoard(map) {
  const qs = new URLSearchParams({ map, limit: '10' })
  if (ctx.guildId) qs.set('guildId', ctx.guildId)
  const r = await fetch(api('/api/leaderboard?' + qs))
  if (!r.ok) throw new Error('board')
  return (await r.json()).leaderboard || []
}

async function postScore(score, map) {
  if (!ctx.token) return null
  const r = await fetch(api('/api/scores'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.token}` },
    body: JSON.stringify({ score, map, guildId: ctx.guildId })
  })
  if (!r.ok) return null
  return r.json()
}

/* The game declares `const MAPS`, which isn't on window by default — the
   build patches it in. Fall back to reading the menu's map cards so a
   missed patch degrades gracefully instead of breaking the board. */
function getMaps() {
  if (Array.isArray(window.MAPS) && window.MAPS.length) return window.MAPS
  return [...document.querySelectorAll('.map-list .mc')]
    .map(el => ({
      name: el.querySelector('.mc-name')?.textContent.trim(),
      icon: el.querySelector('.mc-icon')?.textContent.trim() || ''
    }))
    .filter(m => m.name)
}

/* ---------- hook the game ---------- */

function hookGame() {
  // 1. Every finished run also goes to the server.
  const localSave = window.saveHS
  if (typeof localSave === 'function') {
    window.saveHS = function (name, score, map) {
      try { localSave.apply(this, arguments) } catch (e) { /* local store may be blocked */ }
      postScore(Number(score) | 0, String(map)).catch(() => {})
    }
  }

  // 2. The HIGH SCORES screen shows the live board instead of this device's.
  const localRender = window.renderHS
  if (typeof localRender !== 'function') return

  window.renderHS = function () {
    const el = document.getElementById('hsc')
    if (!el) return
    // No server identity (plain browser / signed out) → original behaviour.
    if (!ctx.ready) return localRender.apply(this, arguments)

    const maps = getMaps()
    if (!maps.length) return localRender.apply(this, arguments)
    el.innerHTML = '<div class="hs-empty">LOADING LEADERBOARD…</div>'

    Promise.all(maps.map(m => fetchBoard(m.name).catch(() => null)))
      .then(results => {
        if (results.every(r => r === null)) return localRender.call(window) // all failed → local
        let html = `<div style="font-size:9px;letter-spacing:3px;color:#2a6a2a;text-align:center;margin-bottom:10px">
          ${ctx.guildId ? 'THIS SERVER' : 'GLOBAL'} · LIVE LEADERBOARD</div>`

        maps.forEach((m, i) => {
          const rows = results[i] || []
          html += `<div style="margin-bottom:14px">
            <div style="font-size:10px;letter-spacing:2px;color:#44aa44;margin-bottom:4px;padding:3px 0;border-bottom:1px solid #1a3a1a">${esc(m.icon)} ${esc(m.name)}</div>`
          if (!rows.length) {
            html += '<div style="font-size:11px;color:#1a3a1a;padding:4px 7px;letter-spacing:1px">NO SCORES YET</div>'
          } else {
            html += `<table class="hs-table">
              <tr><th class="rk">#</th><th>Player</th><th class="pt">Score</th></tr>
              ${rows.map((r, n) => {
                const me = ctx.user && r.userId === ctx.user.id
                const av = r.avatar
                  ? `<img src="${esc(r.avatar)}" alt="" style="width:16px;height:16px;border-radius:50%;vertical-align:middle;margin-right:6px">`
                  : ''
                return `<tr${me ? ' style="background:#0a2210"' : ''}>
                  <td class="rk">${n + 1}</td>
                  <td>${av}${esc((r.username || '').toUpperCase())}${me ? ' <span style="color:#33ff44">(YOU)</span>' : ''}</td>
                  <td class="pt">${Number(r.score) | 0}</td>
                </tr>`
              }).join('')}
            </table>`
          }
          html += '</div>'
        })
        el.innerHTML = html
      })
      .catch(() => localRender.call(window))
  }

  // If the player is already staring at the scores screen, refresh it.
  if (document.getElementById('screen-hiscores')?.classList.contains('active')) {
    window.renderHS()
  }
}

/* ---------- boot ---------- */

async function boot() {
  if (!inDiscord) {
    console.log('[WordTrain] Not inside Discord — standalone mode, local scores only.')
    return
  }
  if (!CLIENT_ID) {
    console.warn('[WordTrain] VITE_DISCORD_CLIENT_ID not set — skipping Discord setup.')
    return
  }

  try {
    const sdk = new DiscordSDK(CLIENT_ID)
    window.WT_SDK = sdk

    await sdk.ready()
    ctx.guildId = sdk.guildId || null

    // Identity, so scores belong to a real Discord account.
    const { code } = await sdk.commands.authorize({
      client_id: CLIENT_ID,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify', 'guilds']
    })

    const res = await fetch(api('/api/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    })
    if (!res.ok) throw new Error('token exchange failed')
    const { access_token } = await res.json()

    const auth = await sdk.commands.authenticate({ access_token })
    ctx.token = access_token
    ctx.user = auth?.user || null
    ctx.ready = true
    console.log('[WordTrain] Signed in as', ctx.user?.username, '· guild', ctx.guildId)

    // Pre-fill the name box so the player doesn't have to type it.
    const nameInput = document.getElementById('pname') || document.querySelector('.name-row input')
    if (nameInput && !nameInput.value && ctx.user) {
      nameInput.value = (ctx.user.global_name || ctx.user.username || '').slice(0, 12).toUpperCase()
    }
  } catch (err) {
    console.error('[WordTrain] Discord setup failed — game still playable, local scores only.', err)
  } finally {
    hookGame()
  }
}

// The game's inline script is a classic script, so its functions already
// exist as globals by the time this deferred module runs.
boot()
