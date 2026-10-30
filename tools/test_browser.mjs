// SPDX-License-Identifier: MIT
// Browser onboarding/update contracts against independent package fixtures and
// simulated Web MIDI. This script never opens a hardware MIDI port.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import {inspectFirmware,firmwareVersion,installationIssue,installPrepared,describeIdentity} from '../web/manager/firmware.mjs';
import {candidatePairs,discoverFM1,connectManager,updaterAccess} from '../web/manager/connect.mjs';
import {Updater,pack7,unpack7} from '../web/manager/vendor/fm1ota.mjs';
import {frame,unframe} from '../web/manager/transport.mjs';
import {put32,encodeProfile} from '../web/manager/format.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const APP=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let checks=0;
function check(value,label){assert(value,label);checks++;}
async function rejects(fn,pattern){await assert.rejects(fn,pattern);checks++;}
function fixture(mode='valid'){
  const run=spawnSync(process.env.PYTHON||'python3',[path.join(APP,'tools/browser_fixture.py'),mode],{maxBuffer:4*1024*1024});
  if(run.status!==0)throw new Error(run.stderr.toString());return new Uint8Array(run.stdout);
}
const bytes=fixture(),prepared=await inspectFirmware(bytes);
check(prepared.product==='FM-1_95010000'&&prepared.version==='1.0.0','versioned GG package is checked');
check(firmwareVersion('FM-1_9500')==='Development build','development identity is not presented as a release');
check(firmwareVersion('FM-1_95000102')==='0.1.2','version decoding');
check(firmwareVersion('FM-1_1200')===null,'another app is not SMSGGDJ');
await rejects(()=>inspectFirmware(new Uint8Array(3)),/complete/);
await rejects(()=>inspectFirmware(new Uint8Array(4*1024*1024+1)),/complete/);
await rejects(()=>inspectFirmware(bytes,{expectedSHA256:'0'.repeat(64)}),/download checksum/);
check((await inspectFirmware(bytes,{expectedSHA256:prepared.sha256})).sha256===prepared.sha256,'pinned download hash accepted');
await rejects(()=>inspectFirmware(bytes.subarray(0,-1)),/header/);
for(const [at,error] of [[0,/header/],[70,/table checksum/],[10000,/checksum failed/]]){
  const damaged=bytes.slice();damaged[at]^=1;await rejects(()=>inspectFirmware(damaged),error);
}
await rejects(()=>inspectFirmware(fixture('other')),/another firmware/);
await rejects(()=>inspectFirmware(fixture('stock')),/verified M-VAVE/);
await rejects(()=>inspectFirmware(fixture('no-loader')),/update loader/);
await rejects(()=>inspectFirmware(fixture('overlap')),/overlap/);
const stock={text:'FM-1_015',model:'FM-1'},gg={text:'FM-1_95010000',model:'FM-1'},open={text:'FM1_OFFICIAL_OPEN',model:'FM-1',open:true},ota={text:'ota-FM-1_95010000',model:'ota-FM-1'};
check(installationIssue(stock,prepared)===null,'stock FM1 can install GG');
check(/stock V15/.test(installationIssue(open,prepared)),'Open firmware needs the verified stock route');
check(installationIssue(open,{kind:'stock'})===null,'Open firmware can restore verified stock');
check(installationIssue(ota,prepared)===null,'loader can resume');
check(/not an FM1/.test(installationIssue({model:'another-device'},prepared)),'wrong device refused');
check(describeIdentity(gg).includes('1.0.0')&&describeIdentity(open).includes('Open'),'readable installed versions');

function identityPacket(text){const raw=new Uint8Array(34);raw.set([0,0x59,0x11]);raw.set(new TextEncoder().encode(text),6);return Uint8Array.from([0xf0,...pack7(raw),0xf7]);}
class Input extends EventTarget{
  constructor(id,name,identity){super();this.id=id;this.name=name;this.identity=identity;this.state='connected';this.manufacturer='FM1 test';this.onmidimessage=null;}
  async open(){}
  emit(data){const event=new Event('midimessage');Object.defineProperty(event,'data',{value:data});this.onmidimessage?.(event);this.dispatchEvent(event);}
}
class Output{
  constructor(id,input){this.id=id;this.name=input.name;this.manufacturer=input.manufacturer;this.state='connected';this.input=input;this.sent=[];}
  async open(){}
  send(data){this.sent.push(data);if(data.length===10&&data[1]===0&&data[2]===0x32&&data[3]===0x45)this.input.emit(identityPacket(this.input.identity));
    const body=unframe(Uint8Array.from(data));if(body?.[1]===1){
      const defaults=JSON.parse(fs.readFileSync(path.join(APP,'web/manager/default-profile.json'))),rom=new Uint8Array(fs.readFileSync(path.join(APP,'rom/smsggdj-v0.48.gg')));
      const payload=new Uint8Array(116);put32(payload,0,0x314a4447);payload[7]=1;payload.set(encodeProfile(defaults,rom),16);
      const answer=new Uint8Array(121);answer.set([1,129,body[2],body[3],0]);answer.set(payload,5);this.input.emit(frame(answer));
    }
  }
}
function accessFor(definitions){const inputs=new Map(),outputs=new Map();for(const [id,name,identity] of definitions){const input=new Input(id,name,identity);inputs.set(id,input);outputs.set(id+'-out',new Output(id+'-out',input));}return {inputs,outputs};}
const access=accessFor([['fm1','TEMPLATE FM-1','FM-1_95010000'],['synth','Unrelated synthesizer','SYNTH_1']]);
check(candidatePairs(access).length===1,'automatic matching leaves unrelated MIDI devices alone');
const found=await discoverFM1(access);
check(found.id.text===gg.text&&found.input.id==='fm1','actual vendored handshake discovers the device');
check(access.outputs.get('synth-out').sent.length===0,'no probe sent to another instrument');
const client=await connectManager(found);check((await client.info()).bootReady,'actual manager handshake follows identity');client.close();
check(await connectManager({...found,id:stock})===null,'stock connects for installation without a failed cartridge request');
const multiple=accessFor([['a','FM1 A','FM-1_9500'],['b','FM1 B','FM-1_015']]);
await rejects(()=>discoverFM1(multiple),/More than one/);
check((await discoverFM1(multiple,{inputId:'b',outputId:'b-out'})).id.text===stock.text,'manual selection works with multiple devices');
check(updaterAccess(access,found)===access,'single FM1 can update alongside unrelated MIDI gear');
assert.throws(()=>updaterAccess(multiple,{input:{id:'a'}}),/Disconnect other/);checks++;
await rejects(()=>discoverFM1({inputs:new Map(),outputs:new Map()}),/not found/);
const unplugged=accessFor([['a','FM1','FM-1_9500']]);unplugged.inputs.get('a').state='disconnected';check(candidatePairs(unplugged).length===0,'unplugged inputs are skipped');
const duplicates=accessFor([['a','FM1','FM-1_9500'],['b','FM1','FM-1_9500']]);check(candidatePairs(duplicates).length===0,'identically named ports are not guessed');

function fakeUpdater(id,{resume=true,back=gg}={}){return {calls:[],async find(){return id?{id,link:{close(){}}}:null;},async install(image,product,step){this.calls.push('install');step('done',product);return product;},async resume(){this.calls.push('resume');return resume;},async waitFor(){return back?{id:back,link:{close(){}}}:null;}};}
let updater=fakeUpdater(stock);check(await installPrepared(access,prepared,{updaterFactory:()=>updater})===gg.text&&updater.calls[0]==='install','validated normal installation is delegated to pinned updater');
updater=fakeUpdater(open);await rejects(()=>installPrepared(access,prepared,{updaterFactory:()=>updater}),/stock V15/);check(updater.calls.length===0,'Open refusal happens before writing');
updater=fakeUpdater(null);await rejects(()=>installPrepared(access,prepared,{updaterFactory:()=>updater}),/not found/);
updater=fakeUpdater(ota);check(await installPrepared(access,prepared,{updaterFactory:()=>updater})===gg.text&&updater.calls[0]==='resume','interrupted loader is resumed then verified');
updater=fakeUpdater(ota,{resume:false});await rejects(()=>installPrepared(access,prepared,{updaterFactory:()=>updater}),/did not finish/);
updater=fakeUpdater(ota,{back:stock});await rejects(()=>installPrepared(access,prepared,{updaterFactory:()=>updater}),/not the selected firmware/);
updater=fakeUpdater(ota,{back:null});await rejects(()=>installPrepared(access,prepared,{updaterFactory:()=>updater}),/has not reconnected/);

function request(addr,count){const raw=new Uint8Array(15);raw.set([0,0x59,0x30,8,0,0,0]);put32(raw,7,addr);raw[11]=count&255;raw[12]=count>>>8;raw[14]=~raw.subarray(6,14).reduce((s,b)=>s+b,0)&255;return [0xf0,...pack7(raw),0xf7];}
const packets=[request(0,8),request(0xe0000000,0)],sent=[];
const link={lost:false,async read(){return packets.shift()||null;},send(packet){sent.push(packet);return true;}};
const served=await new Updater(access).serve(link,Uint8Array.of(0,1,2,3,4,5,6,7),0xe0000000,100,()=>{});
check(served.finished&&served.served===1,'real browser updater serves a complete simulated check');
check(unpack7(sent[0].slice(1,-1)).slice(14,22).join(',')==='0,1,2,3,4,5,6,7','served package bytes match exactly');
await rejects(()=>new Updater(access).serve({async read(){return request(0,513);}},new Uint8Array(1024),0xe0000000,100),/bad request/);
check((await new Updater(access).serve({lost:true,async read(){return null;}},bytes,0xe0000000,100)).lost,'real updater detects a lost cable');

const ids=[...fs.readFileSync(path.join(APP,'web/manager/index.html'),'utf8').matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const references=[...fs.readFileSync(path.join(APP,'web/manager/ui.mjs'),'utf8').matchAll(/\$\("([^"]+)"\)/g)].map(m=>m[1]);
check(new Set(ids).size===ids.length,'HTML IDs are unique');
for(const id of new Set(references))check(ids.includes(id),'UI control exists: '+id);
const out=path.join(APP,'build/browser-validation');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({success:true,checks,physical_usb_verified:false,firmware_writes_simulated:true},null,2)+'\n');
console.log(`PASS browser onboarding: ${checks} checks; package integrity, discovery, MIDI handshake, installation/resume and UI contracts`);
