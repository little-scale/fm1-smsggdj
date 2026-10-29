// SPDX-License-Identifier: MIT
// Execute the actual browser WASM (32-bit ABI) without a browser UI.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const bytes=fs.readFileSync(path.join(app,"build/emu/app.wasm"));
let checks=0;
function check(x,msg){assert(x,msg);checks++;}
async function machine(journal) {
  let mem;
  const wasi=new Proxy({
    clock_time_get:(id,precision,p)=>{new DataView(mem.buffer).setBigUint64(p,process.hrtime.bigint(),true);return 0;},
    fd_write:(fd,iov,n,p)=>{new DataView(mem.buffer).setUint32(p,0,true);return 0;},
    proc_exit:(code)=>{throw new Error("WASM exit "+code);}
  },{get:(o,k)=>o[k]||(()=>0)});
  const {instance}=await WebAssembly.instantiate(bytes,{wasi_snapshot_preview1:wasi,env:new Proxy({},{get:()=>()=>0})});
  const ex=instance.exports;mem=ex.memory;
  ex._initialize?.();ex.gg_web_hold();ex.web_boot();
  if(journal)new Uint8Array(mem.buffer,ex.gg_web_journal(),journal.length).set(journal);
  ex.gg_web_reload();ex.web_master(4096);
  const run=(samples)=>{while(samples){const n=Math.min(1024,samples);ex.web_render(n);samples-=n;}};
  const buttons=m=>{ex.web_buttons(m);run(4410);};
  const tap=m=>{buttons(m);buttons(0);};
  return {ex,mem,run,buttons,tap};
}
const m=await machine();m.run(44100*4);
check((m.ex.gg_web_status()&255)===0,"SONG after boot");
const glo=1<<5,rec=1<<11,arp=1<<8,play=1<<10,edit=1<<4,lfo=1<<3;
m.tap(glo);m.buttons(rec);m.buttons(rec|arp);m.buttons(rec);m.buttons(0);
check((m.ex.gg_web_status()&255)===1,"CHAIN navigation");
m.tap(glo);m.buttons(rec);m.buttons(rec|arp);m.buttons(rec);m.buttons(0);
check((m.ex.gg_web_status()&255)===2,"PHRASE navigation");
m.ex.web_keys(1<<7);m.run(4410);m.ex.web_keys(0);m.run(4410);
check(((m.ex.gg_web_status()>>8)&255)===1,"key enters and advances");
m.tap(play);check(((m.ex.gg_web_status()>>8)&255)===2,"skip forward");
m.tap(edit);check(((m.ex.gg_web_status()>>8)&255)===1,"step back");
m.tap(edit);m.tap(lfo);
check(m.ex.gg_web_first_note()===0&&((m.ex.gg_web_status()>>8)&255)===0,"LFO clears the row and keeps the cursor");
m.buttons(lfo);m.run(22050);
check(((m.ex.gg_web_status()>>8)&255)===0,"held LFO keeps the cursor on the same row");
m.buttons(0);
m.ex.web_keys(1<<7);m.run(4410);m.ex.web_keys(0);m.run(4410);
m.buttons(rec);m.buttons(rec|glo);m.buttons(rec);m.buttons(0);
check((m.ex.gg_web_status()&65536)!==0,"transport starts");
m.run(44100*2);
const left=new Float32Array(m.mem.buffer,m.ex.web_out_l(),1024);
// The most recent block can fall on a rest: capture several blocks.
let peak=0;
for(let k=0;k<100;k++){m.ex.web_render(1024);for(const v of left)peak=Math.max(peak,Math.abs(v));}
check(peak>0.01 && peak<1,"WASM produces unclipped audio");
m.buttons(rec);m.buttons(rec|glo);m.buttons(rec);m.buttons(0);
check((m.ex.gg_web_status()&65536)===0,"transport stops");
check((m.ex.gg_web_status()&131072)===0,"no core fault");
const out=path.join(app,"build/web-validation");fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,"screen.rgb565"),new Uint8Array(m.mem.buffer,m.ex.web_fb(),240*240*2));
// Persist an imported cartridge image and recover it into a new WASM instance.
const sram=new Uint8Array(m.mem.buffer,m.ex.gg_web_sram(),32768);sram[123]=0x55;
check(m.ex.gg_web_import()===1,"stopped import accepted");m.run(44100*3);
check(m.ex.gg_web_generation()>0,"browser cartridge journal committed");
const journal=new Uint8Array(m.mem.buffer,m.ex.gg_web_journal(),m.ex.gg_web_journal_size()).slice();
const m2=await machine(journal);
check(new Uint8Array(m2.mem.buffer,m2.ex.gg_web_sram(),32768)[123]===0x55,"journal survives new WASM instance");
fs.writeFileSync(path.join(out,"result.json"),JSON.stringify({success:true,checks,peak,wasm_bytes:bytes.length,hardware_timing_verified:false},null,2)+"\n");
console.log(`PASS browser WASM: ${checks} checks, ROM navigation, keyboard entry, playback and persistent cartridge restore; peak ${peak.toFixed(4)}`);
