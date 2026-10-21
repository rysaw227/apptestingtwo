#!/usr/bin/env node
'use strict';

// Read-only local network diagnostics for an already-configured Roomba i3+.
// NO pairing, Wi-Fi settings, motion, cleaning, reset, or firmware commands.
// This program cannot reach a private Wi-Fi network from GitHub/Codex cloud.

const net = require('node:net');
const dgram = require('node:dgram');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const DEFAULT_IP = '192.168.1.99'; // Previously observed; can change after reconnecting.
const MQTT_PORT = 8883;
const DISCOVERY_PORT = 5678;

function privateIPv4(ip) {
  if (net.isIP(ip) !== 4) return false;
  const p = ip.split('.').map(Number);
  return p[0] === 10 || p[0] === 127 ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31);
}

function tcpProbe(ip, port = MQTT_PORT, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const socket = net.createConnection({ host: ip, port });
    const finish = (status) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(status);
    };
    socket.once('connect', () => finish('OPEN'));
    socket.once('error', (e) => finish(e.code || 'CONNECTION_ERROR'));
    socket.setTimeout(timeoutMs, () => finish('TIMEOUT'));
  });
}

function str(value, maxLength = 80) {
  return typeof value === 'string' ? value.slice(0, maxLength) : undefined;
}

// Do not emit hostname/BLID, MAC, account secrets, or raw packets.
function sanitizeDiscovery(packet, senderIp) {
  let data;
  try { data = JSON.parse(packet.toString('utf8')); } catch { return null; }
  if (!data || typeof data !== 'object' || !/^(Roomba|iRobot)-/i.test(data.hostname || '')) return null;
  return {
    ip: senderIp,
    name: str(data.robotname),
    sku: str(data.sku),
    firmware: str(data.sw),
    protocol: str(data.proto)
  };
}

// Sends ONLY iRobot's 9-byte discovery query on UDP 5678. No pairing or state changes.
function discover(ip, { targetPort = DISCOVERY_PORT, bindPort = DISCOVERY_PORT, timeoutMs = 3500 } = {}) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      resolve(result);
    };
    socket.once('error', (err) => finish({ status: err.code || 'UDP_ERROR' }));
    socket.on('message', (packet, peer) => {
      if (peer.address !== ip) return;
      const device = sanitizeDiscovery(packet, peer.address);
      if (device) finish({ status: 'DISCOVERED', device });
    });
    timer = setTimeout(() => finish({ status: 'NO_RESPONSE' }), timeoutMs);
    try {
      socket.bind(bindPort, () => {
        socket.send(Buffer.from('irobotmcs', 'ascii'), targetPort, ip, (err) => {
          if (err) finish({ status: err.code || 'SEND_ERROR' });
        });
      });
    } catch (err) { finish({ status: err.code || 'UDP_ERROR' }); }
  });
}

function loadDorita980() {
  try { return require('dorita980'); } catch {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 3000 }).trim();
    return require(path.join(root, 'dorita980'));
  }
}

function withTimeout(promise, milliseconds = 7500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Timed out waiting for status')), milliseconds);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function onlyFinite(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function safeDiagnostics(state) {
  const s = state && typeof state === 'object' ? state : {};
  const mission = s.cleanMissionStatus || {};
  const wifi = s.wifistat || {};
  const runtime = s.bbrun || {};
  const bin = s.bin || {};
  return {
    battery_percent: onlyFinite(s.batPct),
    phase: str(mission.phase),
    error_code: onlyFinite(mission.error),
    not_ready_code: onlyFinite(mission.notReady),
    bin_full: typeof bin.full === 'boolean' ? bin.full : null,
    signal_strength: onlyFinite(wifi.strssi),
    wifi_station: onlyFinite(wifi.station),
    total_cleaning_hours: onlyFinite(runtime.hr),
    stuck_count: onlyFinite(runtime.nStuck),
    firmware: str(s.softwareVer)
  };
}

async function readOnly(ip, blid, password, lib = loadDorita980()) {
  // MQTT may temporarily displace the iRobot mobile app: one connection at a time.
  const client = new lib.Local(blid, password, ip);
  try {
    await withTimeout(new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('error', () => reject(Error('MQTT authentication or connection failed')));
      client.once('close', () => reject(Error('MQTT disconnected before connecting')));
    }), 9000);
    const state = await withTimeout(client.getRobotState(['batPct']), 9000);
    return safeDiagnostics(state); // Never output raw telemetry or secrets.
  } finally {
    try { client.end(true); } catch {}
  }
}

async function main(args = process.argv.slice(2), env = process.env, output = console.log) {
  if (args.length === 1 && args[0] === '--help') {
    output('Usage: node ham.cjs [--discover | --read]');
    output('Optional: HAM_IP=<private IPv4>, HAM_BLID, HAM_PASSWORD (only for --read)');
    return 0;
  }
  if (args.length > 1 || args.some(x => !['--discover', '--read'].includes(x))) {
    output('Invalid option; use --help.');
    return 2;
  }
  const ip = env.HAM_IP || DEFAULT_IP;
  if (!privateIPv4(ip)) {
    output('Refusing to contact a non-private IPv4 address.');
    return 2;
  }
  if (args[0] === '--discover') {
    const result = await discover(ip);
    output(JSON.stringify(result, null, 2));
    return result.status === 'DISCOVERED' ? 0 : 1;
  }
  const status = await tcpProbe(ip);
  output('Ham TCP ' + ip + ':' + MQTT_PORT + ': ' + status);
  if (status !== 'OPEN') {
    output('Stopped. Did not attempt pairing or change any settings.');
    return 1;
  }
  if (args[0] !== '--read') {
    output('Connectivity confirmed. No authenticated commands sent.');
    return 0;
  }
  if (!env.HAM_BLID || !env.HAM_PASSWORD) {
    output('No local credentials supplied: skipping authenticated read; pairing NOT attempted.');
    return 2;
  }
  try {
    const data = await readOnly(ip, env.HAM_BLID, env.HAM_PASSWORD);
    output(JSON.stringify(data, null, 2));
    return 0;
  } catch (err) {
    output('Read-only diagnostics unavailable: ' + (err?.message || 'unknown error'));
    return 1;
  }
}

module.exports = { privateIPv4, tcpProbe, sanitizeDiscovery, discover, safeDiagnostics, readOnly, main };
if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, () => { process.exitCode = 1; });
}
