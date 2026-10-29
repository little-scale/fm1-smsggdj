// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {fileURLToPath} from "node:url";
import S from "../web/manager/vendor/smdj4.mjs";
import {readSRAM,editSongs,emptySRAM,nameBytes,songName,exportSong,importSong,crc32,put16,prepareROM,decodeProfile,encodeProfile} from "../web/manager/format.mjs";
import {pack7,unpack7,frame,unframe} from "../web/manager/transport.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const APP=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
let checks=0,state=0x7044;
function check(x,msg){assert(x,msg);checks++;}
function rejects(fn,msg){assert.throws(fn,msg);checks++;}
function rng(){state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;}
function song(i,random=false){const block=new Uint8Array(6912);if(random)for(let k=0;k<block.length;k++)block[k]=rng()&255;else block[256]=16+i;return {block,name:nameBytes("SONG "+i),echo:Uint8Array.from({length:8},(_,k)=>i+k),reserved:new Uint8Array(8).fill(i)};}
let doc=emptySRAM();check(doc.bytes.length===32768&&doc.songs.length===0,"empty cartridge");
const a=song(0),b=song(1),config=new Uint8Array(160);for(let i=0;i<160;i++)config[i]=rng()&255;
doc={...doc,config};doc=editSongs(doc,[a,b]);
check(doc.songs.length===2,"two songs");check(songName(doc.songs[1])==="SONG 1","names");
check(Buffer.from(doc.bytes.subarray(0x3f60,0x4000)).equals(Buffer.from(config)),"all config bytes preserved, including v3 key-repeat fields");
check(Buffer.from(readSRAM(doc.bytes).bytes).equals(Buffer.from(doc.bytes)),"unedited 32 KiB SRAM export is byte identical");
let moved=editSongs(doc,[doc.songs[1],doc.songs[0]]);check(moved.songs[0].block[256]===17,"reorder keeps song data");
check(moved.songs[0].reserved.every(v=>v===1),"reserved directory bytes preserved");
moved=editSongs(moved,[{...moved.songs[0],name:nameBytes("RENAMED")}]);check(songName(moved.songs[0])==="RENAMED","rename/delete");
check(Buffer.from(importSong(exportSong(a),"C4.smdj4").block).equals(Buffer.from(a.block)),"standard single-song file roundtrip");
const corrupt=exportSong(a);corrupt[20]^=1;rejects(()=>importSong(corrupt),/checksum/);
rejects(()=>importSong(new Uint8Array(3)),/Expected/);
const legacy=new Uint8Array(5392);legacy.set(new TextEncoder().encode("SMDJ3"));legacy[16+256]=19;put16(legacy,5,19);
check(importSong(legacy,"LEGACY.smdj").block[256]===19,"legacy single-song conversion");legacy[5]^=1;rejects(()=>importSong(legacy),/checksum/);
for(const size of [8,16]){const raw=S.buildSav([a],size);raw.set(config,S.cfgOff(raw.length));const expanded=readSRAM(raw);check(expanded.bytes.length===32768&&expanded.songs[0].block[256]===16,"small SRAM expands");check(Buffer.from(expanded.bytes.subarray(0x3f60,0x4000)).equals(Buffer.from(config)),"small SRAM config relocates");}
const randomSongs=Array.from({length:4},(_,i)=>song(i,true)),full=editSongs(emptySRAM(),randomSongs);
check(full.songs.every(s=>s.stored===6912),"random data uses store-raw fallback");
for(let i=0;i<4;i++)check(Buffer.from(full.songs[i].block).equals(Buffer.from(randomSongs[i].block)),"raw data roundtrip");
rejects(()=>editSongs(full,[...randomSongs,song(5,true)]),/SRAM FULL/);
check(editSongs(emptySRAM(),Array.from({length:32},(_,i)=>song(i))).songs.length===32,"32 compressed songs");
rejects(()=>editSongs(emptySRAM(),Array.from({length:33},(_,i)=>song(i))),/at most 32/);
for(const length of [0,1,8191,32769])rejects(()=>readSRAM(new Uint8Array(length)),/SRAM must/);
let bad=doc.bytes.slice();bad[5]=9;rejects(()=>readSRAM(bad),/header/);
bad=doc.bytes.slice();put16(bad,32+4,1);bad[1056]=128;rejects(()=>readSRAM(bad),/Truncated/);
bad=doc.bytes.slice();put16(bad,32+2,0xffff);rejects(()=>readSRAM(bad),/boundary/);
bad=doc.bytes.slice();bad[32+6]^=1;rejects(()=>readSRAM(bad),/checksum/);
bad=doc.bytes.slice();bad.set(bad.subarray(34,38),66);rejects(()=>readSRAM(bad),/overlapping/);
for(let i=0;i<80;i++){
  const data=song(i,i%2===0),encoded=editSongs(emptySRAM(),[data]);
  check(Buffer.from(encoded.songs[0].block).equals(Buffer.from(data.block)),"RLE/raw property roundtrip");
  const bin=Uint8Array.from({length:i*3+1},()=>rng()&255);check(Buffer.from(unpack7(pack7(bin))).equals(Buffer.from(bin)),"pack7 all byte values");
}
const body=Uint8Array.from({length:264},()=>rng()&255),packet=frame(body);check(Buffer.from(unframe(packet)).equals(Buffer.from(body)),"maximum SysEx body roundtrip");
const wrong=packet.slice();wrong[10]^=1;check(unframe(wrong)===null,"damaged SysEx is rejected");
const rom=new Uint8Array(fs.readFileSync(path.join(APP,"rom/smsggdj-v0.48.gg"))),defaults=JSON.parse(fs.readFileSync(path.join(APP,"web/manager/default-profile.json")));
const prepared=await prepareROM(rom,null,defaults);check(decodeProfile(prepared.profile).symbols.phr_row===defaults.symbols.phr_row,"default ROM profile");
const sample=rom.slice();sample[0x9000]^=1;check((await prepareROM(sample,null,defaults)).rom[0x9000]===sample[0x9000],"sample-bank replacement auto recognised");
const changed=rom.slice(),version=Buffer.from(changed).indexOf("V0.48");check(version>=0&&version<32768,"version string in protected code area");changed[version+4]=57;
await assert.rejects(()=>prepareROM(changed,null,defaults),/matching build-profile/);checks++;
const manifest={...defaults,name:"SMSGGDJ TEST",sha256:Buffer.from(await crypto.subtle.digest("SHA-256",changed)).toString("hex")};
check(decodeProfile((await prepareROM(changed,manifest,defaults)).profile).name==="SMSGGDJ TEST","changed code requires matching build profile");
await assert.rejects(()=>prepareROM(sample,defaults,defaults),/SHA-256/);checks++;
rejects(()=>encodeProfile({...defaults,symbols:{...defaults.symbols,phr_row:0x50000}},rom),/address/);
const real=path.join(APP,"build/manager-validation/rom-saved.sav");
if(fs.existsSync(real)){const bytes=new Uint8Array(fs.readFileSync(real)),d=readSRAM(bytes);check(d.songs.length===1&&d.songs[0].block[256]===16,"actual ROM-written compressed save");check(Buffer.from(d.bytes).equals(Buffer.from(bytes)),"actual ROM save stays byte-identical");}
const out=path.join(APP,"build/format-validation");fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,"result.json"),JSON.stringify({success:true,checks,seed:"0x7044"},null,2)+"\n");
console.log(`PASS formats: ${checks} checks; SMDJ4 files, raw/RLE, config preservation, legacy songs, bounds, profiles and SysEx`);
