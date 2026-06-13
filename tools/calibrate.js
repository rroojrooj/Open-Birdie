'use strict';
// Flight-model calibration against PGA Tour ball-flight averages.
// Run: npm run calibrate
const { simulateShot } = require('../lib/physics');

const CASES = [
  // name, ball mph, VLA, spin rpm, target carry yd, target apex ft
  ['Driver (tour)', 167, 10.9, 2686, 275, 96],
  ['3-wood (tour)', 158, 9.2, 3655, 243, 89],
  ['5-iron (tour)', 132, 12.1, 5361, 194, 90],
  ['7-iron (tour)', 120, 16.3, 7097, 172, 95],
  ['PW (tour)', 102, 24.2, 9304, 136, 91],
  ['Driver (am 95mph)', 140, 12.5, 2900, null, null],
];

const fairway = () => 'fairway';

console.log('club                 carry   (tgt)   total   apex ft (tgt)   time   offline');
for (const [name, mph, vla, spin, tgtCarry, tgtApex] of CASES) {
  const r = simulateShot({ speedMph: mph, vla, hla: 0, totalSpin: spin, spinAxis: 0 }, { x: 0, y: 0 }, 0, fairway);
  const flag = tgtCarry && Math.abs(r.carryYd - tgtCarry) / tgtCarry > 0.05 ? '  <-- OFF' : '';
  console.log(
    `${name.padEnd(20)} ${r.carryYd.toFixed(0).padStart(5)}  (${String(tgtCarry ?? '—').padStart(4)})  ${r.totalYd.toFixed(0).padStart(5)}   ${r.apexFt.toFixed(0).padStart(5)}  (${String(tgtApex ?? '—').padStart(3)})   ${r.flightTime.toFixed(1).padStart(4)}s  ${r.offlineYd.toFixed(1).padStart(6)}${flag}`
  );
}

// shape checks: signs must behave like GSPro conventions
console.log('\nshape checks:');
const draw = simulateShot({ speedMph: 167, vla: 10.9, hla: 0, totalSpin: 2686, spinAxis: -12 }, { x: 0, y: 0 }, 0, fairway);
const fade = simulateShot({ speedMph: 167, vla: 10.9, hla: 0, totalSpin: 2686, spinAxis: 12 }, { x: 0, y: 0 }, 0, fairway);
const push = simulateShot({ speedMph: 167, vla: 10.9, hla: 5, totalSpin: 2686, spinAxis: 0 }, { x: 0, y: 0 }, 0, fairway);
console.log(`  spinAxis -12 (draw): offline ${draw.offlineYd.toFixed(1)} yd  ${draw.offlineYd < -3 ? 'OK (left)' : 'WRONG'}`);
console.log(`  spinAxis +12 (fade): offline ${fade.offlineYd.toFixed(1)} yd  ${fade.offlineYd > 3 ? 'OK (right)' : 'WRONG'}`);
console.log(`  HLA +5 (push):       offline ${push.offlineYd.toFixed(1)} yd  ${push.offlineYd > 10 ? 'OK (right)' : 'WRONG'}`);

// slope check: putt on a tilted plane must break downhill
const tilt = { flat: false, h: (x, y) => 0.03 * x, grad: () => ({ dx: 0.03, dy: 0 }) }; // 3% right-to-left... +x rises
const putt = simulateShot({ speedMph: 4.5, vla: 0.5, hla: 0, totalSpin: 60, spinAxis: 0 }, { x: 0, y: 0 }, 0, () => 'green', { terrain: tilt });
console.log(`  putt on 3% cross-slope (high side right): offline ${putt.offlineYd.toFixed(2)} yd  ${putt.offlineYd < -0.2 ? 'OK (breaks left)' : 'WRONG'}`);
const uphill = { flat: false, h: (x, y) => 0.05 * y, grad: () => ({ dx: 0, dy: 0.05 }) };
const pUp = simulateShot({ speedMph: 4.5, vla: 0.5, hla: 0, totalSpin: 60, spinAxis: 0 }, { x: 0, y: 0 }, 0, () => 'green', { terrain: uphill });
const pFlat = simulateShot({ speedMph: 4.5, vla: 0.5, hla: 0, totalSpin: 60, spinAxis: 0 }, { x: 0, y: 0 }, 0, () => 'green');
console.log(`  putt 4.5mph flat: ${(pFlat.totalYd * 3).toFixed(1)} ft, up 5% slope: ${(pUp.totalYd * 3).toFixed(1)} ft  ${pUp.totalYd < pFlat.totalYd * 0.8 ? 'OK (shorter uphill)' : 'WRONG'}`);
