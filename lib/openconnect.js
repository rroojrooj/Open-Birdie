'use strict';
// GSPro Open Connect v1 server. Uneekor VIEW -> GSPconnect normally sends
// shot data to GSPro on TCP 921 as JSON; we listen on that port and speak
// the same protocol, so GSPconnect feeds shots to us instead.

const net = require('net');
const EventEmitter = require('events');

class OpenConnectServer extends EventEmitter {
  constructor(port = 921) {
    super();
    this.port = port;
    this.clients = new Set();
    this.player = { Handed: 'RH', Club: 'DR', DistanceToTarget: 0 };
    this.server = net.createServer((sock) => this._onClient(sock));
    this.server.on('error', (err) => this.emit('error', err));
  }

  start() {
    this.server.listen(this.port, () => this.emit('listening', this.port));
  }

  _onClient(sock) {
    sock.setNoDelay(true);
    this.clients.add(sock);
    this.emit('connected', sock.remoteAddress);
    let buf = '';

    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      // Messages are bare JSON objects, possibly concatenated. Split by
      // brace depth (string-aware).
      let depth = 0, startIdx = -1, inStr = false, esc = false;
      for (let i = 0; i < buf.length; i++) {
        const c = buf[i];
        if (esc) { esc = false; continue; }
        if (inStr) {
          if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') { inStr = true; continue; }
        if (c === '{') { if (depth === 0) startIdx = i; depth++; }
        else if (c === '}') {
          depth--;
          if (depth === 0 && startIdx >= 0) {
            const raw = buf.slice(startIdx, i + 1);
            try { this._onMessage(sock, JSON.parse(raw)); }
            catch (e) { this._send(sock, { Code: 501, Message: 'Bad JSON: ' + e.message }); }
            buf = buf.slice(i + 1);
            i = -1; startIdx = -1;
          }
        }
      }
      if (buf.length > 65536) buf = ''; // safety: drop runaway garbage
    });

    const drop = () => {
      this.clients.delete(sock);
      this.emit('disconnected');
    };
    sock.on('close', drop);
    sock.on('error', drop);

    // Greet with player info like GSPro does
    this.sendPlayerInfo(sock);
  }

  _onMessage(sock, msg) {
    const opts = msg.ShotDataOptions || {};
    if (opts.IsHeartBeat) {
      this._send(sock, { Code: 200, Message: 'Heartbeat OK' });
      this.emit('heartbeat', msg);
      return;
    }
    if (opts.ContainsBallData && msg.BallData) {
      this._send(sock, { Code: 200, Message: 'Shot received successfully' });
      this.emit('shot', {
        shotNumber: msg.ShotNumber,
        device: msg.DeviceID,
        units: msg.Units || 'Yards',
        ball: msg.BallData,   // Speed mph, SpinAxis, TotalSpin, BackSpin, SideSpin, HLA, VLA
        club: opts.ContainsClubData ? msg.ClubData : null,
        clubName: msg.ClubName || null,   // club TYPE from the bridge (e.g. "DRIVER")
      });
      return;
    }
    // status-only message (monitor ready / ball detected)
    this._send(sock, { Code: 200, Message: 'OK' });
    this.emit('status', {
      ready: !!opts.LaunchMonitorIsReady,
      ballDetected: !!opts.LaunchMonitorBallDetected,
    });
  }

  _send(sock, obj) {
    try { sock.write(JSON.stringify(obj)); } catch (_) { /* client gone */ }
  }

  sendPlayerInfo(sock) {
    const msg = { Code: 201, Message: 'GSPro Player Information', Player: this.player };
    if (sock) this._send(sock, msg);
    else for (const s of this.clients) this._send(s, msg);
  }

  setPlayer(patch) {
    Object.assign(this.player, patch);
    this.sendPlayerInfo();
  }

  get clientCount() { return this.clients.size; }
}

module.exports = { OpenConnectServer };
