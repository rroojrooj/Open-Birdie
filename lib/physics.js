'use strict';
// Golf ball flight + ground physics over real terrain.
// Coordinates: x = east (m), y = north (m), z = up (m, same datum as the
// course elevation grid). Launch data follows GSPro Open Connect conventions:
//   speed (mph), VLA deg (up), HLA deg (+ = right of aim), totalSpin rpm,
//   spinAxis deg (- = draw / curves left for RH).

const MPH = 0.44704;           // mph -> m/s
const YD = 0.9144;             // yards -> m
const M = 0.04593;             // ball mass kg
const R = 0.021335;            // ball radius m
const AREA = Math.PI * R * R;
const RHO = 1.225;             // air density kg/m^3
const G = 9.81;
const SPIN_TAU = 20;           // spin decay time constant, s
const ROLL_INERTIA = 5 / 7;    // rolling sphere: effective slope acceleration factor
const V_STOP = 0.05;           // m/s — candidate rest speed
const CUP_RADIUS = 0.22;       // m — generous cup capture for sim play
const CUP_MAX_SPEED = 3.0;     // m/s — faster than this lips out

// Aerodynamic coefficients vs spin ratio S = omega*R/v.
// Tuned against tour launch-monitor averages — see tools/calibrate.js.
function dragCoeff(S) {
  return 0.21 + 0.22 * Math.min(S, 0.6);
}
function liftCoeff(S) {
  if (S <= 0) return 0;
  return Math.min(0.24, 0.95 * Math.pow(S, 0.70));
}

const SURFACES = {
  green:   { e: 0.30, keep: 0.35, roll: 0.6,  spinBite: 1.0 },
  tee:     { e: 0.40, keep: 0.55, roll: 2.0,  spinBite: 0.5 },
  fairway: { e: 0.40, keep: 0.55, roll: 2.0,  spinBite: 0.6 },
  rough:   { e: 0.28, keep: 0.30, roll: 4.5,  spinBite: 0.2 },
  bunker:  { e: 0.10, keep: 0.12, roll: 9.0,  spinBite: 0.0 },
  water:   { e: 0,    keep: 0,    roll: 99,   spinBite: 0 },
  ob:      { e: 0.28, keep: 0.30, roll: 4.5,  spinBite: 0.2 },
};

const FLAT = { flat: true, h: () => 0, grad: () => ({ dx: 0, dy: 0 }) };

/**
 * Simulate one shot.
 * @param {object} launch {speedMph, vla, hla, totalSpin, spinAxis}
 * @param {object} start  {x, y} starting position (z from terrain)
 * @param {number} aimDeg compass heading of aim line, deg clockwise from north
 * @param {function} surfaceAt (x, y) => 'green'|'fairway'|...
 * @param {object} opts {terrain, pin: {x,y}, wind: {speedMps, fromDeg}, putt}
 */
function simulateShot(launch, start, aimDeg, surfaceAt, opts = {}) {
  const terrain = opts.terrain || FLAT;
  const v0 = launch.speedMph * MPH;
  const headRad = (aimDeg + launch.hla) * Math.PI / 180;
  const dir = { x: Math.sin(headRad), y: Math.cos(headRad) };
  const aimRad = aimDeg * Math.PI / 180;
  const aimDir = { x: Math.sin(aimRad), y: Math.cos(aimRad) };

  const startSurface = surfaceAt(start.x, start.y);
  const isPutt = opts.putt || (startSurface === 'green' && launch.vla < 2 && launch.speedMph < 40);

  const events = [];
  const points = [];
  const startZ = terrain.h(start.x, start.y);
  let t = 0;
  let pos = { x: start.x, y: start.y, z: startZ };
  let vel, omega, omegaAxis;

  if (isPutt) {
    vel = { x: dir.x * v0, y: dir.y * v0, z: 0 };
    omega = 0;
    omegaAxis = { x: 0, y: 0, z: 0 };
  } else {
    const vlaRad = launch.vla * Math.PI / 180;
    vel = {
      x: dir.x * v0 * Math.cos(vlaRad),
      y: dir.y * v0 * Math.cos(vlaRad),
      z: v0 * Math.sin(vlaRad),
    };
    omega = (launch.totalSpin || 0) * 2 * Math.PI / 60;
    // Pure backspin axis points RIGHT of travel; tilt by -spinAxis around the
    // travel direction so negative spinAxis (draw) curves the ball left.
    const right = { x: dir.y, y: -dir.x, z: 0 };
    const a = -(launch.spinAxis || 0) * Math.PI / 180;
    omegaAxis = {
      x: right.x * Math.cos(a),
      y: right.y * Math.cos(a),
      z: Math.sin(a),
    };
  }

  const wind = { x: 0, y: 0, z: 0 };
  if (opts.wind && opts.wind.speedMps > 0) {
    const wr = (opts.wind.fromDeg + 180) * Math.PI / 180;
    wind.x = Math.sin(wr) * opts.wind.speedMps;
    wind.y = Math.cos(wr) * opts.wind.speedMps;
  }

  const dt = 0.002;
  let carryPos = null;
  let apex = 0;
  let flightTime = 0;
  let bounces = 0;
  let phase = isPutt ? 'roll' : 'air';
  let sampleAcc = 0;
  let lowSpeedT = 0;
  let holed = false;

  points.push({ t, x: pos.x, y: pos.y, z: pos.z });

  sim:
  while (t < 60) {
    t += dt;

    if (phase === 'air') {
      const rvx = vel.x - wind.x, rvy = vel.y - wind.y, rvz = vel.z;
      const v = Math.hypot(rvx, rvy, rvz) || 1e-6;
      const S = omega * R / v;
      const q = 0.5 * RHO * AREA * v * v;
      const cd = dragCoeff(S), cl = liftCoeff(S);

      let ax = -q * cd * (rvx / v) / M;
      let ay = -q * cd * (rvy / v) / M;
      let az = -q * cd * (rvz / v) / M - G;

      const mx = omegaAxis.y * rvz - omegaAxis.z * rvy;
      const my = omegaAxis.z * rvx - omegaAxis.x * rvz;
      const mz = omegaAxis.x * rvy - omegaAxis.y * rvx;
      const mlen = Math.hypot(mx, my, mz);
      if (mlen > 1e-9) {
        ax += q * cl * (mx / mlen) / M;
        ay += q * cl * (my / mlen) / M;
        az += q * cl * (mz / mlen) / M;
      }

      vel.x += ax * dt; vel.y += ay * dt; vel.z += az * dt;
      pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
      omega *= Math.exp(-dt / SPIN_TAU);
      if (pos.z - startZ > apex) apex = pos.z - startZ;

      const ground = terrain.h(pos.x, pos.y);
      if (pos.z <= ground) {
        pos.z = ground;
        const g = terrain.grad(pos.x, pos.y);
        const nl = Math.hypot(g.dx, g.dy, 1);
        const n = { x: -g.dx / nl, y: -g.dy / nl, z: 1 / nl };
        const vDotN = vel.x * n.x + vel.y * n.y + vel.z * n.z;
        if (vDotN >= 0) { pos.z = ground + 0.001; continue; } // skimming away

        const surf = surfaceAt(pos.x, pos.y);
        if (!carryPos) { carryPos = { x: pos.x, y: pos.y }; flightTime = t; }
        if (surf === 'water') { events.push({ type: 'water', x: pos.x, y: pos.y }); break; }
        const sp = SURFACES[surf] || SURFACES.rough;
        bounces++;
        events.push({ type: 'bounce', x: pos.x, y: pos.y, surface: surf });

        // split velocity into normal + tangential parts
        const vn = { x: n.x * vDotN, y: n.y * vDotN, z: n.z * vDotN };
        const vt = { x: vel.x - vn.x, y: vel.y - vn.y, z: vel.z - vn.z };
        const bite = sp.spinBite * Math.min(1, omega / 900);
        let keep = sp.keep * (1 - 0.8 * bite);
        if (surf === 'green' && bite > 0.55 && bounces <= 2) keep = -0.08; // zip back
        const reboundV = -vDotN * sp.e;
        omega *= 0.55;

        if (reboundV < 0.7 || bounces >= 6) {
          vel = { x: vt.x * keep, y: vt.y * keep, z: 0 };
          phase = 'roll';
        } else {
          vel = {
            x: vt.x * keep + n.x * reboundV,
            y: vt.y * keep + n.y * reboundV,
            z: vt.z * keep + n.z * reboundV,
          };
        }
      }
    } else { // roll — 2D velocity glued to the terrain surface
      const v = Math.hypot(vel.x, vel.y);
      const surf = surfaceAt(pos.x, pos.y);
      if (surf === 'water') { events.push({ type: 'water', x: pos.x, y: pos.y }); break; }
      const sp = SURFACES[surf] || SURFACES.rough;
      const g = terrain.grad(pos.x, pos.y);
      const gmag = Math.hypot(g.dx, g.dy);
      const gx = gmag > 1 ? g.dx / gmag : g.dx;   // clamp slope to 45 deg
      const gy = gmag > 1 ? g.dy / gmag : g.dy;

      if (v < V_STOP) {
        lowSpeedT += dt;
        // static friction holds, or the ball has dithered long enough
        if (ROLL_INERTIA * G * Math.min(gmag, 1) <= sp.roll || lowSpeedT > 0.5) break;
      } else {
        lowSpeedT = 0;
      }

      let ax = -ROLL_INERTIA * G * gx;
      let ay = -ROLL_INERTIA * G * gy;
      if (v > 1e-6) {
        ax -= sp.roll * vel.x / v;
        ay -= sp.roll * vel.y / v;
      }
      vel.x += ax * dt; vel.y += ay * dt;
      // friction can't reverse direction within a step
      if ((vel.x * (vel.x - ax * dt) + vel.y * (vel.y - ay * dt)) < 0 && gmag < 0.02) {
        vel.x = 0; vel.y = 0;
      }
      pos.x += vel.x * dt; pos.y += vel.y * dt;
      pos.z = terrain.h(pos.x, pos.y);

      // cup capture
      if (opts.pin) {
        const dp = Math.hypot(opts.pin.x - pos.x, opts.pin.y - pos.y);
        if (dp < CUP_RADIUS && Math.hypot(vel.x, vel.y) < CUP_MAX_SPEED) {
          holed = true;
          events.push({ type: 'holed', x: pos.x, y: pos.y });
          pos.x = opts.pin.x; pos.y = opts.pin.y;
          break;
        }
      }
    }

    sampleAcc += dt;
    if (sampleAcc >= 0.02) {
      sampleAcc = 0;
      points.push({ t, x: pos.x, y: pos.y, z: pos.z });
    }
  }
  points.push({ t, x: pos.x, y: pos.y, z: pos.z });

  if (!carryPos) { carryPos = { x: pos.x, y: pos.y }; flightTime = t; }

  const dx = pos.x - start.x, dy = pos.y - start.y;
  const cdx = carryPos.x - start.x, cdy = carryPos.y - start.y;
  const offline = dx * -aimDir.y + dy * aimDir.x;   // + = left, flipped below

  return {
    points,
    carryYd: Math.hypot(cdx, cdy) / YD,
    totalYd: Math.hypot(dx, dy) / YD,
    offlineYd: -offline / YD,                       // + = right of aim line
    apexFt: apex * 3.28084,
    flightTime,
    end: { x: pos.x, y: pos.y },
    endZ: pos.z,
    endSurface: surfaceAt(pos.x, pos.y),
    events,
    isPutt,
    holed,
  };
}

module.exports = { simulateShot, SURFACES, MPH, YD };
