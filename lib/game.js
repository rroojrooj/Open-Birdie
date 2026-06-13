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
    this.course = course;
    this.surfaceAt = makeSurfaceLookup(course);
    this.terrain = course.elevation ? makeTerrain(course.elevation) : flatTerrain();
    this.reset();
  }

  reset() {
    this.holeIndex = 0;
    this.scores = this.course ? this.course.holes.map(() => null) : [];
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
  handleShot(ball) {
    if (!this.course || this.holed) return null;
    const launch = {
      speedMph: ball.Speed,
      vla: ball.VLA,
      hla: ball.HLA,
      totalSpin: ball.TotalSpin || Math.hypot(ball.BackSpin || 0, ball.SideSpin || 0),
      spinAxis: ball.SpinAxis ?? (ball.BackSpin ? Math.atan2(-(ball.SideSpin || 0), ball.BackSpin) * 180 / Math.PI : 0),
    };
    return this._play(launch);
  }

  _play(launch) {
    const h = this.hole;
    const from = { ...this.ball };
    const fromLie = this.lie;
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
      // drop: walk back from water entry toward where the shot started
      const wx = water ? water.x : end.x, wy = water ? water.y : end.y;
      const ddx = from.x - wx, ddy = from.y - wy;
      const dd = Math.hypot(ddx, ddy) || 1;
      let drop = { x: wx + (ddx / dd) * 4, y: wy + (ddy / dd) * 4 };
      if (this.surfaceAt(drop.x, drop.y) === 'water') drop = from; // fallback: replay
      end = drop;
      endSurface = this.surfaceAt(drop.x, drop.y);
      note = 'Water hazard — penalty drop (+1)';
    } else if (endSurface === 'ob') {
      penalty = 1;
      end = from;
      endSurface = fromLie;
      note = 'Out of bounds — replay from previous spot (+1)';
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
      this.scores[this.holeIndex] = this.strokes;
    } else if (!penalty && distPinYd * 3 <= this.settings.gimmeYd &&
               (sim.isPutt || endSurface === 'green')) {
      this.strokes++; // concede the tap-in
      note = note || `Gimme inside ${this.settings.gimmeYd} ft (+1)`;
      this.holed = true;
      this.scores[this.holeIndex] = this.strokes;
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

  nextHole() {
    if (!this.course) return;
    if (!this.holed && this.strokes > 0) this.scores[this.holeIndex] = this.strokes; // pick up
    this.holeIndex = (this.holeIndex + 1) % this.course.holes.length;
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
      pars: this.course.holes.map((x) => x.par),
      settings: this.settings,
    };
  }
}

module.exports = { Game, CLUB_FULL };
