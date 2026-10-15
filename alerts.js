/* DayFlow — activity start alerts (tone + notification + in-app banner).
 * Loaded after app.js; reuses its globals (routine, isVisibleOn, range, duration, fmtDur, todayStr, esc, $).
 * Settings live under their own localStorage key so app data/backups are unaffected. */
(function () {
  'use strict';
  const KEY = 'dayflow.alerts.v1';
  const FIRED_KEY = 'dayflow.alerts.fired';
  const LEADS = [0, 5, 10, 15];

  /* ---------- Settings ---------- */
  const DEFAULTS = { enabled: false, sound: true, notify: true, tone: 'chime', lead: 0, keepAwake: false, push: false };
  function load() {
    try {
      const r = JSON.parse(localStorage.getItem(KEY));
      if (!r || typeof r !== 'object') return { ...DEFAULTS };
      return {
        enabled: !!r.enabled, sound: r.sound !== false, notify: r.notify !== false, keepAwake: !!r.keepAwake, push: !!r.push,
        tone: (['chime', 'beep', 'bell'].includes(r.tone) || (typeof r.tone === 'string' && /^custom:.{1,200}$/.test(r.tone))) ? r.tone : 'chime',
        lead: LEADS.includes(Number(r.lead)) ? Number(r.lead) : 0
      };
    } catch (e) { return { ...DEFAULTS }; }
  }
  const cfg = load();
  function saveCfg() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } }

  /* ---------- Sound (Web Audio, no files needed) ---------- */
  let actx = null;
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { actx = new AC(); } catch (e) { return null; }
    }
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  const TONES = {
    chime: [{ f: 523.25, t: 0, d: 0.55 }, { f: 659.25, t: 0.18, d: 0.55 }, { f: 783.99, t: 0.36, d: 0.9 }],
    beep: [{ f: 880, t: 0, d: 0.16, type: 'square', g: 0.12 }, { f: 880, t: 0.26, d: 0.16, type: 'square', g: 0.12 }, { f: 880, t: 0.52, d: 0.16, type: 'square', g: 0.12 }],
    bell: [{ f: 1318.5, t: 0, d: 1.6 }, { f: 2637, t: 0, d: 0.9, g: 0.08 }, { f: 1318.5, t: 0.7, d: 1.6, g: 0.18 }]
  };
  /* ---------- Custom sounds (files in the sounds/ folder) ---------- */
  const SOUND_DIR = 'sounds/';
  const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)$/i;
  let customSounds = [];      // file names found in sounds/
  let currentAudio = null;
  const prettyName = f => f.replace(AUDIO_EXT, '').replace(/[_-]+/g, ' ').trim() || f;
  function soundUrl(file) { return SOUND_DIR + encodeURIComponent(file); }
  function playFile(file, fallbackTone) {
    try {
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
      const el = new Audio(soundUrl(file));
      currentAudio = el;
      const fallback = () => { if (currentAudio === el) { currentAudio = null; toast('Couldn’t play “' + file + '”. Using the default chime instead.'); playTone(fallbackTone || 'chime'); } };
      el.addEventListener('error', fallback, { once: true });
      const p = el.play();
      if (p && p.catch) p.catch(err => { if (err && err.name === 'NotAllowedError') toast('Click anywhere on the page once so the browser allows sound.'); else fallback(); });
    } catch (e) { playTone(fallbackTone || 'chime'); }
  }
  async function discoverSounds() {
    const found = new Set();
    // 1) manifest: sounds/sounds.js sets window.DAYFLOW_SOUNDS = ['my-tone.mp3', ...]
    if (Array.isArray(window.DAYFLOW_SOUNDS)) window.DAYFLOW_SOUNDS.forEach(f => { if (typeof f === 'string' && AUDIO_EXT.test(f)) found.add(f); });
    // 2) automatic: when served over http(s), read the folder listing
    if (location.protocol.startsWith('http')) {
      try {
        const res = await fetch(SOUND_DIR, { cache: 'no-store' });
        if (res.ok) {
          const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
          doc.querySelectorAll('a[href]').forEach(a => {
            let name = decodeURIComponent((a.getAttribute('href') || '').split('?')[0].split('/').pop());
            if (AUDIO_EXT.test(name)) found.add(name);
          });
        }
      } catch (e) { /* listing not available — manifest still works */ }
    }
    customSounds = [...found].sort((a, b) => a.localeCompare(b));
  }
  function populateTones() {
    const sel = $('#alertTone');
    const builtIn = [['chime', 'Chime'], ['beep', 'Beep'], ['bell', 'Bell']];
    let html = '<optgroup label="Built-in">' + builtIn.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') + '</optgroup>';
    if (customSounds.length) html += '<optgroup label="Your sounds">' + customSounds.map(f => `<option value="custom:${esc(f)}">${esc(prettyName(f))}</option>`).join('') + '</optgroup>';
    // keep a saved choice visible even if its file is currently missing
    if (cfg.tone.startsWith('custom:') && !customSounds.includes(cfg.tone.slice(7))) html += `<option value="${esc(cfg.tone)}">${esc(prettyName(cfg.tone.slice(7)))} (file not found)</option>`;
    sel.innerHTML = html;
    sel.value = cfg.tone;
    $('#soundHelp').textContent = customSounds.length
      ? `${customSounds.length} custom ${customSounds.length === 1 ? 'sound' : 'sounds'} found in the sounds folder.`
      : 'Put .mp3 / .wav / .ogg files in the “sounds” folder (next to index.html), then press Refresh.';
  }

  function playTone(name) {
    if (typeof name === 'string' && name.startsWith('custom:')) { playFile(name.slice(7)); return; }
    const ctx = audio();
    if (!ctx) return;
    const now = ctx.currentTime + 0.02;
    (TONES[name] || TONES.chime).forEach(n => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = n.type || 'sine'; osc.frequency.value = n.f;
      const peak = n.g || 0.25;
      gain.gain.setValueAtTime(0.0001, now + n.t);
      gain.gain.exponentialRampToValueAtTime(peak, now + n.t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + n.t); osc.stop(now + n.t + n.d + 0.05);
    });
  }

  /* ---------- Notification + banner ---------- */
  const notifSupported = () => 'Notification' in window;
  function showBanner(title, body) {
    const stack = $('#alertStack');
    const el = document.createElement('div');
    el.className = 'alert-item';
    el.innerHTML = `<div class="alert-icon" aria-hidden="true">🔔</div><div class="alert-text"><strong>${esc(title)}</strong><div class="small">${esc(body)}</div></div><button class="btn" type="button">Dismiss</button>`;
    el.querySelector('button').addEventListener('click', () => el.remove());
    stack.appendChild(el);
    setTimeout(() => el.remove(), 45000);
  }
  /* Android Chrome does not allow `new Notification()`; it requires a service worker's showNotification().
   * Needs HTTPS (GitHub Pages is fine) or localhost. */
  let swReg = null;
  function registerSW() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register('sw.js').then(reg => { swReg = reg; syncUI(); }).catch(() => { /* ignore */ });
  }
  async function systemNotify(title, body, id) {
    // When the page is visible it plays the tone itself, so the system notification stays silent.
    // When the page is hidden, let the system notification make its own sound/vibration.
    // (Browsers reject `silent: true` combined with `vibrate`, so only one of them is ever set.)
    const quiet = cfg.sound && !document.hidden;
    const full = { body, tag: 'dayflow-' + id, renotify: true, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: location.href } };
    if (quiet) full.silent = true; else full.vibrate = [200, 100, 200];
    const plain = { body, tag: 'dayflow-' + id };
    let reg = swReg;
    if (!reg && 'serviceWorker' in navigator && window.isSecureContext) {
      try { reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(r, 1500))]); } catch (e) { reg = null; }
    }
    for (const opts of [full, plain]) {
      try {
        if (reg && reg.showNotification) { await reg.showNotification(title, opts); return true; }
        const n = new Notification(title, opts);   // desktop browsers without a service worker (e.g. file://)
        n.onclick = () => { window.focus(); n.close(); };
        return true;
      } catch (e) { /* try the simpler options next */ }
    }
    return false;
  }
  function fire(title, body, id) {
    showBanner(title, body);
    // With background push on, the push notification covers the "page hidden" case, so the page skips its own then.
    if (cfg.sound && !(pushActive && document.hidden)) playTone(cfg.tone);
    if (cfg.notify && notifSupported() && Notification.permission === 'granted' && !pushActive) systemNotify(title, body, id);
    if (navigator.vibrate) { try { navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ } }
  }
  function fireActivity(a, lead, lateBy = 0) {
    const mins = lead - lateBy; // minutes until the activity actually starts
    const title = mins > 1 ? `Starting in ${mins} min: ${a.name}` : mins === 1 ? `Starting in 1 min: ${a.name}`
      : mins === 0 || (mins === -1 && lead === 0) ? `Started: ${a.name}` : `Started ${-mins} min ago: ${a.name}`;
    const body = `${range(a)} · ${fmtDur(duration(a))}${a.notes ? ' — ' + a.notes : ''}`;
    fire(a.icon ? `${a.icon} ${title}` : title, body, a.id);
  }

  /* ---------- Scheduler ---------- */
  let fired = new Set();
  try { fired = new Set(JSON.parse(localStorage.getItem(FIRED_KEY) || '[]').filter(k => String(k).startsWith(todayStr() + '|'))); } catch (e) { /* ignore */ }
  function rememberFired() { try { localStorage.setItem(FIRED_KEY, JSON.stringify([...fired].slice(-200))); } catch (e) { /* ignore */ } }
  function dateOffset(days) {
    const d = new Date(); d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

  /* Each activity alerts once per day at (start − lead). A late tick (throttled background tab) still fires within 1 minute. */
  const CATCH_UP_MIN = 10; // after the phone sleeps / the tab was frozen, still report activities that started up to 10 min ago
  function tick(window_ = 1) {
    refreshNext();
    if (!cfg.enabled) return;
    const today = todayStr(), tomorrow = dateOffset(1), nm = nowMin();
    for (const a of routine().activities) {
      const raw = a.start - cfg.lead;
      const t = (raw + 1440) % 1440;
      const lateBy = (nm - t + 1440) % 1440;
      if (lateBy > window_) continue;
      if (!isVisibleOn(a, raw < 0 ? tomorrow : today)) continue;
      const key = `${today}|${a.id}|${a.start}|${cfg.lead}`;
      if (fired.has(key)) continue;
      fired.add(key); rememberFired();
      fireActivity(a, cfg.lead, lateBy);
    }
  }

  function nextAlert() {
    const nm = nowMin();
    let best = null;
    for (const a of routine().activities) {
      for (const day of [0, 1, 2]) {
        const delta = day * 1440 + a.start - cfg.lead - nm; // minutes until the alert for the activity on day offset `day`
        if (delta <= 0 || !isVisibleOn(a, dateOffset(day))) continue;
        if (!best || delta < best.delta) best = { a, delta };
        break;
      }
    }
    return best;
  }
  function refreshNext() {
    const el = $('#alertNext');
    if (!cfg.enabled) { el.textContent = ''; return; }
    const n = nextAlert();
    el.textContent = n
      ? `Next: ${n.a.name} ${cfg.lead ? 'reminder' : 'starts'} in ${fmtDur(n.delta)}`
      : 'No upcoming activities to alert for.';
  }

  /* ---------- Background push (needs the push worker — see push/SETUP.md) ---------- */
  const PUSH = window.DAYFLOW_PUSH || {};
  const pushConfigured = () => !!(PUSH.server && PUSH.vapidPublicKey);
  const pushSupported = () => pushConfigured() && 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext;
  let pushActive = false;        // true only when this device is subscribed AND the worker has our schedule
  let pushNote = '';             // short status for the UI
  let lastSig = '', syncTimer = null;
  const urlB64 = s => { const p = '='.repeat((4 - (s.length % 4)) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } };
  async function post(path, body) {
    const res = await fetch(PUSH.server.replace(/\/+$/, '') + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = null; try { data = await res.json(); } catch (e) { /* ignore */ }
    return { ok: res.ok, status: res.status, data };
  }
  const snapshot = () => ({ enabled: cfg.enabled, lead: cfg.lead, tz: tz(), activities: routine().activities.map(a => ({ id: a.id, name: a.name, start: a.start, end: a.end, icon: a.icon || '', notes: a.notes || '', repeat: a.repeat, date: a.date })) });
  async function getRegistration() {
    return swReg || await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 4000))]);
  }
  async function ensureSubscription(createIfMissing) {
    const reg = await getRegistration();
    if (!reg || !reg.pushManager) return null;
    let sub = await reg.pushManager.getSubscription();
    if (!sub && createIfMissing) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(PUSH.vapidPublicKey) });
    return sub;
  }
  async function syncPush(force) {
    if (!cfg.push || !pushSupported() || Notification.permission !== 'granted') { pushActive = false; return false; }
    const snap = snapshot(), sig = JSON.stringify(snap);
    if (!force && sig === lastSig && pushActive) return true;
    try {
      const sub = await ensureSubscription(true);
      if (!sub) throw new Error('no subscription');
      const r = await post('/sync', { subscription: sub.toJSON(), ...snap });
      if (!r.ok) throw new Error((r.data && r.data.error) || ('server returned ' + r.status));
      lastSig = sig; pushActive = true; pushNote = `Synced ${r.data.activities} activities to the push server.`;
    } catch (e) {
      pushActive = false; pushNote = 'Couldn’t reach the push server (' + (e.message || 'error') + '). Using in-page alerts only.';
    }
    syncUI(); return pushActive;
  }
  function scheduleSyncIfChanged() { if (JSON.stringify(snapshot()) !== lastSig) scheduleSync(); }
  function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncPush(false), 1500); }
  async function enablePush() {
    if (!pushSupported()) { cfg.push = false; saveCfg(); pushNote = 'Background alerts need HTTPS, a supported browser, and push-config.js filled in.'; return syncUI(); }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') { cfg.push = false; saveCfg(); pushNote = 'Notification permission is required for background alerts.'; return syncUI(); }
    cfg.push = true; if (!cfg.enabled) { cfg.enabled = true; } saveCfg();
    await syncPush(true);
    if (!pushActive) { cfg.push = false; saveCfg(); }
    syncUI();
  }
  async function disablePush() {
    cfg.push = false; pushActive = false; saveCfg(); pushNote = '';
    try { const sub = await ensureSubscription(false); if (sub) { const ep = sub.endpoint; await sub.unsubscribe(); post('/unsubscribe', { endpoint: ep }).catch(() => {}); } } catch (e) { /* ignore */ }
    syncUI();
  }
  async function testPush() {
    try {
      const sub = await ensureSubscription(false);
      if (!sub) { toast('Turn on background alerts first.'); return; }
      await syncPush(true);
      const r = await post('/test', { endpoint: sub.endpoint });
      toast(r.ok ? 'Test push sent — it should appear in a few seconds.' : 'Test failed: ' + ((r.data && r.data.error) || r.status));
    } catch (e) { toast('Couldn’t reach the push server.'); }
  }

  /* ---------- Keep screen awake (phones suspend pages when the screen turns off) ---------- */
  let wakeLock = null;
  const wakeSupported = () => 'wakeLock' in navigator;
  async function updateWakeLock() {
    const want = cfg.enabled && cfg.keepAwake && wakeSupported() && document.visibilityState === 'visible';
    try {
      if (want && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { wakeLock = null; }
  }

  /* ---------- UI ---------- */
  function statusText() {
    const bits = [];
    if (cfg.notify) {
      if (!notifSupported()) bits.push('This browser can’t show system notifications; you’ll still get the in-app alert and tone.');
      else if (Notification.permission === 'denied') bits.push('Notifications are blocked in your browser settings; the in-app alert and tone still work.');
      else if (Notification.permission === 'default') bits.push('Notification permission hasn’t been granted yet.');
    }
    if (cfg.notify && notifSupported() && Notification.permission === 'granted' && !swReg && /Android/i.test(navigator.userAgent)) bits.push('Phone notifications need the HTTPS version of the site (e.g. GitHub Pages).');
    bits.push('Alerts follow the selected routine and need DayFlow to stay open. On a phone, install it to your home screen and enable “Keep screen on”.');
    return bits.join(' ');
  }
  function syncUI() {
    $('#alertEnabled').checked = cfg.enabled;
    $('#alertSound').checked = cfg.sound;
    $('#alertNotify').checked = cfg.notify;
    $('#alertAwake').checked = cfg.keepAwake;
    const pc = pushConfigured();
    $('#alertPush').checked = cfg.push && pushActive;
    $('#alertPush').disabled = !pc || !pushSupported();
    $('#pushTest').classList.toggle('hidden', !(cfg.push && pushActive));
    $('#pushHint').textContent = !pc ? 'Not set up yet — deploy the push worker and fill in push-config.js (see push/SETUP.md).'
      : !pushSupported() ? 'Needs the HTTPS site in a browser with push support.'
      : cfg.push && pushActive ? 'On: you’ll be notified at each start time even with DayFlow closed.' + (pushNote ? ' ' + pushNote : '')
      : pushNote;
    $('#alertAwakeRow').classList.toggle('hidden', !wakeSupported());
    if ($('#alertTone').value !== cfg.tone) populateTones();
    $('#alertLead').value = String(cfg.lead);
    $('#alertTone').disabled = !cfg.sound;
    $('#alertStatus').textContent = statusText();
    refreshNext();
  }
  function askPermission() {
    if (cfg.notify && notifSupported() && Notification.permission === 'default') {
      try {
        const p = Notification.requestPermission(() => {});
        if (p && p.then) p.then(syncUI); else syncUI();
      } catch (e) { /* ignore */ }
    }
  }

  async function refreshSounds(announce) {
    await discoverSounds();
    populateTones();
    if (announce) toast(customSounds.length ? `Found ${customSounds.length} custom sound(s)` : 'No custom sounds found in the sounds folder');
  }
  function init() {
    populateTones();
    syncUI();
    refreshSounds(false);
    $('#soundRefresh').addEventListener('click', () => refreshSounds(true));
    $('#alertEnabled').addEventListener('change', e => {
      cfg.enabled = e.target.checked; saveCfg();
      if (cfg.enabled) { audio(); askPermission(); }
      syncUI(); updateWakeLock(); if (cfg.push) scheduleSync();
    });
    $('#alertPush').addEventListener('change', e => { if (e.target.checked) enablePush(); else disablePush(); });
    $('#pushTest').addEventListener('click', testPush);
    $('#alertAwake').addEventListener('change', e => { cfg.keepAwake = e.target.checked; saveCfg(); updateWakeLock(); });
    $('#alertSound').addEventListener('change', e => { cfg.sound = e.target.checked; saveCfg(); if (cfg.sound) audio(); syncUI(); });
    $('#alertNotify').addEventListener('change', e => { cfg.notify = e.target.checked; saveCfg(); askPermission(); syncUI(); });
    $('#alertTone').addEventListener('change', e => { cfg.tone = e.target.value; saveCfg(); playTone(cfg.tone); });
    $('#alertLead').addEventListener('change', e => { cfg.lead = Number(e.target.value); saveCfg(); syncUI(); if (cfg.push) scheduleSync(); });
    $('#alertTest').addEventListener('click', () => {
      audio(); askPermission();
      fire('DayFlow test alert', 'This is how activity alerts will look and sound.', 'test');
    });
    // Browsers only allow sound after a user gesture; unlock audio on the first interaction.
    document.addEventListener('pointerdown', () => { if (cfg.enabled && cfg.sound) audio(); }, { once: true });
    // Keep "Next:" current when the routine or its activities change.
    document.addEventListener('click', () => setTimeout(refreshNext, 0));
    document.addEventListener('change', () => setTimeout(refreshNext, 0));
    registerSW();
    // When the phone wakes / the tab returns to the foreground: catch up on anything missed, re-acquire the wake lock.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { tick(CATCH_UP_MIN); updateWakeLock(); } });
    window.addEventListener('pageshow', () => tick(CATCH_UP_MIN));
    setInterval(() => { tick(); if (cfg.push) scheduleSyncIfChanged(); }, 10000);
    if (cfg.push) setTimeout(() => syncPush(true), 1200);   // re-register after page load (also heals an expired subscription)
    tick(CATCH_UP_MIN);
    updateWakeLock();
  }

  window.DayFlowAlerts = { tick, fireActivity, getConfig: () => ({ ...cfg }), setConfig: c => { Object.assign(cfg, c); saveCfg(); syncUI(); } };
  init();
})();
