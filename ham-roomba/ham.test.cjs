'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const dgram = require('node:dgram');
const { privateIPv4, tcpProbe, sanitizeDiscovery, discover, safeDiagnostics, readOnly, main } = require('./ham.cjs');

test('accepts only private and loopback IPv4', () => {
  for (const ip of ['192.168.1.99', '10.1.2.3', '172.16.0.1', '172.31.255.255', '127.0.0.1']) assert.equal(privateIPv4(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '169.254.1.1', 'example.com', '::1', '']) assert.equal(privateIPv4(ip), false, ip);
});

test('TCP probe connects to local mock and sends no data', async () => {
  let incoming = 0;
  const server = net.createServer((socket) => { socket.on('data', (data) => { incoming += data.length; }); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { assert.equal(await tcpProbe('127.0.0.1', server.address().port), 'OPEN'); assert.equal(incoming, 0); }
  finally { await new Promise((resolve) => server.close(resolve)); }
});

test('TCP probe handles closed port without crash', async () => {
  const s = net.createServer();
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  const port = s.address().port;
  await new Promise((resolve) => s.close(resolve));
  assert.equal(await tcpProbe('127.0.0.1', port), 'ECONNREFUSED');
});

test('discovery sanitizer never outputs BLID, MAC or raw hostname', () => {
  const raw = Buffer.from(JSON.stringify({hostname:'Roomba-PRIVATEBLID',robotname:'Ham',ip:'192.168.1.99',sku:'i355020',sw:'2.6.0',proto:'mqtt',blid:'SECRET',mac:'SECRET2'}));
  const obj = sanitizeDiscovery(raw,'192.168.1.99');
  assert.deepEqual(obj, {ip:'192.168.1.99',name:'Ham',sku:'i355020',firmware:'2.6.0',protocol:'mqtt'});
  assert.ok(!JSON.stringify(obj).includes('SECRET'));
  assert.ok(!JSON.stringify(obj).includes('PRIVATEBLID'));
  assert.equal(sanitizeDiscovery(Buffer.from('bad-data'), '192.168.1.99'), null);
});

test('UDP discovery sends only expected read-only request', async () => {
  const server = dgram.createSocket('udp4');
  let sentMessage = null;
  server.on('message', (data, peer) => {
    sentMessage = data.toString('ascii');
    const message = Buffer.from(JSON.stringify({hostname:'Roomba-PRIVATEBLID',robotname:'Ham',sku:'i355020',sw:'2.6.0',proto:'mqtt',mac:'SECRET'}));
    server.send(message, peer.port, peer.address);
  });
  await new Promise(resolve => server.bind(0, '127.0.0.1', resolve));
  try {
    const result = await discover('127.0.0.1',{targetPort:server.address().port,bindPort:0,timeoutMs:1500});
    assert.equal(result.status, 'DISCOVERED');
    assert.equal(result.device.name, 'Ham');
    assert.equal(sentMessage, 'irobotmcs');
    assert.ok(!JSON.stringify(result).includes('SECRET'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('diagnostics parse nested firmware 2.x fields without exposing full state', () => {
  assert.deepEqual(safeDiagnostics({batPct:85,cleanMissionStatus:{phase:'charge',error:0,notReady:0},wifistat:{strssi:47,station:1},bbrun:{hr:201,nStuck:6},bin:{full:false},softwareVer:'2.6.0',blid:'SECRET'}),{
    battery_percent:85,phase:'charge',error_code:0,not_ready_code:0,bin_full:false,signal_strength:47,wifi_station:1,total_cleaning_hours:201,stuck_count:6,firmware:'2.6.0'
  });
});

test('readOnly extracts telemetry from fake MQTT client and closes session', async () => {
  const {EventEmitter}=require('node:events');
  let ended=false;
  class FakeLocal extends EventEmitter {
    constructor(){super(); process.nextTick(()=>this.emit('connect'));}
    getRobotState(fields){ assert.deepEqual(fields,['batPct']); return Promise.resolve({batPct:98,cleanMissionStatus:{phase:'charge'}}); }
    end(force){ended=force;}
  }
  const out=await readOnly('127.0.0.1','fake-id','fake-pass',{Local:FakeLocal});
  assert.equal(out.battery_percent,98);
  assert.equal(out.phase,'charge');
  assert.equal(ended,true);
});

test('refuses unrecognized command without networking', async () => {
  const lines=[];
  assert.equal(await main(['--reset'],{},line=>lines.push(line)),2);
  assert.match(lines.join(' '),/Invalid option/);
});

test('refuses public destination without networking', async () => {
  const lines=[];
  assert.equal(await main([],{HAM_IP:'8.8.8.8'},line=>lines.push(line)),2);
  assert.match(lines.join(' '),/non-private/);
});

test('help requires no network or credentials', async () => {
  const lines=[];
  assert.equal(await main(['--help'],{},line=>lines.push(line)),0);
  assert.match(lines.join(' '),/Usage/);
});
