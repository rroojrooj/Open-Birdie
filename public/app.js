// Open-Birdie UI glue: SSE <-> HUD <-> 3D scene.
import { GolfScene } from './render/scene.js';
import { loadHdBundle } from './render/hd-bundle.js';
import { toPar, forwardLabel, verdict } from './scoring.mjs';

const $ = (id) => document.getElementById(id);
const scene = new GolfScene($('scene'));
// Readiness nonce handed only to the loopback Electron primary client (absent on LAN mirrors).
const primaryNonce = new URLSearchParams(location.search).get('primaryNonce') || '';
window.__birdie = { scene, get state() { return state; } };

let state = null;
let pendingState = null;
let animating = false;
let lastHoleKey = '';
let clubPresets = {};
let prevOver = false;   // round-over auto-open latch (open the card once, not every state event)
let reviewHole = null;  // index of a played hole being reviewed on the scorecard

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
  const pinTxt = s.distToPinYd > 45
    ? `${Math.round(s.distToPinYd)}y` : `${Math.round(s.distToPinYd * 3)}ft`;
  $('hud-pin').textContent = pinTxt;
  $('lie-pin').textContent = pinTxt;
  $('hud-strokes').textContent = s.strokes;
  $('hud-lie').textContent = s.holed ? '⛳' : s.lie;
  updateForward(s);
  $('aim-slider').value = s.aimOffset;
  $('aim-val').textContent = `${s.aimOffset > 0 ? '+' : ''}${s.aimOffset}°`;
  updateScoreChip(s);
  updateHolePills(s);
  drawMinimap(s);

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

  // round-over: auto-open the card exactly once (latched on the false->true edge), and
  // lock out further play. Lives here so the pendingState/animation path triggers it too.
  if (s.over && !prevOver) { $('scorecard').classList.remove('hidden'); $('practice').classList.add('hidden'); }
  prevOver = s.over;
  $('btn-practice').classList.toggle('hidden', !!s.over);
}

async function loadGeometry() {
  const geo = await (await fetch('/api/course-geometry')).json();
  if (!geo || !geo.name) return;
  let hdAssets = null;
  let mode = 'procedural';
  if (geo.hd) {
    try {
      hdAssets = await loadHdBundle(geo.hd, {
        imageDecoder: (bytes, opts) => createImageBitmap(new Blob([bytes]), opts),
        expectedRevision: geo.courseRevision,
      });
      mode = 'hd';
    } catch (e) {
      console.warn('[hd] bundle load failed — procedural fallback:', e && e.message);
      hdAssets = null;
    }
  }
  scene.loadCourse(geo, { hdAssets });
  lastHoleKey = '';
  if (state) applyState(state);
  // Acknowledge readiness so the server activates the matching physics. HD courses are
  // held at runtimeReady:false until this; plain courses are already ready.
  if (geo.hd) {
    try {
      await fetch('/api/course-runtime-ready', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRevision: geo.courseRevision, bundleId: geo.hd.bundleId, mode, primaryNonce }),
      });
    } catch (e) { /* LAN mirror / transient — the server's readiness timeout covers it */ }
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

function setVal(id, num, unit) {
  $(id).innerHTML = unit ? `${num}<span class="dunit">${unit}</span>` : `${num}`;
}
// Infer the club from ball speed so the HUD reflects what was actually hit
// (launch monitors report ball data, not club; auto-play uses this too).
function clubFromShot(speedMph, isPutt) {
  if (isPutt) return 'PT';
  const t = [[158, 'DR'], [147, '3W'], [138, '3H'], [130, '4i'], [123, '5i'],
            [115, '6i'], [107, '7i'], [99, '8i'], [88, '9i'], [70, 'PW'], [50, 'SW']];
  for (const [min, c] of t) if (speedMph >= min) return c;
  return 'LW';
}
// Map a launch-monitor club name (e.g. "DRIVER", "WOOD5", "IRON7") to a short HUD label.
function prettyClub(name) {
  const s = String(name).toUpperCase().replace(/[\s_]/g, '');
  if (/DRIVER|^1W$/.test(s)) return 'DR';
  if (/PUTTER|^PUTT$/.test(s)) return 'PT';
  let m;
  if ((m = s.match(/(?:WOOD|^W)(\d+)/))) return m[1] + 'W';
  if ((m = s.match(/(?:HYBRID|UTILITY|^H|^U)(\d+)/))) return m[1] + 'H';
  if ((m = s.match(/(?:IRON|^I)(\d+)/))) return m[1] + 'i';
  if (/PITCH|^PW$|WEDGEP/.test(s)) return 'PW';
  if (/SAND|^SW$|WEDGES/.test(s)) return 'SW';
  if (/LOB|^LW$|WEDGEL/.test(s)) return 'LW';
  if (/GAP|APPROACH|^GW$|^AW$|WEDGEA|WEDGEG/.test(s)) return 'GW';
  return name;   // unknown — show the monitor's label as-is
}
function showShotData(shot) {
  $('shotpanel').classList.remove('hidden');
  const l = shot.launch, sim = shot.sim;
  const club = shot.club ? prettyClub(shot.club) : clubFromShot(l.speedMph, sim.isPutt);
  $('lie-club').textContent = club;
  document.querySelectorAll('#clubs .club').forEach((b) => b.classList.toggle('active', b.textContent.toUpperCase() === club.toUpperCase()));
  setVal('sd-speed', l.speedMph.toFixed(1), 'mph');
  setVal('sd-launch', `${l.vla.toFixed(1)}°/${l.hla > 0 ? 'R' : 'L'}${Math.abs(l.hla).toFixed(1)}°`, '');
  setVal('sd-spin', Math.round(l.totalSpin), 'rpm');
  setVal('sd-axis', `${l.spinAxis > 0 ? 'R' : 'L'}${Math.abs(l.spinAxis).toFixed(1)}°`, '');
  setVal('sd-carry', sim.isPutt ? '—' : sim.carryYd.toFixed(0), sim.isPutt ? '' : 'yds');
  setVal('sd-total', sim.isPutt ? (sim.totalYd * 3).toFixed(0) : sim.totalYd.toFixed(0), sim.isPutt ? 'ft' : 'yds');
  setVal('sd-offline', `${sim.offlineYd > 0 ? 'R' : 'L'}${Math.abs(sim.offlineYd).toFixed(0)}`, 'yds');
  setVal('sd-apex', sim.isPutt ? '—' : sim.apexFt.toFixed(0), sim.isPutt ? '' : 'ft');
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

// ---------- HUD chips ----------
const FWD_ARIA = {
  'Pick up': 'Pick up this hole and go to the next',
  Skip: 'Skip this hole and go to the next',
  'Next hole': 'Go to the next hole',
  'Finish round': 'Finish the round and see the scorecard',
};
function updateForward(s) {
  const f = forwardLabel(s);
  const btn = $('btn-next');
  btn.classList.toggle('hidden', !!f.hidden);
  if (f.label) { btn.textContent = `${f.label} ▶`; btn.setAttribute('aria-label', FWD_ARIA[f.label] || f.label); }
}
function updateScoreChip(s) {
  const t = toPar(s.scores, s.pars);
  const chip = $('score-chip');
  chip.textContent = t === 0 ? 'E' : t > 0 ? `+${t}` : `${t}`;
  chip.classList.toggle('under', t < 0);
  chip.classList.toggle('over', t > 0);
}

function updateHolePills(s) {
  const el = $('hole-pills');
  if (el.children.length !== s.holeCount) {
    el.innerHTML = '';
    for (let i = 1; i <= s.holeCount; i++) {
      const p = document.createElement('button');
      p.className = 'pill'; p.textContent = i; p.dataset.h = i; p.type = 'button';
      p.onclick = () => reviewHoleOnCard(+p.dataset.h);
      el.appendChild(p);
    }
  }
  for (const p of el.children) {
    const h = +p.dataset.h;
    const done = s.scores[h - 1] != null;
    p.classList.toggle('active', h === s.hole);
    p.classList.toggle('done', done);
    p.classList.toggle('pickedup', !!(s.pickedUp && s.pickedUp[h - 1]));
    p.disabled = !done && h !== s.hole; // only played holes (and the current one) are reachable
    p.setAttribute('aria-label', done ? `Hole ${h}, score ${s.scores[h - 1]}` : `Hole ${h}`);
    if (h === s.hole) p.setAttribute('aria-current', 'true'); else p.removeAttribute('aria-current');
  }
}

// Review a played hole: open the scorecard and highlight that hole's column.
// (E1 — review is the scorecard, not a shot replay or a camera move.)
function reviewHoleOnCard(h) {
  if (!state || state.scores[h - 1] == null) return;
  reviewHole = h - 1;
  $('scorecard').classList.remove('hidden');
  buildScorecard(state);
}

// ---------- hole minimap ----------
function mmRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const MM_COL = { rough: '#a9c899', fairway: '#82c46d', range: '#82c46d', tee: '#82c46d', green: '#57a447', bunker: '#e8d9a8', water: '#8cc0dd' };
const MM_Z = { rough: 0, fairway: 1, range: 1, tee: 1, green: 2, bunker: 3, water: 3 };

function drawMinimap(s) {
  const cv = $('mm-canvas');
  const geo = scene.geo;
  if (!cv || !geo || !s.tee || !s.pin) return;
  $('minimap').classList.remove('hidden');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#9bbd8a'; mmRoundRect(ctx, 0, 0, W, H, 8); ctx.fill();

  const tee = s.tee, pin = s.pin, ball = [s.ball.x, s.ball.y];
  let fx = pin[0] - tee[0], fy = pin[1] - tee[1];
  const flen = Math.hypot(fx, fy) || 1; fx /= flen; fy /= flen;
  const rxv = fy, ryv = -fx;                 // canvas "right" = forward rotated -90
  const cx = (tee[0] + pin[0]) / 2, cy = (tee[1] + pin[1]) / 2;
  const marginA = 35, marginS = 75;
  const scale = (H - 26) / (flen + 2 * marginA);
  const toC = (px, py) => {
    const ax = px - cx, ay = py - cy;
    return [W / 2 + (ax * rxv + ay * ryv) * scale, H / 2 - (ax * fx + ay * fy) * scale];
  };
  const inCorridor = (poly) => {
    for (const [px, py] of poly) {
      const ax = px - cx, ay = py - cy;
      if (Math.abs(ax * fx + ay * fy) < flen / 2 + marginA && Math.abs(ax * rxv + ay * ryv) < marginS) return true;
    }
    return false;
  };

  ctx.save(); mmRoundRect(ctx, 0, 0, W, H, 8); ctx.clip();
  const surfs = geo.surfaces.filter((su) => MM_COL[su.kind] && su.poly.length >= 3 && inCorridor(su.poly))
    .sort((a, b) => (MM_Z[a.kind] ?? 1) - (MM_Z[b.kind] ?? 1));
  for (const su of surfs) {
    ctx.fillStyle = MM_COL[su.kind];
    ctx.beginPath();
    su.poly.forEach((p, i) => { const [X, Y] = toC(p[0], p[1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.closePath(); ctx.fill();
  }

  const ink = '#16221a';
  const [bx, by] = toC(ball[0], ball[1]);
  const [pxc, pyc] = toC(pin[0], pin[1]);
  const [txc, tyc] = toC(tee[0], tee[1]);
  ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(22,40,26,0.55)';
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(pxc, pyc); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(22,40,26,0.6)'; ctx.beginPath(); ctx.arc(txc, tyc, 2.6, 0, 7); ctx.fill();
  ctx.lineWidth = 1.6; ctx.strokeStyle = ink; ctx.beginPath(); ctx.moveTo(pxc, pyc); ctx.lineTo(pxc, pyc - 10); ctx.stroke();
  ctx.fillStyle = '#1f7a40'; ctx.beginPath(); ctx.moveTo(pxc, pyc - 10); ctx.lineTo(pxc + 7, pyc - 8); ctx.lineTo(pxc, pyc - 6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.strokeStyle = ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(bx, by, 3.6, 0, 7); ctx.fill(); ctx.stroke();
  ctx.restore();

  $('mm-title').textContent = `HOLE ${s.hole} · PAR ${s.par} · ${s.lengthYd}y`;
  $('mm-topin').textContent = s.distToPinYd > 45 ? `${Math.round(s.distToPinYd)}y` : `${Math.round(s.distToPinYd * 3)}ft`;
}

// ---------- scorecard ----------
function buildScorecard(s) {
  const n = s.pars.length;
  let h1 = '<tr><th></th>', p1 = '<tr><th>Par</th>', s1 = '<tr><th>Score</th>';
  for (let i = 0; i < n; i++) {
    const hl = i === reviewHole ? ' review' : '';
    h1 += `<th class="${hl.trim()}">${i + 1}</th>`;
    p1 += `<td class="${hl.trim()}">${s.pars[i]}</td>`;
    const sc = s.scores[i];
    const cls = sc == null ? '' : sc < s.pars[i] ? 'under' : sc > s.pars[i] ? 'over' : '';
    const dot = (s.pickedUp && s.pickedUp[i]) ? '<i class="pu" title="picked up"></i>' : '';
    s1 += `<td class="${(cls + hl).trim()}">${sc ?? ''}${dot}</td>`;
  }
  const totPar = s.pars.reduce((a, b) => a + b, 0);
  const totScore = s.scores.reduce((a, b) => a + (b || 0), 0);
  $('score-table').innerHTML =
    `<table>${h1}<th>Σ</th></tr>${p1}<td>${totPar}</td></tr>${s1}<td>${totScore || ''}</td></tr></table>`;
  buildSummary(s);
}

function nineRel(s, a, b) {
  let sc = 0, pr = 0;
  for (let i = a; i < b; i++) { pr += s.pars[i]; if (s.scores[i] != null) sc += s.scores[i]; }
  return { sc, rel: sc - pr };
}
function relTxt(rel) { return rel === 0 ? 'E' : rel > 0 ? `+${rel}` : `${rel}`; }

function highlights(s) {
  let eagles = 0, birdies = 0, best = null, bestRel = 99;
  for (let i = 0; i < s.scores.length; i++) {
    const sc = s.scores[i]; if (sc == null) continue;
    const rel = sc - s.pars[i];
    if (rel <= -2) eagles++; else if (rel === -1) birdies++;
    if (rel < bestRel) { bestRel = rel; best = i + 1; }
  }
  const chips = [];
  if (eagles) chips.push(`<span class="sum-chip good">${eagles} eagle${eagles > 1 ? 's' : ''}+</span>`);
  if (birdies) chips.push(`<span class="sum-chip good">${birdies} birdie${birdies > 1 ? 's' : ''}</span>`);
  if (!eagles && !birdies) chips.push('<span class="sum-chip">No birdies this round</span>');
  if (best != null) chips.push(`<span class="sum-chip">Best: hole ${best}</span>`);
  return `<div class="sum-hi">${chips.join('')}</div>`;
}

// Round-complete header (D4 calm payoff): hero to-par + verdict, nines (18 only),
// highlights. Reuses the same #scorecard panel (D5), shown only when the round is over.
function buildSummary(s) {
  const el = $('score-summary');
  $('btn-restart').textContent = s.over ? 'New round' : 'Restart round';
  $('btn-changecourse').classList.toggle('hidden', !s.over);
  $('score-title').classList.toggle('hidden', !!s.over);
  if (!s.over) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const t = toPar(s.scores, s.pars);
  const totPar = s.pars.reduce((a, b) => a + b, 0);
  const totScore = s.scores.reduce((a, b) => a + (b || 0), 0);
  const tTxt = t === 0 ? 'E' : t > 0 ? `+${t}` : `${t}`;
  let nines = '';
  if (s.pars.length === 18) {
    const o = nineRel(s, 0, 9), i = nineRel(s, 9, 18);
    nines = '<div class="sum-nines">'
      + `<div class="sum-tile"><span>Out</span><b>${o.sc || '–'} <em>${relTxt(o.rel)}</em></b></div>`
      + `<div class="sum-tile"><span>In</span><b>${i.sc || '–'} <em>${relTxt(i.rel)}</em></b></div>`
      + '</div>';
  }
  el.innerHTML = '<div class="sum-eyebrow">⛳ Round complete</div>'
    + '<div class="sum-hero">'
    + `<div class="sum-topar ${t < 0 ? 'under' : t > 0 ? 'over' : ''}">${tTxt}</div>`
    + `<div class="sum-meta"><b>${verdict(t)}</b><span>${totScore} strokes · par ${totPar}</span></div>`
    + `</div>${nines}${highlights(s)}`;
}

// ---------- controls ----------
let fwdBusy = false; // debounce the forward POST so a double-press can't skip a hole (F6)
$('btn-next').onclick = async () => {
  if (fwdBusy) return;
  fwdBusy = true;
  try { await fetch('/api/next-hole', { method: 'POST' }); }
  finally { setTimeout(() => { fwdBusy = false; }, 250); }
};
function toggleScorecard() { reviewHole = null; $('scorecard').classList.toggle('hidden'); if (state) buildScorecard(state); }
$('btn-score').onclick = toggleScorecard;
$('stat-hole').onclick = toggleScorecard;   // the HOLE badge opens the scorecard (phone hole-nav)
$('stat-hole').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleScorecard(); } };
$('btn-restart').onclick = () => { reviewHole = null; fetch('/api/reset', { method: 'POST' }); $('scorecard').classList.add('hidden'); };
$('btn-changecourse').onclick = () => { $('scorecard').classList.add('hidden'); openCourseModal(); };
$('btn-practice').onclick = () => $('practice').classList.toggle('hidden');
$('btn-course').onclick = () => openCourseModal();

// Free course-creator camera: fly/orbit the hole to inspect surfaces against the aerial.
scene.setFreeCamCallback((on) => {
  $('btn-free').classList.toggle('active', on);
  $('btn-free').textContent = on ? 'Exit free' : 'Free look';
  $('freecam-hint').classList.toggle('hidden', !on);
});
$('btn-free').onclick = () => scene.enterFreeCam(scene.camMode !== 'free');

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
    $('lie-club').textContent = label.toUpperCase();
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
  if (animating || state?.over) return;
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
