'use strict';
// Pretends to be GSPconnect: sends GSPro Open Connect shot JSON over TCP 921.
// Usage:
//   node tools/test-shot.js driver|3w|7i|pw|chip|putt
//   node tools/test-shot.js --speed 150 --vla 13 --hla 1.5 --spin 2700 --axis -4
const net = require('net');

const PRESETS = {
  driver: { Speed: 152, VLA: 13.2, HLA: 0.8, TotalSpin: 2650, SpinAxis: -2.5 },
  '3w': { Speed: 142, VLA: 13.5, HLA: -0.5, TotalSpin: 3400, SpinAxis: 1.5 },
  '7i': { Speed: 111, VLA: 19.2, HLA: 0.4, TotalSpin: 7000, SpinAxis: -1 },
  pw: { Speed: 91, VLA: 25.5, HLA: 0, TotalSpin: 9300, SpinAxis: 0 },
  chip: { Speed: 35, VLA: 22, HLA: 0, TotalSpin: 4500, SpinAxis: 0 },
  putt: { Speed: 6.5, VLA: 0.5, HLA: 0, TotalSpin: 80, SpinAxis: 0 },
};

const args = process.argv.slice(2);
let ball = PRESETS[args[0]] || null;
if (!ball) {
  ball = { Speed: 150, VLA: 13, HLA: 0, TotalSpin: 2700, SpinAxis: 0 };
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i].replace('--', ''), v = parseFloat(args[i + 1]);
    if (k === 'speed') ball.Speed = v;
    if (k === 'vla') ball.VLA = v;
    if (k === 'hla') ball.HLA = v;
    if (k === 'spin') ball.TotalSpin = v;
    if (k === 'axis') ball.SpinAxis = v;
  }
}

const msg = {
  DeviceID: 'TestShot CLI',
  Units: 'Yards',
  ShotNumber: 1,
  APIversion: '1',
  BallData: { ...ball, BackSpin: ball.TotalSpin, SideSpin: 0, CarryDistance: 0 },
  ClubData: null,
  ShotDataOptions: {
    ContainsBallData: true,
    ContainsClubData: false,
    LaunchMonitorIsReady: true,
    LaunchMonitorBallDetected: true,
    IsHeartBeat: false,
  },
};

const sock = net.connect(+(process.env.BIRDIE_OC_PORT || 921), '127.0.0.1', () => {
  console.log('connected, sending:', JSON.stringify(ball));
  sock.write(JSON.stringify(msg));
});
sock.on('data', (d) => {
  console.log('server replied:', d.toString());
  setTimeout(() => sock.end(), 300);
});
sock.on('error', (e) => { console.error('FAIL:', e.message); process.exit(1); });
sock.on('close', () => process.exit(0));
