#!/usr/bin/env node
'use strict';
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const host = process.env.HAM_IP || '192.168.1.99';
const port = 8883;
function privateIPv4(ip) {
  if (net.isIP(ip) !== 4) return false;
  const p=ip.split('.').map(Number);
  return p[0]===10 || p[0]===127 || p[0]===192&&p[1]===168 || p[0]===172&&p[1]>=16&&p[1]<=31;
}
function probe(ip, p=port) {
  return new Promise(resolve=>{
    let done=false;
    const sock=net.connect({host:ip,port:p});
    const finish=(status)=>{if(done)return;done=true;sock.destroy();resolve(status);};
    sock.once('connect',()=>finish('OPEN'));
    sock.once('error',e=>finish(e.code||'ERROR'));
    sock.setTimeout(5000,()=>finish('TIMEOUT'));
  });
}
function loadLibrary() {
  try{return require('dorita980');}
  catch {
    const root=execFileSync('npm',['root','-g'],{encoding:'utf8',timeout:3000}).trim();
    return require(path.join(root,'dorita980'));
  }
}
function readWithTimeout(fn) {
  return Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>setTimeout(()=>reject(Error('timeout')),6000))]);
}
async function readOnly(ip,blid,password) {
  const {Local}=loadLibrary();
  const bot=new Local(blid,password,ip);
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('connection timeout')),10000);
      bot.once('connect',()=>{clearTimeout(timer);resolve();});
      bot.once('error',()=>{clearTimeout(timer);reject(Error('connection error'));});
    });
    const output={};
    const getters={
      battery:()=>bot.getRobotState(['batPct']),
      mission:()=>bot.getBasicMission(),
      wifi:()=>bot.getWirelessStatus(),
      runtime:()=>bot.getBbrun(),
      system:()=>bot.getSys()
    };
    for (const [name,get] of Object.entries(getters)) {
      try {
        const val=await readWithTimeout(get);
        const v=val?.ok||val||{};
        if(name==='battery') output.battery_percent=v.batPct??null;
        if(name==='mission') { output.cleaning_phase=v.cleanMissionStatus?.phase??null;output.error_code=v.cleanMissionStatus?.error??null; }
        if(name==='wifi') output.wifi_connected=v.wifistat?.wifi??null;
        if(name==='runtime') {output.stuck_count=v.nStuck??null;output.cleaning_hours=v.hr??null;}
        if(name==='system') output.software_version=v.softwareVer??null;
      } catch {output[name]='unavailable';}
    }
    return output;
  } finally {try{bot.end();}catch{}}
}
async function main(args=process.argv.slice(2),env=process.env,output=console.log){
  if(args.includes('--help')){output('node ham.cjs [--read]; optional HAM_IP, HAM_BLID and HAM_PASSWORD environment variables');return 0;}
  if(args.some(a=>a!=='--read')){output('Unknown argument');return 2;}
  const ip=env.HAM_IP||'192.168.1.99';
  if(!privateIPv4(ip)){output('Only private IPv4 addresses supported. Stopping.');return 2;}
  const status=await probe(ip);
  output('Roomba TCP '+ip+':8883 — '+status);
  if(status!=='OPEN'){output('Stopping. No pairing, reset or settings changes attempted.');return 1;}
  if(!args.includes('--read')) {output('Connectivity check complete. No MQTT commands sent.');return 0;}
  if(!env.HAM_BLID||!env.HAM_PASSWORD){output('Local credentials not provided. Stopping without pairing.');return 2;}
  try{output(JSON.stringify(await readOnly(ip,env.HAM_BLID,env.HAM_PASSWORD),null,2));return 0;}
  catch{output('Read-only status unavailable. No configuration changed.');return 1;}
}
module.exports={privateIPv4,probe,main};
if(require.main===module)main().then(code=>{process.exitCode=code;});
