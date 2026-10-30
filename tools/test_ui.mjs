// SPDX-License-Identifier: MIT
// Exercise actual page handlers against a small DOM adapter and simulated MIDI.
// No browser, hardware device, firmware build or network request is required.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import {Updater,pack7} from '../web/manager/vendor/fm1ota.mjs';
import {frame,unframe} from '../web/manager/transport.mjs';
import {emptySRAM,encodeProfile,put32,crc32,u32,u16} from '../web/manager/format.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const APP=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(path.join(APP,'web/manager/index.html'),'utf8');
let checks=0;const check=(v,label)=>{assert(v,label);checks++;};
const nodes=new Map(),all=[],downloads=[],blobs=new Map();
class Element{
  constructor(tag,attrs={}){this.tag=tag;this.attrs=attrs;this.id=attrs.id||'';this.value='';this.children=[];this.textContent='';this.hidden='hidden' in attrs;this.disabled='disabled' in attrs;this.checked='checked' in attrs;this.open='open' in attrs;this.files=[];this.classList={toggle(){}};all.push(this);}
  hasAttribute(name){return name in this.attrs;}
  setAttribute(name,value){this.attrs[name]=value;}
  append(...children){this.children.push(...children);if(this.tag==='select'&&!this.value&&children[0])this.value=children[0].value;}
  replaceChildren(...children){this.children=[];if(this.tag==='select')this.value='';this.append(...children);}
  querySelector(selector){if(selector==='tbody')return this.body??=new Element('tbody');throw new Error(selector);}
  click(){if(this.download)downloads.push({name:this.download,blob:blobs.get(this.href)});else this.onclick?.();}
}
for(const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
  const attrs={id:match[3]};for(const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[attr[1]]=attr[2]??'';
  nodes.set(match[3],new Element(match[1],attrs));
}
globalThis.document={getElementById:id=>{assert(nodes.has(id),'Missing DOM node '+id);return nodes.get(id);},createElement:tag=>new Element(tag),querySelectorAll:selector=>all.filter(e=>selector.split(',').includes(e.tag))};
const unloadHandlers=[];
globalThis.window={isSecureContext:true,opener:null,addEventListener:(name,fn)=>{if(name==='beforeunload')unloadHandlers.push(fn);}};
globalThis.location={href:'http://127.0.0.1:8765/manager/',origin:'http://127.0.0.1:8765',search:''};
URL.createObjectURL=blob=>{const id='blob:test-'+blobs.size;blobs.set(id,blob);return id;};URL.revokeObjectURL=()=>{};
let answerConfirmation=false;
globalThis.confirm=()=>answerConfirmation;
globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(APP,'web/manager',url),'utf8'))});
const sram=emptySRAM().bytes;
const defaults=JSON.parse(fs.readFileSync(path.join(APP,'web/manager/default-profile.json')));
const rom=new Uint8Array(fs.readFileSync(path.join(APP,'rom/smsggdj-v0.48.gg')));
const sent=[];
class Input extends EventTarget{
  constructor(){super();this.id='in';this.name='TEMPLATE FM-1';this.state='connected';this.identity='FM-1_015';}
  async open(){}
  emit(data){const event=new Event('midimessage');Object.defineProperty(event,'data',{value:data});this.onmidimessage?.(event);this.dispatchEvent(event);}
}
const input=new Input(),output={id:'out',name:input.name,state:'connected',async open(){},send(data){
  sent.push(Uint8Array.from(data));
  if(data.length===10&&data[1]===0&&data[2]===0x32&&data[3]===0x45){const raw=new Uint8Array(34);raw.set([0,0x59,0x11]);raw.set(new TextEncoder().encode(input.identity),6);input.emit(Uint8Array.from([0xf0,...pack7(raw),0xf7]));return;}
  const request=unframe(Uint8Array.from(data));if(!request)return;
  const op=request[1];let payload;
  if(op===1){payload=new Uint8Array(116);put32(payload,0,0x314a4447);payload[7]=1;put32(payload,8,crc32(sram));payload.set(encodeProfile(defaults,rom),16);}
  else if(op===2){payload=new Uint8Array(8);put32(payload,0,sram.length);put32(payload,4,crc32(sram));}
  else if(op===3){const offset=u32(request,4),size=u16(request,8);payload=new Uint8Array(size+4);put32(payload,0,offset);payload.set(sram.subarray(offset,offset+size),4);}
  else if(op===4||op===11)payload=new Uint8Array();
  else if(op===13){payload=new Uint8Array(20);[12345,37,0,740,0].forEach((v,i)=>put32(payload,i*4,v));}
  else throw new Error('Unexpected device write in UI test: '+op);
  const reply=new Uint8Array(payload.length+5);reply.set([1,op|128,request[2],request[3],0]);reply.set(payload,5);input.emit(frame(reply));
}};
const midi=new EventTarget();midi.inputs=new Map([['in',input]]);midi.outputs=new Map([['out',output]]);
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Simulated test browser',async requestMIDIAccess(options){check(options.sysex===true,'SysEx permission explicitly requested');return midi;}}});
await import('../web/manager/ui.mjs');await new Promise(r=>setTimeout(r,0));
const $=id=>nodes.get(id);
check(!$('connect').disabled&&$('read-device').disabled,'offline editing starts without a device');
check($('release-status').textContent.includes('not published'),'no firmware download falsely advertised');
await $('connect').onclick();
check($('installed-firmware').textContent.includes('stock V15'),'one-click connection identifies stock firmware');
check($('read-device').disabled,'song transfer disabled for stock firmware');
input.identity='FM-1_9400';await $('connect').onclick();
check($('installed-firmware').textContent==='RNBO Player · FM-1_9400','RNBO identity is named and displayed once');
check($('read-device').disabled,'song transfer disabled for RNBO firmware');
input.identity='FM-1_9600';await $('connect').onclick();
check($('installed-firmware').textContent==='Other FM1 firmware · FM-1_9600','unknown firmware identifier is displayed once');
const fixture=spawnSync(process.env.PYTHON||'python3',[path.join(APP,'tools/browser_fixture.py')],{maxBuffer:4*1024*1024});assert.equal(fixture.status,0,fixture.stderr.toString());
const raw=Uint8Array.from(fixture.stdout);
$('firmware-file').files=[{name:'test.fwsc',size:raw.length,arrayBuffer:async()=>raw.slice().buffer}];
await $('firmware-file').onchange();
check(!$('firmware-install').disabled&&$('firmware-check').textContent.includes('1.0.0'),'valid file enables explicit install');
let installs=0;
const originalInstall=Updater.prototype.install;
Updater.prototype.install=async function(image,product,step){installs++;check(product==='FM-1_95010000','selected identity passed to installer');input.identity=product;step('done',product);return product;};
try{
  await $('firmware-install').onclick();check(installs===0,'declining confirmation never starts installation');
  answerConfirmation=true;await $('firmware-install').onclick();
  check(installs===1&&!$('read-device').disabled,'explicit installation reconnects cartridge manager automatically');
  check($('installed-firmware').textContent.includes('1.0.0'),'new installed version shown');
  await $('read-device').onclick();check($('document-status').textContent.includes('Device SRAM'),'SRAM read handler uses real client and checksum');
  await $('download-report').onclick();
  let report=JSON.parse(await downloads.at(-1).blob.text());
  check(report.cpu_percent===37&&report.audio_overruns===0&&!('songs' in report),'diagnostic download contains counters and no songs');
  $('backup-before-install').checked=true;
  const before=downloads.length;await $('firmware-install').onclick();
  check(installs===2&&downloads.length===before+1&&downloads.at(-1).name.endsWith('.sav'),'SRAM backup downloads before an update');
  check(Buffer.from(await downloads.at(-1).blob.arrayBuffer()).equals(Buffer.from(sram)),'downloaded pre-update backup exactly matches device SRAM');
  answerConfirmation=false;const writeCount=sent.filter(p=>unframe(p)?.[1]===5).length;
  await $('send-device').onclick();check(sent.filter(p=>unframe(p)?.[1]===5).length===writeCount,'declining SRAM replacement sends no write request');
  const status=$('document-status').textContent;input.state='disconnected';midi.dispatchEvent(new Event('statechange'));
  check($('read-device').disabled&&$('document-status').textContent===status,'unplugging disables transfers and retains browser cartridge');
  const writes=sent.filter(p=>p[0]===0xf0&&p[1]===0x22);
  check(writes.length===0,'tests never sent a real update-entry command');
}finally{Updater.prototype.install=originalInstall;}
const out=path.join(APP,'build/browser-validation');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'ui-result.json'),JSON.stringify({success:true,checks,simulated_dom_and_midi:true,visual_browser_verified:false,hardware_usb_verified:false},null,2)+'\n');
console.log(`PASS page flows: ${checks} checks; connect, identify, validate, confirm, install, reconnect, backup, diagnostics and unplug`);
