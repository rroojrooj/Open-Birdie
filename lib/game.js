'use strict';
// Round state: current hole, ball position, strokes, scoring, penalties.

const { simulateShot, YD } = require('./physics');
const { makeSurfaceLookup } = require('./course');
const { makeTerrain, flatTerrain } = require('./elevation');

const CLUB_FULL = { // typical full-shot launch presets, used by the practice panel
  DR: { speedMph: 152, vla: 13.0, spin: 2600 },
  W3: { speedMph: 142, vla: 13.5, spin: 3400 },
  H3: { speedMph: 133, vla: 14.5, spin: 4200 },
  I4: { speedMph: 127, vla: 15.0, spin: 4800 },
  I5: { speedMph: 122, vla: 16.5, spin: 5300 },
  I6: { speedMph: 117, vla: 17.5, spin: 6000 },
  I7: { speedMph: 111, vla: 19.0, spin: 7000 },
  I8: { speedMph: 105, vla: 21.0, spin: 7900 },
  I9: { speedMph: 99, vla: 23.0, spin: 8600 },
  PW: { speedMph: 91, vla: 25.5, spin: 9300 },
  SW: { speedMph: 78, vla: 29.0, spin: 10000 },
  LW: { speedMph: 68, vla: 32.0, spin: 10500 },
  PT: { speedMph: 8, vla: 0.5, spin: 100 },
};

class Game {
  constructor() {
    this.course = null;
    this.surfaceAt = null;
    this.settings = { gimmeYd: 8, units: 'yd' }; // gimme in feet? keep yards: 2.7yd ~ 8ft
    this.reset();
  }

  setCourse(course) {
    // Guard BEFORE mutating state: a course with no playable holes makes every
    // state()/handleShot read throw, which would wedge the whole app on a bad
    // load. Reject it so the currently-loaded course stays intact.
    if (!course || !Array.isArray(course.holes) || course.holes.length === 0) {
      throw new Error('Course has no playable holes');
    }
    this.course = course;
    this.surfaceAt = makeSurfaceLookup(course);
    // Physics samples a lightly-smoothed terrain (per D3): real green borrow
    // survives, sub-metre LIDAR scan noise that would jitter putts does not.
    this.terrain = course.elevation
      ? makeTerrain(course.elevation, course.elevation.patches, { smooth: true })
      : flatTerrain();
    this.reset();
  }

  reset() {
    this.holeIndex = 0;
    this.over = false;
    this.scores = this.course ? this.course.holes.map(() => null) : [];
    this.pickedUp = this.course ? this.course.holes.map(() => false) : [];
    this.shotLog = [];
    this._setupHole();
  }

  _setupHole() {
    if (!this.course || !this.course.holes.length) return;
    const h = this.hole;
    this.ball = { x: h.tee[0], y: h.tee[1] };
    this.strokes = 0;
    this.lie = 'tee';
    this.holed = false;
    this.aimOffset = 0; // deg, user adjustment relative to straight-at-pin
  }

  get hole() { return this.course ? this.course.holes[this.holeIndex] : null; }

  get aimDeg() {
    const h = this.hole;
    if (!h) return 0;
    const dx = h.pin[0] - this.ball.x, dy = h.pin[1] - this.ball.y;
    return (Math.atan2(dx, dy) * 180 / Math.PI) + this.aimOffset;
  }

  get distToPinYd() {
    const h = this.hole;
    if (!h) return 0;
    return Math.hypot(h.pin[0] - this.ball.x, h.pin[1] - this.ball.y) / YD;
  }

  /** Handle launch monitor ball data. Returns a shot result for broadcasting. */
  handleShot(ball, clubName) {
    if (!this.course || this.holed || this.over) return null;
    ball = ball || {};
    // Launch monitors stream partial/garbage frames (mid-write reads, sensor
    // glitches). Validate + sanitize so one bad packet can't push NaN into the
    // physics and permanently brick the round; reject implausible ball speed.
    const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const speedMph = fin(ball.Speed);
    if (speedMph === null || speedMph <= 0 || speedMph > 250) {
      console.warn(`[game] ignoring shot — invalid ball speed: ${JSON.stringify(ball.Speed)}`);
      return null;
    }
    const clampN = (v, lo, hi, dflt) => { const n = fin(v); return n === null ? dflt : Math.max(lo, Math.min(hi, n)); };
    const back = fin(ball.BackSpin) ?? 0, side = fin(ball.SideSpin) ?? 0;
    const spinAxis = fin(ball.SpinAxis);
    const launch = {
      speedMph,
      vla: clampN(ball.VLA, 0, 60, 0),
      hla: clampN(ball.HLA, -45, 45, 0),
      totalSpin: clampN(ball.TotalSpin, 0, 15000, Math.min(15000, Math.hypot(back, side))),
      spinAxis: spinAxis !== null ? spinAxis : (back ? Math.atan2(-side, back) * 180 / Math.PI : 0),
    };
    const result = this._play(launch);
    if (result) result.club = clubName || null;   // real club type from the monitor, if known
    return result;
  }

  _play(launch) {
    const h = this.hole;
    const from = { ...this.ball };
    const sim = simulateShot(launch, from, this.aimDeg, this.surfaceAt, {
      terrain: this.terrain,
      pin: { x: h.pin[0], y: h.pin[1] },
    });
    this.strokes++;

    let penalty = 0;
    let note = '';
    let end = sim.end;
    let endSurface = sim.endSurface;

    const water = sim.events.find((e) => e.type === 'water');
    if (water || endSurface === 'water') {
      penalty = 1;
      // red/lateral relief: drop near where the ball crossed the edge
      const cx = water ? water.x : end.x, cy = water ? water.y : end.y;
      end = this._lateralDrop(cx, cy, h.pin, from);
      endSurface = this.surfaceAt(end.x, end.y);
      note = 'Water — lateral drop (+1)';
    } else if (endSurface === 'ob') {
      penalty = 1;
      // drop-and-go: drop where the ball last left the playable area
      let drop = from;
      for (const p of sim.points) {
        if (this.surfaceAt(p.x, p.y) === 'ob') break;
        drop = { x: p.x, y: p.y };
      }
      end = drop;
      endSurface = this.surfaceAt(end.x, end.y);
      note = 'Out of bounds — drop where it left (+1)';
    }

    this.strokes += penalty;
    this.ball = { x: end.x, y: end.y };
    this.lie = endSurface;

    // holed out? real cup capture during the roll, or gimme when stopped close
    const distPinYd = Math.hypot(h.pin[0] - end.x, h.pin[1] - end.y) / YD;
    if (sim.holed && !penalty) {
      this.holed = true;
      this.ball = { x: h.pin[0], y: h.pin[1] };
      note = 'In the hole!';
      this._scoreHole(this.strokes, false);
    } else if (!penalty && distPinYd * 3 <= this.settings.gimmeYd &&
               (sim.isPutt || endSurface === 'green')) {
      this.strokes++; // concede the tap-in
      note = note || `Gimme inside ${this.settings.gimmeYd} ft (+1)`;
      this.holed = true;
      this._scoreHole(this.strokes, false);
    }

    const result = {
      hole: this.holeIndex + 1,
      strokes: this.strokes,
      launch,
      sim: {
        points: sim.points,
        carryYd: +sim.carryYd.toFixed(1),
        totalYd: +sim.totalYd.toFixed(1),
        offlineYd: +sim.offlineYd.toFixed(1),
        apexFt: +sim.apexFt.toFixed(0),
        flightTime: +sim.flightTime.toFixed(2),
        isPutt: sim.isPutt,
        events: sim.events,
      },
      from,
      end: this.ball,
      lie: this.lie,
      distToPinYd: +this.distToPinYd.toFixed(1),
      penalty,
      holed: this.holed,
      note,
    };
    this.shotLog.push({ hole: result.hole, strokes: this.strokes, carry: result.sim.carryYd });
    return result;
  }

  // Red penalty-area relief: nearest dry, in-bounds spot within ~2 club-lengths
  // of where the ball crossed the edge, no nearer the hole. Falls back to
  // back-on-the-line (straight away from the pin), then to replaying from the
  // previous spot — so the ball is never stranded in water/OB.
  _lateralDrop(cx, cy, pin, from) {
    const TWO_CL = 2.3; // ~2 club-lengths, m
    const dPin = Math.hypot(pin[0] - cx, pin[1] - cy) || 1;
    const playable = (x, y) => {
      const s = this.surfaceAt(x, y);
      return s !== 'water' && s !== 'ob';
    };
    for (let r = 0.6; r <= TWO_CL; r += 0.6) {
      for (let a = 0; a < 360; a += 30) {
        const x = cx + Math.cos(a * Math.PI / 180) * r;
        const y = cy + Math.sin(a * Math.PI / 180) * r;
        if (Math.hypot(pin[0] - x, pin[1] - y) >= dPin && playable(x, y)) return { x, y };
      }
    }
    const ux = (cx - pin[0]) / dPin, uy = (cy - pin[1]) / dPin;
    for (let d = 0.6; d <= 60; d += 0.6) {
      const x = cx + ux * d, y = cy + uy * d;
      if (playable(x, y)) return { x, y };
    }
    return from; // last resort: replay from the previous spot (always playable)
  }

  // Record the current hole's score, flag a concession, and end the round if it
  // was the final hole. Single place round-over is decided from a score write —
  // shared by the holed/gimme path in _play and the pick-up/skip path below.
  _scoreHole(strokes, pickedUp) {
    this.scores[this.holeIndex] = strokes;
    this.pickedUp[this.holeIndex] = pickedUp;
    if (this.holeIndex === this.course.holes.length - 1) this.over = true;
  }

  nextHole() {
    if (!this.course || this.over) return;        // round finished: forward is inert
    if (!this.holed) {
      // pick up (hacked it around) -> honest count; skip (never swung) -> "did not play"
      const s = this.strokes > 0 ? this.strokes + 1 : this.hole.par + 2;
      this._scoreHole(s, true);
    }
    if (this.over) return;                         // that was the last hole — don't advance
    this.holeIndex++;
    this._setupHole();
  }

  state() {
    if (!this.course) return { loaded: false };
    const h = this.hole;
    return {
      loaded: true,
      courseName: this.course.name,
      holeCount: this.course.holes.length,
      hole: this.holeIndex + 1,
      par: h.par,
      lengthYd: h.lengthYd,
      ball: this.ball,
      lie: this.lie,
      strokes: this.strokes,
      holed: this.holed,
      aimDeg: +this.aimDeg.toFixed(1),
      aimOffset: this.aimOffset,
      distToPinYd: +this.distToPinYd.toFixed(1),
      pin: h.pin,
      tee: h.tee,
      scores: this.scores,
      pickedUp: this.pickedUp,
      over: this.over,
      pars: this.course.holes.map((x) => x.par),
      settings: this.settings,
    };
  }
}

module.exports = { Game, CLUB_FULL };
