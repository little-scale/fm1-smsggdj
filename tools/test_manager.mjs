// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {machine,APP} from "./wasm_machine.mjs";
import {Client,OP,frame,unframe,unpack7} from "../web/manager/transport.mjs";
import {crc32,readSRAM,editSongs,exportSong,importSong,nameBytes,prepareROM,put32,put16} from "../web/manager/format.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const out=path.join(APP,"build/manager-validation");fs.mkdirSync(out,{recursive:true});
let checks=0;function check(v,msg){assert(v,msg);checks++;}
const m=await machine();
const missing=new Client({exchange:async req=>m.rpc(req)});
await assert.rejects(()=>missing.read(),e=>e.code===10);checks++;
m.run(44100*4);
const glo=1<<5,rec=1<<11,arp=1<<8,home=1<<6,down=1<<7;
function nav(key){m.buttons(rec);m.buttons(rec|key);m.buttons(rec);m.buttons(0);}
m.tap(glo);nav(arp);m.tap(glo);nav(arp);m.ex.web_keys(1<<7);m.run(4410);m.ex.web_keys(0);m.run(4410);
nav(home);nav(home);nav(down);nav(glo);m.tap(glo);m.run(15000);m.tap(glo);m.run(44100*2);
let lostChunk=false,lostCommit=false;
const client=new Client({exchange:async req=>{
  m.run(256);const reply=m.rpc(req);
  if(req[1]===OP.WRITE&&!lostChunk&&reply[4]===0){lostChunk=true;throw new Error("Simulated lost chunk ACK");}
  if(req[1]===OP.COMMIT&&!lostCommit&&reply[4]===0){lostCommit=true;throw new Error("Simulated lost commit ACK");}
  return reply;
}});
const original=await client.read(),doc=readSRAM(original);
check(doc.songs.length===1,"ROM-produced SMDJ4 parses as one song");
check(doc.songs[0].block[256]===16,"ROM-produced song contains entered C4");
fs.writeFileSync(path.join(out,"rom-saved.sav"),original);
fs.writeFileSync(path.join(out,"rom-song.smdj4"),exportSong(doc.songs[0]));
check(importSong(exportSong(doc.songs[0])).block[256]===16,"single-song native wrapper roundtrips");
const edited=editSongs(doc,[{...doc.songs[0],name:nameBytes("FROM WEB")}, {...doc.songs[0],name:nameBytes("SECOND")}]);
const generationBefore=(await client.info()).generation;
await client.write(edited.bytes,crc32(original));m.run(44100*4);
check(lostChunk&&lostCommit,"lost ACK retries were exercised");
check((await client.info()).generation===generationBefore+1,"commit retry does not create a second save");
check(crc32(await client.read())===crc32(edited.bytes),"read-back matches edited SRAM");
const fresh=await machine(m.storageBytes());fresh.run(44100*4);
const freshClient=new Client({exchange:async req=>fresh.rpc(req)});
check(readSRAM(await freshClient.read()).songs.length===2,"songs survive new WASM instance");
// Original ROM loads and plays the song written by the browser codec.
nav(down);nav(glo);m.tap(down);m.tap(glo);m.run(15000);m.tap(glo);m.run(44100);
check(m.ex.gg_web_first_note()===16,"original ROM loads the browser-written song into working RAM");
nav(1<<1);nav(glo);
let audioPeak=0;
for(let k=0;k<128;k++){m.ex.web_render(1024);for(const v of new Float32Array(m.mem.buffer,m.ex.web_out_l(),1024))audioPeak=Math.max(audioPeak,Math.abs(v));}
check(audioPeak>0.01&&audioPeak<1,"browser-written song plays audible unclipped audio in original ROM");
nav(glo);
const stale=(await client.info()).sramCRC;
new Uint8Array(m.mem.buffer,m.ex.gg_web_sram(),32768)[0x3ff0]^=1;
await assert.rejects(()=>client.write(edited.bytes,stale),e=>e.code===7);checks++;
// An abandoned transfer releases the emulator after its timeout.
await client.call(OP.READ_BEGIN,Uint8Array.of(0));check((await client.info()).busy!==0,"read lease acquired");
m.run(44100*6);check((await client.info()).busy===0,"expired read releases emulation");
// Real USB envelope parser -> C reply encoder -> JS checksum/pack7 parser.
const body=Uint8Array.of(1,OP.INFO,0x34,0x12),wire=frame(body),decoded=unpack7(wire.subarray(1,-1));
new Uint8Array(m.mem.buffer,m.ex.gg_web_request_ptr(),decoded.length).set(decoded);
const replyN=m.ex.gg_web_usb_run(decoded.length),replyWire=new Uint8Array(m.mem.buffer,m.ex.gg_web_answer_ptr(),replyN).slice();
const answer=unframe(replyWire);check(answer?.[1]===(OP.INFO|128)&&answer[2]===0x34,"actual C USB envelope roundtrip");
decoded[decoded.length-1]^=1;new Uint8Array(m.mem.buffer,m.ex.gg_web_request_ptr(),decoded.length).set(decoded);check(m.ex.gg_web_usb_run(decoded.length)===0,"bad envelope checksum rejected");
const rom=new Uint8Array(fs.readFileSync(path.join(APP,"rom/smsggdj-v0.48.gg"))),defaults=JSON.parse(fs.readFileSync(path.join(APP,"web/manager/default-profile.json")));
const modified=rom.slice();modified[0x9000]^=1;
const prepared=await prepareROM(modified,null,defaults);
await client.replaceROM(prepared);m.run(44100*4);
check((await client.info()).external,"ROM upload selects external slot");
check(crc32(await client.read(1))===crc32(modified),"ROM read-back matches upload");
const savedStorage=m.storageBytes(),reboot=await machine(savedStorage);reboot.run(44100*4);
const rebootClient=new Client({exchange:async q=>reboot.rpc(q)});
check((await rebootClient.info()).external,"uploaded ROM survives new WASM instance");
// Incomplete update: persisted metadata was invalidated, builtin fallback boots.
await client.call(OP.ROM_BEGIN,prepared.profile);
const q=new Uint8Array(260);put32(q,0,0);q.set(modified.subarray(0,256),4);await client.call(OP.ROM_WRITE,q);
const interrupted=await machine(m.storageBytes());interrupted.run(44100*4);
const interruptedClient=new Client({exchange:async q=>interrupted.rpc(q)});
check(!(await interruptedClient.info()).external,"interrupted upload falls back to builtin ROM");
check(readSRAM(await interruptedClient.read()).songs.length===2,"interrupted ROM upload retains SRAM");
await client.call(OP.ABORT);m.run(44100*4);
// Bad final CRC is rejected before ROM metadata can be committed.
const bad={...prepared,rom:prepared.rom.slice()};bad.rom[0x9100]^=1;
await assert.rejects(()=>client.replaceROM(bad),e=>e.code===5);checks++;
m.run(44100*4);check(!(await client.info()).external,"CRC failure leaves builtin fallback active");
await client.replaceROM(prepared);m.run(44100*4);await client.call(OP.BUILTIN);m.run(44100*4);
check(!(await client.info()).external,"restore builtin works");
check(readSRAM(await client.read()).songs.length===2,"restore builtin retains SRAM");
fs.writeFileSync(path.join(out,"result.json"),JSON.stringify({success:true,checks,rom_upload_bytes:rom.length,lost_ack_retries:true,interrupted_rom_fallback:true,hardware_usb_verified:false},null,2)+"\n");
console.log(`PASS manager: ${checks} checks; native song/SRAM, USB framing, lost ACKs, ROM replacement and interrupted-upload recovery`);
