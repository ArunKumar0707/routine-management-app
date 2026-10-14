/* DayFlow — 24-Hour Routine Planner
 * Vanilla JS. Times are stored as integer minutes since midnight (0–1439).
 * An activity whose end <= start (or end === 0) runs past/at midnight. */
'use strict';

/* ---------- Constants ---------- */
const STORAGE_KEY = 'dayflow.v1';
const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const CATEGORIES = ['Sleep', 'Work', 'Study', 'Exercise', 'Meals', 'Personal', 'Travel', 'Break', 'Entertainment', 'Other'];
const DEFAULT_COLORS = {
  Sleep: '#6c63d6', Work: '#3b82c4', Study: '#c98a14', Exercise: '#3fa66b', Meals: '#e5754b',
  Personal: '#c25a9a', Travel: '#2f9a97', Break: '#7f8b99', Entertainment: '#d4546a', Other: '#757a82'
};
const ICONS = ['', '😴', '💼', '📚', '🏃', '🍽️', '🧘', '🚗', '☕', '🎮', '🛒', '🧹', '🎵', '💻', '📞', '⭐'];
const REPEATS = ['none', 'daily', 'weekdays', 'weekends'];
const REPEAT_LABEL = { none: 'This date only', daily: 'Daily', weekdays: 'Weekdays', weekends: 'Weekends' };

/* ---------- Small helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const pad = n => String(n).padStart(2, '0');
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEX = /^#[0-9a-f]{6}$/i;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function nowMinutes() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function longDate(str) {
  return new Date(str + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/* ---------- Time math ---------- */
function fmtTime(min) {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? 'AM' : 'PM'}`;
}
function fmtDur(min) {
  min = Math.round(min);
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
function hourLabel(h) { return h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`; }
function shortHour(h) { return `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`; }
const duration = a => (a.end - a.start + 1440) % 1440;
const effEnd = a => (a.end === 0 ? 1440 : a.end);
const range = a => `${fmtTime(a.start)} – ${fmtTime(a.end)}`;
function segments(a) {
  if (a.end === 0) return [[a.start, 1440]];
  if (a.end > a.start) return [[a.start, a.end]];
  return [[a.start, 1440], [0, a.end]].filter(([s, e]) => e > s);
}
function union(segs) {
  const s = segs.slice().sort((a, b) => a[0] - b[0]);
  let total = 0, cs = null, ce = null;
  for (const [a, b] of s) {
    if (cs === null) { cs = a; ce = b; }
    else if (a <= ce) ce = Math.max(ce, b);
    else { total += ce - cs; cs = a; ce = b; }
  }
  if (cs !== null) total += ce - cs;
  return total;
}
function overlapMin(a, b) {
  let t = 0;
  for (const [s1, e1] of segments(a)) for (const [s2, e2] of segments(b)) t += Math.max(0, Math.min(e1, e2) - Math.max(s1, s2));
  return t;
}
function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? '#1c1d1f' : '#ffffff';
}

/* ---------- State & persistence ---------- */
function sampleActivities() {
  const mk = (name, category, sh, sm, eh, em, icon, notes = '') => ({
    id: uid(), name, category, start: sh * 60 + sm, end: (eh * 60 + em) % 1440,
    color: DEFAULT_COLORS[category], icon, notes, repeat: 'daily'
  });
  return [
    mk('Sleep', 'Sleep', 23, 0, 6, 30, '😴', 'Aim for a consistent bedtime.'),
    mk('Morning routine', 'Personal', 6, 30, 7, 15, '🧘'),
    mk('Workout', 'Exercise', 7, 15, 8, 0, '🏃'),
    mk('Breakfast', 'Meals', 8, 0, 8, 30, '🍽️'),
    mk('Commute', 'Travel', 8, 30, 9, 0, '🚗'),
    mk('Deep work', 'Work', 9, 0, 12, 0, '💼', 'Phone on silent, one focus task.'),
    mk('Lunch', 'Meals', 12, 0, 13, 0, '🍽️'),
    mk('Meetings & projects', 'Work', 13, 0, 17, 0, '💻'),
    mk('Commute home', 'Travel', 17, 0, 17, 30, '🚗'),
    mk('Study session', 'Study', 18, 0, 19, 30, '📚'),
    mk('Dinner', 'Meals', 19, 30, 20, 15, '🍽️'),
    mk('Leisure', 'Entertainment', 20, 30, 22, 0, '🎮'),
    mk('Wind down', 'Personal', 22, 0, 23, 0, '🎵')
  ];
}
function newRoutine(name, withSample) {
  return { id: uid(), name, activities: withSample ? sampleActivities() : [] };
}
function defaultState() {
  const r = newRoutine('Workday Routine', true);
  return {
    routines: [r], activeId: r.id,
    settings: {
      theme: matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      view: 'vertical', categoryColors: { ...DEFAULT_COLORS }, exportOrientation: 'portrait', exportTheme: 'light'
    }
  };
}
function sanitizeActivity(a, seen) {
  if (!a || typeof a !== 'object') return null;
  const name = String(a.name || '').trim().slice(0, 60);
  let s = Math.round(Number(a.start)), e = Math.round(Number(a.end));
  if (!name || !Number.isFinite(s) || !Number.isFinite(e)) return null;
  if (s < 0 || s > 1439 || e < 0 || e > 1440) return null;
  if (e === 1440) e = 0;
  if (s === e) return null;
  const category = CATEGORIES.includes(a.category) ? a.category : 'Other';
  let id = typeof a.id === 'string' && a.id ? a.id : uid();
  if (seen.has(id)) id = uid();
  seen.add(id);
  const out = {
    id, name, category, start: s, end: e,
    color: HEX.test(a.color) ? a.color : DEFAULT_COLORS[category],
    icon: ICONS.includes(a.icon) ? a.icon : '',
    notes: String(a.notes || '').slice(0, 300),
    repeat: REPEATS.includes(a.repeat) ? a.repeat : 'daily'
  };
  if (typeof a.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.date)) out.date = a.date;
  return out;
}
function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.routines)) return null;
  const seen = new Set();
  const routines = raw.routines.map(r => {
    if (!r || typeof r !== 'object') return null;
    const name = String(r.name || '').trim().slice(0, 60) || 'Untitled routine';
    let id = typeof r.id === 'string' && r.id ? r.id : uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    const acts = Array.isArray(r.activities) ? r.activities.map(a => sanitizeActivity(a, seen)).filter(Boolean) : [];
    return { id, name, activities: acts };
  }).filter(Boolean);
  if (!routines.length) return null;
  const st = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const base = defaultState().settings;
  const cc = { ...DEFAULT_COLORS };
  if (st.categoryColors && typeof st.categoryColors === 'object') {
    CATEGORIES.forEach(c => { if (HEX.test(st.categoryColors[c])) cc[c] = st.categoryColors[c]; });
  }
  return {
    routines,
    activeId: routines.some(r => r.id === raw.activeId) ? raw.activeId : routines[0].id,
    settings: {
      theme: st.theme === 'dark' || st.theme === 'light' ? st.theme : base.theme,
      view: st.view === 'circular' ? 'circular' : 'vertical',
      categoryColors: cc,
      exportOrientation: st.exportOrientation === 'landscape' ? 'landscape' : 'portrait',
      exportTheme: st.exportTheme === 'dark' ? 'dark' : 'light'
    }
  };
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = sanitizeState(JSON.parse(raw));
      if (s) return s;
    }
  } catch (e) { /* corrupted or blocked storage — fall through to default */ }
  return defaultState();
}

const state = loadState();
const ui = { date: todayStr(), selectedId: null, editingId: null, expOrient: state.settings.exportOrientation, expTheme: state.settings.exportTheme };

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ routines: state.routines, activeId: state.activeId, settings: state.settings }));
  } catch (e) { toast('Could not save — browser storage is unavailable or full.'); }
}
const routine = () => state.routines.find(r => r.id === state.activeId) || state.routines[0];
const catColor = c => state.settings.categoryColors[c] || DEFAULT_COLORS[c] || DEFAULT_COLORS.Other;

function isVisibleOn(a, dateStr) {
  const dow = new Date(dateStr + 'T00:00:00').getDay();
  switch (a.repeat) {
    case 'daily': return true;
    case 'weekdays': return dow >= 1 && dow <= 5;
    case 'weekends': return dow === 0 || dow === 6;
    default: return !a.date || a.date === dateStr;
  }
}
const visible = () => routine().activities.filter(a => isVisibleOn(a, ui.date));

/* ---------- Analysis ---------- */
function findConflicts(acts) {
  const ids = new Set(), pairs = [];
  for (let i = 0; i < acts.length; i++) for (let j = i + 1; j < acts.length; j++) {
    const m = overlapMin(acts[i], acts[j]);
    if (m > 0) { ids.add(acts[i].id); ids.add(acts[j].id); pairs.push({ a: acts[i], b: acts[j], minutes: m }); }
  }
  return { ids, pairs };
}
function computeModel(acts) {
  const occupied = union(acts.flatMap(segments));
  const sum = acts.reduce((t, a) => t + duration(a), 0);
  const cat = {};
  CATEGORIES.forEach(c => { cat[c] = union(acts.filter(a => a.category === c).flatMap(segments)); });
  return { occupied, free: 1440 - occupied, sum, cat, count: acts.length };
}
/* Lay out segments in side-by-side lanes when they overlap. */
function layoutSegs(acts) {
  const segs = [];
  acts.forEach(a => segments(a).forEach(([s, e]) => segs.push({ a, s, e, col: 0, cols: 1 })));
  segs.sort((x, y) => x.s - y.s || y.e - x.e);
  let cluster = [], clusterEnd = -1, colEnds = [];
  const flush = () => { cluster.forEach(g => { g.cols = Math.max(1, colEnds.length); }); cluster = []; colEnds = []; clusterEnd = -1; };
  for (const g of segs) {
    if (cluster.length && g.s >= clusterEnd) flush();
    let c = colEnds.findIndex(end => end <= g.s);
    if (c === -1) { c = colEnds.length; colEnds.push(g.e); } else colEnds[c] = g.e;
    g.col = c; cluster.push(g); clusterEnd = Math.max(clusterEnd, g.e);
  }
  flush();
  return segs;
}

/* ---------- Toast / tooltip ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}
function showTip(html, x, y) {
  const t = $('#tooltip');
  t.innerHTML = html; t.classList.remove('hidden');
  const w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = clamp(x + 14, 8, innerWidth - w - 8) + 'px';
  t.style.top = clamp(y + 14, 8, innerHeight - h - 8) + 'px';
}
const hideTip = () => $('#tooltip').classList.add('hidden');
function tipFor(a, conflicts) {
  return `<b>${a.icon ? esc(a.icon) + ' ' : ''}${esc(a.name)}</b>${range(a)} · ${fmtDur(duration(a))}<br>${esc(a.category)}${conflicts.ids.has(a.id) ? '<br>⚠ Overlaps another activity' : ''}`;
}

/* ---------- Dialog helpers ---------- */
function askDialog({ title, message = '', input = null, okText = 'OK', danger = false }) {
  return new Promise(resolve => {
    const dlg = $('#dialogModal'), inp = $('#dialogInput'), ok = $('#dialogOk');
    $('#dialogTitle').textContent = title;
    $('#dialogMsg').textContent = message;
    $('#dialogMsg').classList.toggle('hidden', !message);
    inp.classList.toggle('hidden', input === null);
    if (input !== null) inp.value = input;
    ok.textContent = okText;
    ok.classList.toggle('danger', danger);
    ok.classList.toggle('primary', !danger);
    let result = null;
    const form = $('#dialogForm'), cancel = $('#dialogCancel');
    const onSubmit = e => {
      e.preventDefault();
      result = input !== null ? (inp.value.trim() || null) : true;
      dlg.close();
    };
    const onCancel = () => { result = null; dlg.close(); };
    const onClose = () => {
      form.removeEventListener('submit', onSubmit);
      cancel.removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onClose);
      resolve(result);
    };
    form.addEventListener('submit', onSubmit);
    cancel.addEventListener('click', onCancel);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    if (input !== null) { inp.focus(); inp.select(); }
  });
}
const confirmDialog = (title, message, okText = 'Delete') => askDialog({ title, message, okText, danger: true });

/* ---------- Time picker (consistent 12-hour input) ---------- */
function makeTimePicker(root) {
  const hours = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  root.innerHTML = `<select class="select" aria-label="Hour">${hours}</select><select class="select" aria-label="Minute"></select><select class="select" aria-label="AM or PM"><option>AM</option><option>PM</option></select>`;
  const [h, m, p] = root.querySelectorAll('select');
  const fillMinutes = extra => {
    const set = new Set([...Array(12).keys()].map(i => i * 5));
    if (extra !== undefined) set.add(extra);
    m.innerHTML = [...set].sort((a, b) => a - b).map(v => `<option value="${v}">${pad(v)}</option>`).join('');
  };
  fillMinutes();
  return {
    get() { return ((+h.value % 12) + (p.value === 'PM' ? 12 : 0)) * 60 + +m.value; },
    set(min) {
      min = ((min % 1440) + 1440) % 1440;
      const hr = Math.floor(min / 60), mi = min % 60;
      fillMinutes(mi);
      h.value = String(hr % 12 || 12); m.value = String(mi); p.value = hr < 12 ? 'AM' : 'PM';
    },
    onChange(fn) { [h, m, p].forEach(e => e.addEventListener('change', fn)); }
  };
}
let startPicker, endPicker;

/* ---------- Rendering ---------- */
function render() {
  const r = routine();
  const sel = $('#routineSelect');
  sel.innerHTML = state.routines.map(x => `<option value="${esc(x.id)}"${x.id === r.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  $('#routineName').textContent = r.name;
  $('#dateInput').value = ui.date;
  $('#viewVertical').classList.toggle('active', state.settings.view === 'vertical');
  $('#viewCircular').classList.toggle('active', state.settings.view === 'circular');
  const acts = visible();
  if (ui.selectedId && !acts.some(a => a.id === ui.selectedId)) ui.selectedId = null;
  const conflicts = findConflicts(acts);
  const model = computeModel(acts);
  const isToday = ui.date === todayStr();
  $('#timelineSubtitle').textContent = `${longDate(ui.date)}${isToday ? ' · Today' : ''} · ${acts.length} ${acts.length === 1 ? 'activity' : 'activities'}`;
  renderBanner(conflicts);
  renderTimeline(acts, conflicts);
  renderDetails(acts, conflicts);
  renderStats(model);
  renderList(acts, conflicts);
}

function renderBanner(conflicts) {
  const b = $('#conflictBanner');
  if (!conflicts.pairs.length) { b.classList.add('hidden'); return; }
  const shown = conflicts.pairs.slice(0, 4);
  b.innerHTML = `<strong>⚠ ${conflicts.pairs.length} scheduling ${conflicts.pairs.length === 1 ? 'conflict' : 'conflicts'}</strong>` +
    shown.map(p => `<div class="conflict-row">${esc(p.a.name)} overlaps ${esc(p.b.name)} by ${fmtDur(p.minutes)}
      <div class="conflict-actions"><button class="btn" data-edit="${esc(p.a.id)}">Edit ${esc(p.a.name)}</button><button class="btn" data-edit="${esc(p.b.id)}">Edit ${esc(p.b.name)}</button></div></div>`).join('') +
    (conflicts.pairs.length > shown.length ? `<div class="small">…and ${conflicts.pairs.length - shown.length} more (highlighted in red on the timeline).</div>` : '');
  b.classList.remove('hidden');
}

const hourH = () => (innerWidth < 640 ? 52 : 60);

function renderTimeline(acts = visible(), conflicts = findConflicts(acts)) {
  const host = $('#timelineHost');
  const isToday = ui.date === todayStr();
  host.innerHTML = state.settings.view === 'vertical' ? verticalHTML(acts, conflicts, isToday) : circularHTML(acts, conflicts, isToday);
  if (ui.selectedId) host.querySelectorAll(`[data-id="${CSS.escape(ui.selectedId)}"]`).forEach(el => el.classList.add('selected'));
}

function verticalHTML(acts, conflicts, isToday) {
  const H = hourH(), ppm = H / 60;
  let html = `<div class="vt" style="height:${24 * H}px"><div class="vt-hours">`;
  for (let i = 0; i <= 24; i++) html += `<span class="vt-hour-label" style="top:${i * H}px">${hourLabel(i % 24)}</span>`;
  html += '</div><div class="vt-track">';
  for (let i = 0; i <= 24; i++) html += `<div class="vt-line${i % 6 === 0 ? ' major' : ''}" style="top:${i * H}px"></div>`;
  for (const g of layoutSegs(acts)) {
    const h = (g.e - g.s) * ppm;
    const cls = ['block'];
    if (h < 40) cls.push('tiny');
    if (conflicts.ids.has(g.a.id)) cls.push('conflict');
    const text = h >= 18 ? `<span class="b-name">${g.a.icon ? esc(g.a.icon) + ' ' : ''}${esc(g.a.name)}</span><span class="b-time">${range(g.a)}</span>` : '';
    html += `<button class="${cls.join(' ')}" data-id="${esc(g.a.id)}" aria-label="${esc(g.a.name)}, ${range(g.a)}" style="top:${g.s * ppm}px;height:${h}px;left:calc(${(g.col / g.cols) * 100}% + 2px);width:calc(${100 / g.cols}% - 4px);background:${g.a.color};color:${textOn(g.a.color)}">${text}</button>`;
  }
  if (isToday) html += `<div class="now-line" style="top:${nowMinutes() * ppm}px"><span>${fmtTime(nowMinutes())}</span></div>`;
  return html + '</div></div>';
}

const polar = (cx, cy, r, deg) => { const t = deg * Math.PI / 180; return [cx + r * Math.sin(t), cy - r * Math.cos(t)]; };
function arcPath(cx, cy, r0, r1, a0, a1) {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x1, y1] = polar(cx, cy, r1, a0), [x2, y2] = polar(cx, cy, r1, a1);
  const [x3, y3] = polar(cx, cy, r0, a1), [x4, y4] = polar(cx, cy, r0, a0);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r1} ${r1} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}L${x3.toFixed(2)} ${y3.toFixed(2)}A${r0} ${r0} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}Z`;
}
function circularHTML(acts, conflicts, isToday) {
  const cx = 320, cy = 320, R0 = 145, R1 = 240, thick = R1 - R0;
  const model = computeModel(acts);
  let svg = `<div class="circ-wrap"><svg viewBox="0 0 640 640" role="img" aria-label="24-hour clock of the routine">`;
  svg += `<path d="${arcPath(cx, cy, R0, R1, 0, 359.99)}" fill="var(--surface-2)" stroke="var(--border)"/>`;
  for (let h = 0; h < 24; h++) {
    const major = h % 6 === 0, a = h * 15;
    const [x1, y1] = polar(cx, cy, R1 + 4, a), [x2, y2] = polar(cx, cy, R1 + (major ? 16 : 10), a);
    const [tx, ty] = polar(cx, cy, R1 + 32, a);
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--muted)" stroke-width="${major ? 2 : 1}"/>`;
    svg += `<text class="hour-text" x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central"${major ? ' style="font-weight:700;fill:var(--text)"' : ''}>${shortHour(h)}</text>`;
  }
  for (const g of layoutSegs(acts)) {
    const r0 = R0 + (g.col / g.cols) * thick, r1 = R0 + ((g.col + 1) / g.cols) * thick;
    const a0 = g.s * 0.25, a1 = g.e * 0.25;
    const bad = conflicts.ids.has(g.a.id);
    svg += `<g data-id="${esc(g.a.id)}" class="arc" tabindex="0" role="button" aria-label="${esc(g.a.name)}, ${range(g.a)}"><path d="${arcPath(cx, cy, r0, r1, a0, a1)}" fill="${g.a.color}" stroke="${bad ? '#ff3b30' : 'var(--surface)'}" stroke-width="${bad ? 3 : 2}"/>`;
    const span = a1 - a0;
    if (span >= 26 && g.cols === 1) {
      const [tx, ty] = polar(cx, cy, (r0 + r1) / 2, (a0 + a1) / 2);
      const maxChars = Math.floor((2 * ((r0 + r1) / 2) * Math.sin(span * Math.PI / 360) * 0.85) / 7.2);
      let label = g.a.name; if (label.length > maxChars) label = label.slice(0, Math.max(1, maxChars - 1)) + '…';
      svg += `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="600" style="fill:${textOn(g.a.color)};pointer-events:none">${esc(label)}</text>`;
    }
    svg += '</g>';
  }
  if (isToday) {
    const [x1, y1] = polar(cx, cy, R0 - 6, nowMinutes() * 0.25), [x2, y2] = polar(cx, cy, R1 + 6, nowMinutes() * 0.25);
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--danger)" stroke-width="3" stroke-linecap="round"/>`;
  }
  const name = routine().name.length > 20 ? routine().name.slice(0, 19) + '…' : routine().name;
  svg += `<text x="${cx}" y="${cy - 22}" text-anchor="middle" font-size="22" font-weight="700">${esc(name)}</text>`;
  svg += `<text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="15" style="fill:var(--muted)">${fmtDur(model.occupied)} planned</text>`;
  svg += `<text x="${cx}" y="${cy + 30}" text-anchor="middle" font-size="15" style="fill:var(--muted)">${fmtDur(model.free)} free</text>`;
  return svg + '</svg></div>';
}

function renderDetails(acts, conflicts) {
  const p = $('#detailsPanel');
  const a = acts.find(x => x.id === ui.selectedId);
  if (!a) { p.innerHTML = '<p class="muted">Select an activity to see its details.</p>'; return; }
  const overl = conflicts.pairs.filter(c => c.a.id === a.id || c.b.id === a.id).map(c => (c.a.id === a.id ? c.b : c.a).name);
  p.innerHTML = `<div class="d-head"><span class="swatch" style="background:${a.color}"></span><span class="d-title">${a.icon ? esc(a.icon) + ' ' : ''}${esc(a.name)}</span></div>
    <div class="d-meta">${range(a)} · ${fmtDur(duration(a))} · ${esc(a.category)} · ${REPEAT_LABEL[a.repeat]}</div>
    ${a.notes ? `<div class="d-meta">${esc(a.notes)}</div>` : ''}
    ${overl.length ? `<div class="a-conflict">⚠ Overlaps: ${overl.map(esc).join(', ')}</div>` : ''}
    <div class="d-actions"><button class="btn" data-act="edit">Edit</button><button class="btn" data-act="earlier">−15 min</button><button class="btn" data-act="later">+15 min</button><button class="btn danger" data-act="delete">Delete</button></div>`;
}

function renderStats(m) {
  const tiles = [
    ['Scheduled', fmtDur(m.occupied)], ['Free time', fmtDur(m.free)],
    ['Sleep', fmtDur(m.cat.Sleep)], ['Work', fmtDur(m.cat.Work)],
    ['Study', fmtDur(m.cat.Study)], ['Exercise', fmtDur(m.cat.Exercise)],
    ['Activities', String(m.count)], ['Sum of durations', fmtDur(m.sum)]
  ];
  $('#statsGrid').innerHTML = tiles.map(([l, v]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  $('#statsNote').textContent = m.sum !== m.occupied
    ? `Some activities overlap: their durations add up to ${fmtDur(m.sum)}, but only ${fmtDur(m.occupied)} of the day is actually occupied.`
    : 'Scheduled time counts each minute once.';
  const rows = CATEGORIES.filter(c => m.cat[c] > 0).sort((a, b) => m.cat[b] - m.cat[a]).map(c => ({ name: c, v: m.cat[c], color: catColor(c) }));
  rows.push({ name: 'Free', v: m.free, color: 'var(--border)' });
  $('#breakdown').innerHTML = rows.map(r => `<div class="bd-row"><div class="bd-top"><span>${esc(r.name)}</span><span>${fmtDur(r.v)} · ${(r.v / 14.4).toFixed(1)}%</span></div><div class="bar"><i style="width:${(r.v / 14.4).toFixed(2)}%;background:${r.color}"></i></div></div>`).join('');
}

function renderList(acts, conflicts) {
  const box = $('#activityRows');
  if (!acts.length) { box.innerHTML = '<p class="empty">No activities on this date yet. Use “Create Activity” to add one.</p>'; return; }
  box.innerHTML = acts.slice().sort((a, b) => a.start - b.start).map(a => `<div class="a-row" data-row="${esc(a.id)}">
    <span class="swatch" style="background:${a.color}"></span>
    <div><div class="a-name">${a.icon ? esc(a.icon) + ' ' : ''}${esc(a.name)}</div>
    <div class="a-sub">${range(a)} · ${fmtDur(duration(a))} · ${esc(a.category)} · ${REPEAT_LABEL[a.repeat]}${conflicts.ids.has(a.id) ? ' <span class="a-conflict">⚠ conflict</span>' : ''}</div></div>
    <div class="a-actions"><button data-act="earlier" title="Move 15 minutes earlier">−15m</button><button data-act="later" title="Move 15 minutes later">+15m</button><button data-act="edit">Edit</button><button data-act="delete">Delete</button></div></div>`).join('');
}

/* ---------- Activity actions ---------- */
function shiftActivity(id, delta) {
  const a = routine().activities.find(x => x.id === id);
  if (!a) return;
  a.start = (a.start + delta + 1440) % 1440;
  a.end = (a.end + delta + 1440) % 1440;
  save(); render();
}
async function deleteActivity(id) {
  const a = routine().activities.find(x => x.id === id);
  if (!a) return;
  if (!(await confirmDialog('Delete activity?', `“${a.name}” (${range(a)}) will be removed from this routine.`))) return;
  routine().activities = routine().activities.filter(x => x.id !== id);
  if (ui.selectedId === id) ui.selectedId = null;
  save(); render();
  if ($('#activityModal').open) $('#activityModal').close();
}

/* ---------- Activity modal ---------- */
let colorTouched = false, pendingDraft = null;
function fillSelects() {
  $('#fCategory').innerHTML = CATEGORIES.map(c => `<option>${c}</option>`).join('');
  $('#fIcon').innerHTML = ICONS.map(i => `<option value="${i}">${i || 'No icon'}</option>`).join('');
}
function openActivityModal(id) {
  ui.editingId = id || null;
  const a = id ? routine().activities.find(x => x.id === id) : null;
  $('#activityModalTitle').textContent = a ? 'Edit Activity' : 'Create Activity';
  $('#fName').value = a ? a.name : '';
  $('#fCategory').value = a ? a.category : 'Work';
  $('#fColor').value = a ? a.color : catColor('Work');
  colorTouched = !!a;
  $('#fDefaultColor').checked = false;
  startPicker.set(a ? a.start : 9 * 60);
  endPicker.set(a ? a.end : 10 * 60);
  $('#fIcon').value = a ? a.icon : '';
  $('#fRepeat').value = a ? a.repeat : 'none';
  $('#fNotes').value = a ? a.notes : '';
  $('#fDelete').classList.toggle('hidden', !a);
  $('#errName').textContent = ''; $('#errTime').textContent = '';
  $('#conflictBox').classList.add('hidden');
  updateDuration();
  $('#activityModal').showModal();
  $('#fName').focus();
}
function readDraft() {
  return {
    name: $('#fName').value.trim(), category: $('#fCategory').value, color: $('#fColor').value,
    start: startPicker.get(), end: endPicker.get(), icon: $('#fIcon').value,
    notes: $('#fNotes').value.trim(), repeat: $('#fRepeat').value
  };
}
function updateDuration() {
  const s = startPicker.get(), e = endPicker.get();
  const d = (e - s + 1440) % 1440;
  $('#fDuration').textContent = d === 0 ? 'Duration: —' : `Duration: ${fmtDur(d)}${e !== 0 && e < s ? ' (crosses midnight)' : e === 0 ? ' (ends at midnight)' : ''}`;
}
function validateDraft(d) {
  let ok = true;
  $('#errName').textContent = ''; $('#errTime').textContent = '';
  if (!d.name) { $('#errName').textContent = 'Please enter an activity name.'; ok = false; }
  if (!Number.isFinite(d.start) || !Number.isFinite(d.end)) { $('#errTime').textContent = 'Please choose valid start and end times.'; ok = false; }
  else if (d.start === d.end) { $('#errTime').textContent = 'Start and end times can’t be the same.'; ok = false; }
  return ok;
}
function planTrims(draft, conflicting) {
  const plans = [];
  const ns = draft.start, ne = draft.end === 0 ? 1440 : draft.end;
  const draftWraps = draft.end !== 0 && draft.end < draft.start;
  for (const o of conflicting) {
    const oWraps = o.end !== 0 && o.end < o.start;
    if (draftWraps || oWraps) return { error: `Automatic trimming doesn’t work with activities that cross midnight. Adjust “${o.name}” manually.` };
    const os = o.start, oe = effEnd(o);
    if (ns <= os && ne >= oe) return { error: `“${o.name}” is completely covered by this activity. Delete or move it instead.` };
    if (os < ns && oe > ne) return { error: `This activity sits inside “${o.name}”. Trimming would split it, so adjust times manually.` };
    plans.push(os < ns ? { o, end: ns % 1440 } : { o, start: ne });
  }
  return { plans };
}
function onSaveActivity(e) {
  e.preventDefault();
  const d = readDraft();
  if (!validateDraft(d)) return;
  const hypo = { ...d, id: ui.editingId || '__new__' };
  const conflicting = visible().filter(a => a.id !== ui.editingId && overlapMin(hypo, a) > 0);
  if (conflicting.length) {
    pendingDraft = { d, conflicting };
    $('#conflictBox').innerHTML = `<strong>⚠ This overlaps ${conflicting.length} existing ${conflicting.length === 1 ? 'activity' : 'activities'}:</strong>
      <ul class="conflict-list">${conflicting.map(o => `<li>${esc(o.name)} (${range(o)}) — ${fmtDur(overlapMin(hypo, o))} overlap</li>`).join('')}</ul>
      <div class="conflict-actions"><button type="button" class="btn" data-conflict="keep">Save anyway</button><button type="button" class="btn" data-conflict="trim">Trim overlapping activities</button><button type="button" class="btn" data-conflict="back">Change times</button></div>
      <div class="small" id="conflictMsg"></div>`;
    $('#conflictBox').classList.remove('hidden');
    return;
  }
  commitActivity(d, []);
}
function commitActivity(d, plans) {
  const r = routine();
  if ($('#fDefaultColor').checked) state.settings.categoryColors[d.category] = d.color;
  if (ui.editingId) {
    const i = r.activities.findIndex(a => a.id === ui.editingId);
    if (i >= 0) r.activities[i] = { ...r.activities[i], ...d };
    ui.selectedId = ui.editingId;
  } else {
    const a = { id: uid(), ...d, date: ui.date };
    r.activities.push(a);
    ui.selectedId = a.id;
  }
  plans.forEach(p => { if (p.start !== undefined) p.o.start = p.start; if (p.end !== undefined) p.o.end = p.end; });
  save(); render();
  $('#activityModal').close();
  toast(ui.editingId ? 'Activity updated' : 'Activity added');
}
function onConflictChoice(choice) {
  if (!pendingDraft) return;
  if (choice === 'back') { $('#conflictBox').classList.add('hidden'); return; }
  if (choice === 'keep') { commitActivity(pendingDraft.d, []); return; }
  const res = planTrims(pendingDraft.d, pendingDraft.conflicting);
  if (res.error) { $('#conflictMsg').textContent = res.error; return; }
  commitActivity(pendingDraft.d, res.plans);
}

/* ---------- Routines ---------- */
async function createRoutine() {
  const dlg = $('#newRoutineModal');
  $('#nrName').value = ''; $('#nrTemplate').value = 'blank';
  dlg.showModal(); $('#nrName').focus();
}
function onNewRoutineSubmit(e) {
  e.preventDefault();
  const name = $('#nrName').value.trim() || 'Custom Routine';
  const r = newRoutine(name, $('#nrTemplate').value === 'sample');
  state.routines.push(r); state.activeId = r.id; ui.selectedId = null;
  save(); render(); $('#newRoutineModal').close();
}
async function renameRoutine() {
  const name = await askDialog({ title: 'Rename routine', input: routine().name, okText: 'Rename' });
  if (!name) return;
  routine().name = name.slice(0, 60); save(); render();
}
function duplicateRoutine() {
  const src = routine();
  const copy = { id: uid(), name: `${src.name} (copy)`.slice(0, 60), activities: src.activities.map(a => ({ ...a, id: uid() })) };
  state.routines.push(copy); state.activeId = copy.id; ui.selectedId = null;
  save(); render(); toast('Routine duplicated');
}
async function deleteRoutine() {
  const r = routine();
  if (!(await confirmDialog('Delete routine?', `“${r.name}” and its ${r.activities.length} activities will be permanently removed.`))) return;
  state.routines = state.routines.filter(x => x.id !== r.id);
  if (!state.routines.length) state.routines.push(newRoutine('My Routine', false));
  state.activeId = state.routines[0].id; ui.selectedId = null;
  save(); render();
}
function loadSample() {
  const r = newRoutine('Sample Routine', true);
  state.routines.push(r); state.activeId = r.id; ui.selectedId = null;
  save(); render(); toast('Sample routine added');
}
async function resetAll() {
  if (!(await confirmDialog('Reset everything?', 'All routines will be replaced with the default sample routine. This can’t be undone — export a JSON backup first if unsure.', 'Reset'))) return;
  const keep = { theme: state.settings.theme };
  const d = defaultState();
  state.routines = d.routines; state.activeId = d.activeId; state.settings = { ...d.settings, ...keep };
  ui.selectedId = null; save(); render(); toast('Reset to the default routine');
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function backupJSON() {
  const payload = { app: 'DayFlow', version: 1, exportedAt: new Date().toISOString(), routines: state.routines, activeId: state.activeId, settings: { categoryColors: state.settings.categoryColors } };
  download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `DayFlow-backup-${todayStr()}.json`);
}
async function importJSON(file) {
  try {
    const raw = JSON.parse(await file.text());
    const parsed = sanitizeState(raw);
    if (!parsed) throw new Error('No valid routines found');
    if (!(await confirmDialog('Replace all routines?', `Import ${parsed.routines.length} routine(s) from “${file.name}”? Your current routines will be replaced.`, 'Import'))) return;
    state.routines = parsed.routines; state.activeId = parsed.activeId;
    state.settings.categoryColors = parsed.settings.categoryColors;
    ui.selectedId = null; save(); render(); toast('Backup imported');
  } catch (err) {
    toast('Import failed — that file isn’t a valid DayFlow backup.');
  }
}

/* ---------- Image export (Canvas) ---------- */
function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function setFont(ctx, px, weight = 400) {
  // Snap to standard weights; odd values (e.g. 750) are mis-parsed by some canvas engines.
  const w = weight >= 700 ? 700 : weight >= 600 ? 600 : weight >= 500 ? 500 : 400;
  ctx.font = `${w} ${Math.round(px)}px ${FONT}`;
}
function fit(ctx, text, maxW) {
  if (maxW <= 0) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); ctx.measureText(text.slice(0, mid) + '…').width <= maxW ? lo = mid : hi = mid - 1; }
  return lo > 0 ? text.slice(0, lo) + '…' : '';
}
function wrapChips(items, ctx, x, y, maxW, fs, gap, draw) {
  setFont(ctx, fs, 500);
  let cx = x, cy = y;
  const sw = fs * 0.95;
  for (const it of items) {
    const w = sw + 18 + ctx.measureText(it.label).width + gap;
    if (cx + w - gap > x + maxW) { cx = x; cy += fs * 1.9; }
    draw(it, cx, cy, sw);
    cx += w;
  }
  return cy + fs * 1.9;
}

function drawExport(canvas, orient, themeName) {
  const dark = themeName === 'dark';
  const P = dark
    ? { bg: '#121316', text: '#ecedef', muted: '#9a9ea8', track: '#1d2025', line: '#33373f', card: '#1a1c20' }
    : { bg: '#f6f6f4', text: '#1c1d1f', muted: '#6b6e75', track: '#ebebe6', line: '#d9d9d1', card: '#ffffff' };
  const portrait = orient === 'portrait';
  const W = portrait ? 2160 : 3840, H = portrait ? 3840 : 2160;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  const r = routine();
  const acts = visible();
  const conflicts = findConflicts(acts);
  const model = computeModel(acts);
  const M = portrait ? 130 : 120;
  const sorted = acts.slice().sort((a, b) => a.start - b.start);

  // Header
  ctx.fillStyle = P.text; setFont(ctx, portrait ? 124 : 104, 750);
  ctx.fillText(fit(ctx, r.name, W - 2 * M), M, portrait ? 240 : 210);
  ctx.fillStyle = P.muted; setFont(ctx, portrait ? 54 : 48, 450);
  ctx.fillText(`${longDate(ui.date)} · 24-hour routine`, M, portrait ? 320 : 285);

  // Legend entries (unique categories used)
  const legend = [];
  const seenCat = new Set();
  sorted.forEach(a => { if (!seenCat.has(a.category)) { seenCat.add(a.category); legend.push({ label: a.category, color: a.color }); } });

  const tiles = [['Scheduled', fmtDur(model.occupied)], ['Free', fmtDur(model.free)], ['Activities', String(model.count)]];
  if (portrait) tiles.push(['Sleep', fmtDur(model.cat.Sleep)]);

  const drawTiles = (x, y, w, h, gap, valFs, labFs) => {
    const tw = (w - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach(([l, v], i) => {
      const tx = x + i * (tw + gap);
      rr(ctx, tx, y, tw, h, 28); ctx.fillStyle = P.card; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = P.line; ctx.stroke();
      ctx.fillStyle = P.muted; setFont(ctx, labFs, 500); ctx.fillText(l, tx + 36, y + h * 0.36);
      ctx.fillStyle = P.text; setFont(ctx, valFs, 750); ctx.fillText(fit(ctx, v, tw - 72), tx + 36, y + h * 0.80);
    });
  };
  const drawLegend = (x, y, w, fs) => wrapChips(legend, ctx, x, y, w, fs, 56, (it, cx, cy, sw) => {
    rr(ctx, cx, cy - sw * 0.85, sw, sw, sw * 0.28); ctx.fillStyle = it.color; ctx.fill();
    ctx.fillStyle = P.text; setFont(ctx, fs, 500); ctx.fillText(it.label, cx + sw + 18, cy);
  });

  if (portrait) {
    // ----- Vertical 24-hour timeline -----
    const T = 440, B = 2980, hH = (B - T) / 24, ppm = hH / 60;
    const trackX = M + 250, trackW = W - M - trackX;
    rr(ctx, trackX, T, trackW, B - T, 28); ctx.fillStyle = P.track; ctx.fill();
    for (let i = 0; i <= 24; i++) {
      const y = T + i * hH;
      ctx.strokeStyle = P.line; ctx.lineWidth = i % 6 === 0 ? 4 : 2;
      ctx.beginPath(); ctx.moveTo(trackX - 16, y); ctx.lineTo(trackX + trackW, y); ctx.stroke();
      ctx.fillStyle = i % 6 === 0 ? P.text : P.muted; setFont(ctx, 38, i % 6 === 0 ? 700 : 450);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(hourLabel(i % 24), trackX - 36, y); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    const tiny = [];
    for (const g of layoutSegs(acts)) {
      const bw = trackW / g.cols, x = trackX + g.col * bw + 8, w = bw - 16;
      const y = T + g.s * ppm + 2, h = (g.e - g.s) * ppm - 4;
      rr(ctx, x, y, w, h, Math.min(20, h / 2)); ctx.fillStyle = g.a.color; ctx.fill();
      if (conflicts.ids.has(g.a.id)) { ctx.lineWidth = 6; ctx.strokeStyle = '#ff3b30'; ctx.stroke(); }
      if (h < 30) { if (!tiny.includes(g.a)) tiny.push(g.a); continue; }
      ctx.save(); rr(ctx, x, y, w, h, Math.min(20, h / 2)); ctx.clip();
      ctx.fillStyle = textOn(g.a.color);
      const name = (g.a.icon ? g.a.icon + ' ' : '') + g.a.name, time = range(g.a), pad = 28, maxW = w - pad * 2;
      const fs = clamp(h * 0.4, 26, 52);
      if (h >= fs * 2.6) {
        const top = y + Math.min(26, (h - fs * 2.2) / 2);
        setFont(ctx, fs, 700); ctx.textBaseline = 'top'; ctx.fillText(fit(ctx, name, maxW), x + pad, top);
        setFont(ctx, fs * 0.8, 450); ctx.globalAlpha = 0.92; ctx.fillText(fit(ctx, time, maxW), x + pad, top + fs * 1.25); ctx.globalAlpha = 1;
      } else {
        const f1 = clamp(h * 0.55, 24, 44);
        setFont(ctx, f1, 650); ctx.textBaseline = 'middle';
        const full = `${name}  ·  ${time}`;
        ctx.fillText(fit(ctx, ctx.measureText(full).width <= maxW ? full : name, maxW), x + pad, y + h / 2 + 1);
      }
      ctx.restore(); ctx.textBaseline = 'alphabetic';
    }
    if (tiny.length) {
      ctx.fillStyle = P.muted; setFont(ctx, 34, 450);
      ctx.fillText(fit(ctx, 'Short: ' + tiny.map(a => `${a.name} ${range(a)}`).join('  ·  '), W - 2 * M), M, B + 58);
    }
    drawTiles(M, 3060, W - 2 * M, 200, 36, 78, 38);
    drawLegend(M, 3400, W - 2 * M, 46);
  } else {
    // ----- Landscape: 24-hour clock + schedule list -----
    const R1 = 740, R0 = 440, thick = R1 - R0, cx = M + 830, cy = 1230;
    const ang = deg => (deg - 90) * Math.PI / 180;
    ctx.beginPath(); ctx.arc(cx, cy, R1, 0, Math.PI * 2); ctx.arc(cx, cy, R0, 0, Math.PI * 2, true);
    ctx.fillStyle = P.track; ctx.fill('evenodd');
    for (let h = 0; h < 24; h++) {
      const a = ang(h * 15), major = h % 6 === 0;
      ctx.strokeStyle = P.muted; ctx.lineWidth = major ? 5 : 3;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (R1 + 10), cy + Math.sin(a) * (R1 + 10));
      ctx.lineTo(cx + Math.cos(a) * (R1 + (major ? 40 : 26)), cy + Math.sin(a) * (R1 + (major ? 40 : 26))); ctx.stroke();
      ctx.fillStyle = major ? P.text : P.muted; setFont(ctx, major ? 44 : 36, major ? 750 : 450);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(major ? hourLabel(h) : shortHour(h), cx + Math.cos(a) * (R1 + 92), cy + Math.sin(a) * (R1 + 92));
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    for (const g of layoutSegs(acts)) {
      const r0 = R0 + (g.col / g.cols) * thick, r1 = R0 + ((g.col + 1) / g.cols) * thick;
      const a0 = ang(g.s * 0.25), a1 = ang(g.e * 0.25);
      ctx.beginPath(); ctx.arc(cx, cy, r1, a0, a1, false); ctx.arc(cx, cy, r0, a1, a0, true); ctx.closePath();
      ctx.fillStyle = g.a.color; ctx.fill();
      ctx.lineWidth = conflicts.ids.has(g.a.id) ? 8 : 5; ctx.strokeStyle = conflicts.ids.has(g.a.id) ? '#ff3b30' : P.bg; ctx.stroke();
      const spanDeg = (g.e - g.s) * 0.25, rm = (r0 + r1) / 2;
      const chord = 2 * rm * Math.sin(spanDeg * Math.PI / 360) * 0.82;
      if (spanDeg >= 12 && chord >= 120) {
        const mid = ang((g.s + g.e) * 0.125);
        ctx.fillStyle = textOn(g.a.color); setFont(ctx, 34, 650); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(fit(ctx, g.a.name, Math.min(chord, 420)), cx + Math.cos(mid) * rm, cy + Math.sin(mid) * rm);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = P.text; setFont(ctx, 76, 750); ctx.fillText(fit(ctx, r.name, 700), cx, cy - 20);
    ctx.fillStyle = P.muted; setFont(ctx, 44, 450);
    ctx.fillText(`${fmtDur(model.occupied)} planned`, cx, cy + 50);
    ctx.fillText(`${fmtDur(model.free)} free`, cx, cy + 108);
    ctx.textAlign = 'left';

    // Right panel
    const px = 2000, pw = W - M - px;
    drawTiles(px, 380, pw, 200, 32, 78, 38);
    ctx.fillStyle = P.text; setFont(ctx, 50, 700); ctx.fillText('Schedule', px, 690);
    const n = sorted.length, cols = n > 12 ? 2 : 1, perCol = Math.ceil(n / cols) || 1;
    const top = 730, avail = 1030, rowH = Math.min(86, avail / perCol);
    const colW = (pw - (cols - 1) * 60) / cols, fs = clamp(rowH * 0.46, 24, 40);
    sorted.forEach((a, i) => {
      const c = Math.floor(i / perCol), ri = i % perCol;
      const x = px + c * (colW + 60), y = top + ri * rowH;
      const sw = fs * 1.1;
      rr(ctx, x, y + rowH / 2 - sw / 2, sw, sw, sw * 0.28); ctx.fillStyle = a.color; ctx.fill();
      if (conflicts.ids.has(a.id)) { ctx.lineWidth = 4; ctx.strokeStyle = '#ff3b30'; ctx.stroke(); }
      ctx.textBaseline = 'middle';
      setFont(ctx, fs, 450); const t = range(a), tw = ctx.measureText(t).width;
      ctx.fillStyle = P.muted; ctx.textAlign = 'right'; ctx.fillText(t, x + colW, y + rowH / 2); ctx.textAlign = 'left';
      setFont(ctx, fs, 650); ctx.fillStyle = P.text;
      ctx.fillText(fit(ctx, (a.icon ? a.icon + ' ' : '') + a.name, colW - sw - 24 - tw - 24), x + sw + 24, y + rowH / 2);
      ctx.textBaseline = 'alphabetic';
    });
    if (!n) { ctx.fillStyle = P.muted; setFont(ctx, 40, 450); ctx.fillText('No activities planned.', px, top + 50); }
    drawLegend(px, 1880, pw, 40);
  }
  // Footer
  ctx.fillStyle = P.muted; setFont(ctx, 36, 450); ctx.textAlign = 'center';
  ctx.fillText('Planned with DayFlow', W / 2, H - (portrait ? 60 : 50)); ctx.textAlign = 'left';
}

function refreshExport() {
  const canvas = $('#exportPreview');
  $('#expPortrait').classList.toggle('active', ui.expOrient === 'portrait');
  $('#expLandscape').classList.toggle('active', ui.expOrient === 'landscape');
  $('#expThemeLight').classList.toggle('active', ui.expTheme === 'light');
  $('#expThemeDark').classList.toggle('active', ui.expTheme === 'dark');
  try {
    drawExport(canvas, ui.expOrient, ui.expTheme);
    $('#exportStatus').textContent = ui.expOrient === 'portrait'
      ? 'Portrait wallpaper, 2160 × 3840 px — vertical 24-hour timeline.'
      : 'Landscape wallpaper, 3840 × 2160 px — 24-hour clock with a schedule list.';
    $('#expDownload').disabled = false;
  } catch (err) {
    $('#exportStatus').textContent = 'Could not render the image in this browser. Try the other orientation.';
    $('#expDownload').disabled = true;
  }
}
function openExport() {
  state.settings.exportOrientation = ui.expOrient; state.settings.exportTheme = ui.expTheme;
  $('#exportModal').showModal();
  refreshExport();
}
function downloadExport() {
  const canvas = $('#exportPreview');
  const slug = routine().name.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'Routine';
  const name = `DayFlow-${slug}${ui.expOrient === 'landscape' ? '-landscape' : ''}.png`;
  try {
    canvas.toBlob(blob => {
      if (!blob) { $('#exportStatus').textContent = 'Export failed — the image may be too large for this browser. Try the other orientation.'; return; }
      download(blob, name); toast('Image downloaded');
    }, 'image/png');
  } catch (err) {
    $('#exportStatus').textContent = 'Export failed. Please try again.';
  }
}

/* ---------- Event wiring ---------- */
function applyTheme() { document.documentElement.setAttribute('data-theme', state.settings.theme); }

function init() {
  applyTheme();
  fillSelects();
  startPicker = makeTimePicker($('#fStart'));
  endPicker = makeTimePicker($('#fEnd'));
  startPicker.onChange(updateDuration); endPicker.onChange(updateDuration);

  $('#routineSelect').addEventListener('change', e => { state.activeId = e.target.value; ui.selectedId = null; save(); render(); });
  $('#dateInput').addEventListener('change', e => { ui.date = e.target.value || todayStr(); ui.selectedId = null; render(); });
  $('#themeToggle').addEventListener('click', () => { state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; applyTheme(); save(); });
  $('#createBtn').addEventListener('click', () => openActivityModal());
  $('#exportBtn').addEventListener('click', openExport);
  $('#viewVertical').addEventListener('click', () => { state.settings.view = 'vertical'; save(); render(); });
  $('#viewCircular').addEventListener('click', () => { state.settings.view = 'circular'; save(); render(); });

  $('#newRoutineBtn').addEventListener('click', createRoutine);
  $('#renameRoutineBtn').addEventListener('click', renameRoutine);
  $('#dupRoutineBtn').addEventListener('click', duplicateRoutine);
  $('#delRoutineBtn').addEventListener('click', deleteRoutine);
  $('#backupBtn').addEventListener('click', backupJSON);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importJSON(f); });
  $('#sampleBtn').addEventListener('click', loadSample);
  $('#resetBtn').addEventListener('click', resetAll);
  $('#newRoutineForm').addEventListener('submit', onNewRoutineSubmit);
  $('#nrCancel').addEventListener('click', () => $('#newRoutineModal').close());

  // Activity modal
  $('#activityForm').addEventListener('submit', onSaveActivity);
  $('#fCancel').addEventListener('click', () => $('#activityModal').close());
  $('#fDelete').addEventListener('click', () => { if (ui.editingId) deleteActivity(ui.editingId); });
  $('#fColor').addEventListener('input', () => { colorTouched = true; });
  $('#fCategory').addEventListener('change', e => { if (!colorTouched) $('#fColor').value = catColor(e.target.value); });
  ['fName', 'fCategory', 'fColor', 'fRepeat'].forEach(id => $('#' + id).addEventListener('input', () => $('#conflictBox').classList.add('hidden')));
  [startPicker, endPicker].forEach(p => p.onChange(() => $('#conflictBox').classList.add('hidden')));
  $('#conflictBox').addEventListener('click', e => { const b = e.target.closest('[data-conflict]'); if (b) onConflictChoice(b.dataset.conflict); });

  // Timeline interactions (delegated)
  const host = $('#timelineHost');
  const actsById = id => visible().find(a => a.id === id);
  host.addEventListener('click', e => {
    const el = e.target.closest('[data-id]');
    ui.selectedId = el ? el.dataset.id : null;
    render();
  });
  host.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.arc')) { e.preventDefault(); ui.selectedId = e.target.closest('.arc').dataset.id; render(); }
  });
  host.addEventListener('mousemove', e => {
    const el = e.target.closest('[data-id]');
    if (!el) { hideTip(); return; }
    const a = actsById(el.dataset.id);
    if (a) showTip(tipFor(a, findConflicts(visible())), e.clientX, e.clientY);
  });
  host.addEventListener('mouseleave', hideTip);

  // Delegated action buttons (details panel, list, banner)
  document.addEventListener('click', e => {
    const edit = e.target.closest('[data-edit]');
    if (edit) { openActivityModal(edit.dataset.edit); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('[data-row]');
    const id = row ? row.dataset.row : ui.selectedId;
    if (!id) return;
    switch (btn.dataset.act) {
      case 'edit': openActivityModal(id); break;
      case 'delete': deleteActivity(id); break;
      case 'earlier': shiftActivity(id, -15); break;
      case 'later': shiftActivity(id, 15); break;
    }
  });

  // Export modal
  $('#expPortrait').addEventListener('click', () => { ui.expOrient = 'portrait'; state.settings.exportOrientation = 'portrait'; save(); refreshExport(); });
  $('#expLandscape').addEventListener('click', () => { ui.expOrient = 'landscape'; state.settings.exportOrientation = 'landscape'; save(); refreshExport(); });
  $('#expThemeLight').addEventListener('click', () => { ui.expTheme = 'light'; state.settings.exportTheme = 'light'; save(); refreshExport(); });
  $('#expThemeDark').addEventListener('click', () => { ui.expTheme = 'dark'; state.settings.exportTheme = 'dark'; save(); refreshExport(); });
  $('#expDownload').addEventListener('click', downloadExport);
  $('#expClose').addEventListener('click', () => $('#exportModal').close());

  // Keep the current-time indicator fresh; re-layout on resize
  setInterval(() => { if (ui.date === todayStr()) renderTimeline(); }, 30000);
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => renderTimeline(), 150); });

  save();
  render();
}
init();
