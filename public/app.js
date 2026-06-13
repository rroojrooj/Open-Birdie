// Open-Birdie UI glue: SSE <-> HUD <-> 3D scene.
import { GolfScene } from './render/scene.js';

const $ = (id) => document.getElementById(id);
const scene = new GolfScene($('scene'));
window.__birdie = { scene, get state() { return state; } };

let state = null;
let pendingState = null;
let animating = false;
let lastHoleKey = '';
let clubPresets = {};

const CLUBS = [
  ['DR', 'DR'], ['3W', 'W3'], ['3H', 'H3'], ['4i', 'I4'], ['5i', 'I5'], ['6i', 'I6'],
  ['7i', 'I7'], ['8i', 'I8'], ['9i', 'I9'], ['PW', 'PW'], ['SW', 'SW'], ['LW', 'LW'], ['PT', 'PT'],
];

// ---------- state application ----------
function applyState(s) {
  state = s;
  if (!s.loaded) { openCourseModal(); return; }
  $('course-name').textContent = s.courseName.split(',')[0];
  $('hud-hole').textContent = `${s.hole}/${s.holeCount}`;
  $('hud-par').textContent = s.par;
  $('hud-len').textContent = `${s.lengthYd}y`;
  $('hud-pin').textContent = s.distToPinYd > 45
    ? `${Math.round(s.distToPinYd)}y` : `${Math.round(s.distToPinYd * 3)}ft`;
  $('hud-strokes').textContent = s.strokes;
  $('hud-lie').textContent = s.holed ? '⛳' : s.lie;
  $('btn-next').classList.toggle('hidden', !s.holed);
  $('aim-slider').value = s.aimOffset;
  $('aim-val').textContent = `${s.aimOffset > 0 ? '+' : ''}${s.aimOffset}°`;

  const key = `${s.courseName}#${s.hole}`;
  if (scene.geo) {
    if (key !== lastHoleKey) {
      lastHoleKey = key;
      scene.setHole({ pin: s.pin, tee: s.tee }, { x: s.ball.x, y: s.ball.y }, s.aimDeg);
    } else if (!animating) {
      scene.setBall(s.ball);
      scene.setAim(s.aimDeg);
    }
  }
  buildScorecard(s);
}

async function loadGeometry() {
  const geo = await (await fetch('/api/course-geometry')).json();
  if (geo && geo.name) {
    scene.loadCourse(geo);
    lastHoleKey = '';
    if (state) applyState(state);
  }
}

// ---------- SSE ----------
const es = new EventSource('/events');
es.addEventListener('state', (e) => {
  const s = JSON.parse(e.data);
  if (animating) pendingState = s;
  else applyState(s);
});
es.addEventListener('course', () => { loadGeometry(); closeCourseModal(); });
es.addEventListener('lm', (e) => {
  const lm = JSON.parse(e.data);
  $('lm-status').classList.toggle('connected', lm.connected);
  $('lm-text').textContent = lm.connected ? 'LM: connected' : 'LM: waiting';
});
es.addEventListener('shot', (e) => {
  const shot = JSON.parse(e.data);
  showShotData(shot);
  animating = true;
  scene.playShot(shot.sim.points, shot.sim.flightTime, () => {
    animating = false;
    if (pendingState) { applyState(pendingState); pendingState = null; }
    shotToast(shot);
  });
});

function showShotData(shot) {
  $('shotpanel').classList.remove('hidden');
  const l = shot.launch;
  $('sd-speed').textContent = `${l.speedMph.toFixed(1)} mph`;
  $('sd-launch').textContent = `${l.vla.toFixed(1)}° / ${l.hla > 0 ? 'R' : 'L'}${Math.abs(l.hla).toFixed(1)}°`;
  $('sd-spin').textContent = `${Math.round(l.totalSpin)} rpm`;
  $('sd-axis').textContent = `${l.spinAxis > 0 ? 'R' : 'L'}${Math.abs(l.spinAxis).toFixed(1)}°`;
  $('sd-carry').textContent = shot.sim.isPutt ? '—' : `${shot.sim.carryYd.toFixed(0)} yd`;
  $('sd-total').textContent = shot.sim.isPutt ? `${(shot.sim.totalYd * 3).toFixed(0)} ft` : `${shot.sim.totalYd.toFixed(0)} yd`;
  $('sd-offline').textContent = `${shot.sim.offlineYd > 0 ? 'R' : 'L'} ${Math.abs(shot.sim.offlineYd).toFixed(0)} yd`;
  $('sd-apex').textContent = shot.sim.isPutt ? '—' : `${shot.sim.apexFt.toFixed(0)} ft`;
}

function shotToast(shot) {
  const t = $('toast');
  let main, sub = shot.note || '';
  if (shot.holed) {
    const par = state?.par ?? 4;
    const diff = shot.strokes - par;
    const names = { '-3': 'ALBATROSS!', '-2': 'EAGLE!', '-1': 'BIRDIE!', 0: 'Par', 1: 'Bogey', 2: 'Double bogey' };
    main = `⛳ ${names[diff] ?? (diff > 0 ? `+${diff}` : 'Holed!')} — ${shot.strokes} strokes`;
  } else if (shot.sim.isPutt) {
    main = `${(shot.sim.totalYd * 3).toFixed(0)} ft putt`;
  } else {
    main = `Carry ${shot.sim.carryYd.toFixed(0)} · Total ${shot.sim.totalYd.toFixed(0)} yd`;
    if (!sub) sub = `${shot.sim.offlineYd > 0 ? 'R' : 'L'}${Math.abs(shot.sim.offlineYd).toFixed(0)} yd ${shot.lie === 'ob' ? '' : '· lie: ' + shot.lie}`;
  }
  t.innerHTML = `${main}${sub ? `<div class="sub">${sub}</div>` : ''}`;
  t.classList.remove('hidden');
  t.style.opacity = 1;
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.style.opacity = 0; }, 4200);
}

// ---------- scorecard ----------
function buildScorecard(s) {
  const n = s.pars.length;
  let h1 = '<tr><th></th>', p1 = '<tr><th>Par</th>', s1 = '<tr><th>Score</th>';
  for (let i = 0; i < n; i++) {
    h1 += `<th>${i + 1}</th>`;
    p1 += `<td>${s.pars[i]}</td>`;
    const sc = s.scores[i];
    const cls = sc == null ? '' : sc < s.pars[i] ? 'under' : sc > s.pars[i] ? 'over' : '';
    s1 += `<td class="${cls}">${sc ?? ''}</td>`;
  }
  const totPar = s.pars.reduce((a, b) => a + b, 0);
  const totScore = s.scores.reduce((a, b) => a + (b || 0), 0);
  $('score-table').innerHTML =
    `<table>${h1}<th>Σ</th></tr>${p1}<td>${totPar}</td></tr>${s1}<td>${totScore || ''}</td></tr></table>`;
}

// ---------- controls ----------
$('btn-next').onclick = () => fetch('/api/next-hole', { method: 'POST' });
$('btn-score').onclick = () => $('scorecard').classList.toggle('hidden');
$('btn-restart').onclick = () => { fetch('/api/reset', { method: 'POST' }); $('scorecard').classList.add('hidden'); };
$('btn-practice').onclick = () => $('practice').classList.toggle('hidden');
$('btn-course').onclick = () => openCourseModal();

let aimT = null;
$('aim-slider').oninput = (e) => {
  const v = +e.target.value;
  $('aim-val').textContent = `${v > 0 ? '+' : ''}${v}°`;
  if (state) scene.setAim(state.aimDeg - state.aimOffset + v);
  clearTimeout(aimT);
  aimT = setTimeout(() => fetch('/api/aim', {
    method: 'POST', body: JSON.stringify({ offset: v }),
  }), 180);
};

// clubs
const clubsEl = $('clubs');
for (const [label, key] of CLUBS) {
  const b = document.createElement('button');
  b.className = 'club';
  b.textContent = label;
  b.onclick = () => {
    document.querySelectorAll('#clubs .club').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    fetch('/api/club', { method: 'POST', body: JSON.stringify({ club: label.toUpperCase() }) });
    const p = clubPresets[key];
    if (p) setPractice(p.speedMph, p.vla, p.spin);
  };
  clubsEl.appendChild(b);
}
fetch('/api/clubs').then((r) => r.json()).then((p) => { clubPresets = p; });

// practice panel
const PS = ['speed', 'vla', 'hla', 'spin', 'axis'];
const psUnits = { speed: ' mph', vla: '°', hla: '°', spin: ' rpm', axis: '°' };
for (const k of PS) {
  $(`ps-${k}`).oninput = (e) => { $(`ps-${k}-v`).textContent = e.target.value + psUnits[k]; };
}
function setPractice(speed, vla, spin) {
  $('ps-speed').value = speed; $('ps-speed-v').textContent = `${speed} mph`;
  $('ps-vla').value = vla; $('ps-vla-v').textContent = `${vla}°`;
  $('ps-spin').value = spin; $('ps-spin-v').textContent = `${spin} rpm`;
}
$('ps-hit').onclick = () => {
  if (animating) return;
  fetch('/api/test-shot', {
    method: 'POST',
    body: JSON.stringify({
      speed: +$('ps-speed').value, vla: +$('ps-vla').value, hla: +$('ps-hla').value,
      spin: +$('ps-spin').value, spinAxis: +$('ps-axis').value,
    }),
  });
};

// ---------- course modal ----------
function openCourseModal() {
  $('course-modal').classList.remove('hidden');
  $('course-modal').style.display = 'flex';
  loadCachedList();
}
function closeCourseModal() {
  $('course-modal').style.display = 'none';
}

async function loadCachedList() {
  try {
    const cached = await (await fetch('/api/courses/cached')).json();
    const el = $('course-cached');
    el.innerHTML = cached.length ? '<p class="muted" style="margin:10px 0 6px">Downloaded courses (instant):</p>' : '';
    for (const c of cached) {
      const d = document.createElement('div');
      d.className = 'result';
      d.innerHTML = `<span class="badge">saved</span> ${c.name.split(',').slice(0, 3).join(',')}`;
      d.onclick = () => pickCourse({ cached: c.file, name: c.name });
      el.appendChild(d);
    }
  } catch (_) { /* server starting */ }
}

async function doSearch(q) {
  if (!q.trim()) return;
  const msg = $('course-msg');
  msg.className = 'muted';
  msg.innerHTML = '<span class="loading-spin"></span>searching OpenStreetMap…';
  $('course-results').innerHTML = '';
  try {
    const rows = await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json();
    if (rows.error) throw new Error(rows.error);
    msg.textContent = rows.length ? '' : 'No results — try adding the city or country name.';
    for (const r of rows) {
      const d = document.createElement('div');
      d.className = 'result';
      const isCourse = r.type === 'golf_course';
      d.innerHTML = `<span class="badge ${isCourse ? '' : 'other'}">${isCourse ? 'golf course' : r.type}</span> ${r.name}`;
      d.onclick = () => pickCourse({ name: r.name, bbox: r.bbox, osmType: r.osmType, osmId: r.osmId });
      $('course-results').appendChild(d);
    }
  } catch (err) {
    msg.className = 'muted error';
    msg.textContent = 'Search failed: ' + err.message;
  }
}

async function pickCourse(body) {
  const msg = $('course-msg');
  msg.className = 'muted';
  msg.innerHTML = '<span class="loading-spin"></span>Downloading course + terrain from open data… 10–90 s on first load.';
  try {
    const r = await (await fetch('/api/load-course', { method: 'POST', body: JSON.stringify(body) })).json();
    if (r.error) throw new Error(r.error);
    msg.textContent = '';
    // course SSE event closes the modal & loads geometry
  } catch (err) {
    msg.className = 'muted error';
    msg.textContent = err.message;
  }
}

$('course-search').onclick = () => doSearch($('course-q').value);
$('course-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch($('course-q').value); });
document.querySelectorAll('.chip').forEach((c) => {
  c.onclick = () => { $('course-q').value = c.dataset.q; doSearch(c.dataset.q); };
});

// ---------- boot ----------
(async () => {
  try {
    await loadGeometry();
    const s = await (await fetch('/api/state')).json();
    applyState(s);
    if (!s.loaded) openCourseModal();
    else closeCourseModal();
  } catch (err) {
    console.error('boot failed', err);
  }
})();
