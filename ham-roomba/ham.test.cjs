'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net=require('node:net');
const {privateIPv4,probe,main}=require('./ham.cjs');
test('only private IPv4 destinations allowed',()=>{
  assert.equal(privateIPv4('192.168.1.99'),true);
  assert.equal(privateIPv4('10.0.0.3'),true);
  assert.equal(privateIPv4('172.31.0.3'),true);
  assert.equal(privateIPv4('8.8.8.8'),false);
  assert.equal(privateIPv4('example.com'),false);
});
test('TCP probe detects a local mock server',async()=>{
  let bytes=0;
  const server=net.createServer(s=>s.on('data',b=>bytes+=b.length));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{assert.equal(await probe('127.0.0.1',server.address().port),'OPEN');assert.equal(bytes,0);}
  finally{await new Promise(r=>server.close(r));}
});
test('invalid destination rejected before any connection',async()=>{
  const messages=[];
  const code=await main([],{HAM_IP:'8.8.8.8'},x=>messages.push(x));
  assert.equal(code,2);
  assert.match(messages.join(' '),/Only private/);
});
test('help is non-invasive',async()=>{
  const messages=[];
  const code=await main(['--help'],{},x=>messages.push(x));
  assert.equal(code,0);
  assert.match(messages.join(' '),/--read/);
});
