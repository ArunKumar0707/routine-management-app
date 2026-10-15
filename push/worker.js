/* DayFlow push worker (Cloudflare Workers, free tier)
 *
 * What it does
 *   - The DayFlow page sends this worker your Web Push subscription plus the current routine (POST /sync).
 *   - A cron trigger runs every minute. For every stored subscription it works out which activities start
 *     (or are about to start) in that exact minute, in the subscriber's own time zone, and sends a Web Push.
 *   - Android / desktop Chrome then shows the notification even if DayFlow is closed.
 *
 * Bindings / variables (see SETUP.md)
 *   KV namespace  DAYFLOW            stores subscriptions + routines (one key: "subs")
 *   Secret        VAPID_PRIVATE_JWK  private signing key (JSON, from generate-vapid-keys.js)
 *   Var           VAPID_PUBLIC       matching public key (base64url)
 *   Var           VAPID_SUBJECT      e.g. "mailto:you@example.com"
 *   Var           ALLOWED_ORIGIN     your site, e.g. "https://your-name.github.io" (comma-separate several)
 *
 * No dependencies: Web Push encryption (RFC 8291, aes128gcm) and VAPID (RFC 8292) use WebCrypto.
 */

const enc = new TextEncoder();

/* ---------- base64url helpers ---------- */
const b64u = bytes => {
  let s = '';
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = str => {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

/* ---------- Web Push payload encryption (RFC 8291, aes128gcm) ---------- */
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}
/* opts (tests only): { asKeyPair: { privateKey, publicRaw }, salt } */
async function encryptPayload(subscription, payload, opts = {}) {
  const uaPublic = unb64u(subscription.keys.p256dh);   // 65-byte uncompressed P-256 point
  const authSecret = unb64u(subscription.keys.auth);   // 16 bytes
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('bad p256dh');

  let asPrivate, asPublic;
  if (opts.asKeyPair) { asPrivate = opts.asKeyPair.privateKey; asPublic = opts.asKeyPair.publicRaw; }
  else {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPrivate = kp.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));

  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const plain = concat(payload, new Uint8Array([2]));  // 0x02 = last (and only) record delimiter
  if (plain.length > 4096 - 16) throw new Error('payload too large');
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));

  const header = concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPublic.length]), asPublic); // rs = 4096
  return concat(header, cipher);
}

/* ---------- VAPID (RFC 8292) ---------- */
async function vapidAuthHeader(endpoint, env, nowMs = Date.now()) {
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:admin@example.com'
  })));
  const jwk = typeof env.VAPID_PRIVATE_JWK === 'string' ? JSON.parse(env.VAPID_PRIVATE_JWK) : env.VAPID_PRIVATE_JWK;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`))); // raw r||s
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}

/* Only push services we expect — stops the worker being used to call arbitrary URLs. */
const PUSH_HOSTS = [
  /(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/
];
function validEndpoint(ep) {
  try { const u = new URL(ep); return u.protocol === 'https:' && PUSH_HOSTS.some(r => r.test(u.hostname)); } catch (e) { return false; }
}

async function sendPush(subscription, message, env, { ttl = 600, urgency = 'high' } = {}) {
  const body = await encryptPayload(subscription, enc.encode(JSON.stringify(message)));
  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthHeader(subscription.endpoint, env),
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      TTL: String(ttl), Urgency: urgency
    },
    body
  });
}

/* ---------- time + schedule logic ---------- */
function fmtTime(min) {
  const m = ((min % 1440) + 1440) % 1440, h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function fmtDur(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}
const durationOf = a => (a.end - a.start + 1440) % 1440;
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function validTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; } }
function localParts(ms, tz) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short'
  }).formatToParts(new Date(ms))) parts[p.type] = p.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: (+parts.hour) * 60 + (+parts.minute), dow: DOW[parts.weekday] };
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { date: t.toISOString().slice(0, 10), dow: t.getUTCDay() };
}
function visibleOn(a, day) {
  switch (a.repeat) {
    case 'daily': return true;
    case 'weekdays': return day.dow >= 1 && day.dow <= 5;
    case 'weekends': return day.dow === 0 || day.dow === 6;
    default: return !a.date || a.date === day.date;
  }
}
/* Alerts that fire in the exact minute containing `ms`, for one stored subscriber record. */
function dueAlerts(rec, ms) {
  const tz = validTz(rec.tz) ? rec.tz : 'UTC';
  const now = localParts(ms, tz);
  const today = { date: now.date, dow: now.dow }, tomorrow = addDays(now.date, 1);
  const out = [];
  for (const a of rec.activities || []) {
    const raw = a.start - rec.lead;
    if (((raw + 1440) % 1440) !== now.minutes) continue;
    if (!visibleOn(a, raw < 0 ? tomorrow : today)) continue;
    const title = rec.lead ? `Starting in ${rec.lead} min: ${a.name}` : `Started: ${a.name}`;
    out.push({
      title: a.icon ? `${a.icon} ${title}` : title,
      body: `${fmtTime(a.start)} – ${fmtTime(a.end)} · ${fmtDur(durationOf(a))}${a.notes ? ' — ' + a.notes : ''}`,
      tag: `dayflow-${a.id}`
    });
  }
  return out;
}

/* ---------- input validation ---------- */
const REPEATS = ['none', 'daily', 'weekdays', 'weekends'];
function cleanActivities(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list.slice(0, 200)) {
    if (!a || typeof a !== 'object') continue;
    const name = String(a.name || '').trim().slice(0, 60);
    const start = Math.round(Number(a.start)); let end = Math.round(Number(a.end));
    if (!name || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > 1439 || end < 0 || end > 1440) continue;
    if (end === 1440) end = 0;
    if (start === end) continue;
    out.push({
      id: String(a.id || '').slice(0, 40) || name, name, start, end,
      icon: String(a.icon || '').slice(0, 8), notes: String(a.notes || '').slice(0, 300),
      repeat: REPEATS.includes(a.repeat) ? a.repeat : 'daily',
      ...(typeof a.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? { date: a.date } : {})
    });
  }
  return out;
}
async function idFor(endpoint) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(endpoint)));
  return b64u(h).slice(0, 22);
}
async function loadSubs(env) {
  try { return JSON.parse((await env.DAYFLOW.get('subs')) || '{}') || {}; } catch (e) { return {}; }
}
const saveSubs = (env, subs) => env.DAYFLOW.put('subs', JSON.stringify(subs));

/* ---------- HTTP ---------- */
/* Accepts "https://you.github.io", "https://you.github.io/", or even "https://you.github.io/dayflow/" — only the origin matters. */
function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
    try { const o = new URL(s).origin; return o === 'null' ? s : o; } catch (e) { return s; }
  });
}
function corsHeaders(req, env) {
  const list = allowedOrigins(env), origin = req.headers.get('Origin');
  const h = { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  if (!list.length) h['Access-Control-Allow-Origin'] = '*';
  else if (origin && list.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
const json = (obj, status, cors) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });

async function handleFetch(req, env) {
  const cors = corsHeaders(req, env);
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method === 'GET') return new Response('DayFlow push worker is running.', { headers: { 'Content-Type': 'text/plain', ...cors } });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);

  const list = allowedOrigins(env), origin = req.headers.get('Origin');
  if (list.length && origin && !list.includes(origin)) return json({ error: 'origin not allowed' }, 403, cors);

  const text = await req.text();
  if (text.length > 100000) return json({ error: 'too large' }, 413, cors);
  let data; try { data = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400, cors); }

  if (url.pathname === '/sync') {
    const sub = data.subscription;
    if (!sub || !validEndpoint(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return json({ error: 'invalid subscription' }, 400, cors);
    try { await encryptPayload(sub, new Uint8Array([0])); } catch (e) { return json({ error: 'invalid subscription keys' }, 400, cors); }
    const subs = await loadSubs(env);
    const id = await idFor(sub.endpoint);
    if (!subs[id] && Object.keys(subs).length >= 200) return json({ error: 'subscriber limit reached' }, 429, cors);
    subs[id] = {
      sub: { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } },
      tz: validTz(data.tz) ? data.tz : 'UTC',
      lead: [0, 5, 10, 15].includes(Number(data.lead)) ? Number(data.lead) : 0,
      enabled: data.enabled !== false,
      activities: cleanActivities(data.activities),
      updated: Date.now()
    };
    await saveSubs(env, subs);
    return json({ ok: true, activities: subs[id].activities.length }, 200, cors);
  }
  if (url.pathname === '/unsubscribe' || url.pathname === '/test') {
    const endpoint = data.endpoint;
    if (!validEndpoint(endpoint)) return json({ error: 'invalid endpoint' }, 400, cors);
    const subs = await loadSubs(env), id = await idFor(endpoint);
    if (url.pathname === '/unsubscribe') { delete subs[id]; await saveSubs(env, subs); return json({ ok: true }, 200, cors); }
    if (!subs[id]) return json({ error: 'not subscribed — open DayFlow and turn background alerts on again' }, 404, cors);
    const r = await sendPush(subs[id].sub, { title: 'DayFlow test', body: 'Background alerts are working. 🎉', tag: 'dayflow-test', test: true }, env, { ttl: 60 });
    if (r.status === 404 || r.status === 410) { delete subs[id]; await saveSubs(env, subs); }
    return json({ ok: r.ok, status: r.status }, r.ok ? 200 : 502, cors);
  }
  return json({ error: 'not found' }, 404, cors);
}

async function handleScheduled(event, env) {
  const minuteMs = Math.floor(event.scheduledTime / 60000) * 60000;
  const subs = await loadSubs(env);
  const dead = [];
  await Promise.all(Object.entries(subs).map(async ([id, rec]) => {
    if (!rec || rec.enabled === false) return;
    for (const msg of dueAlerts(rec, minuteMs)) {
      try {
        const r = await sendPush(rec.sub, msg, env);
        if (r.status === 404 || r.status === 410) dead.push(id);   // subscription expired / app uninstalled
      } catch (e) { /* try again next alert */ }
    }
  }));
  if (dead.length) {
    const fresh = await loadSubs(env);
    dead.forEach(id => { delete fresh[id]; });
    await saveSubs(env, fresh);
  }
}

export default {
  fetch: (req, env) => handleFetch(req, env),
  scheduled: (event, env, ctx) => { ctx.waitUntil(handleScheduled(event, env)); }
};
