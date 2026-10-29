// SPDX-License-Identifier: MIT
import S from "./vendor/smdj4.mjs";
export const SRAM_SIZE=32768, SONG_SIZE=6912;
export function crc32(bytes) {
  let c=0xffffffff;
  for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^(0xedb88320&-(c&1));}
  return (~c)>>>0;
}
export function u16(b,o=0){return b[o]|(b[o+1]<<8);}
export function u32(b,o=0){return (b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0;}
export function put16(b,o,v){b[o]=v;b[o+1]=v>>>8;}
export function put32(b,o,v){put16(b,o,v);put16(b,o+2,v>>>16);}
const magic=(b,s)=>[...s].every((c,i)=>b[i]===c.charCodeAt(0));
export function cleanName(text){return String(text).toUpperCase().replace(/[^ A-Z0-9\-_.!?#:+=*/@()<>]/g,"").slice(0,8);}
export function nameBytes(text){const b=new Uint8Array(8);b.fill(32);[...cleanName(text)].forEach((c,i)=>b[i]=c.charCodeAt(0));return b;}
export function songName(song){return String.fromCharCode(...song.name).replace(/\0/g,"").trim()||"UNTITLED";}
function decodeRLE(b){
  const out=new Uint8Array(SONG_SIZE);let p=0,k=0;
  while(p<b.length){
    const c=b[p++],units=(c&127)+(c&128?2:1),size=units*4;
    if(k+size>SONG_SIZE)throw new Error("Song RLE expands past 6,912 bytes.");
    if(c&128){
      if(p+4>b.length)throw new Error("Truncated repeat run.");
      for(let r=0;r<units;r++)out.set(b.subarray(p,p+4),k+r*4);p+=4;
    }else{if(p+size>b.length)throw new Error("Truncated literal run.");out.set(b.subarray(p,p+size),k);p+=size;}
    k+=size;
  }
  if(k!==SONG_SIZE)throw new Error("Song does not expand to 6,912 bytes.");return out;
}
export function readSRAM(input){
  const b=new Uint8Array(input).slice();
  if(![8192,16384,32768].includes(b.length))throw new Error("SRAM must be an 8, 16 or 32 KiB .sav/.srm image.");
  const cfg=S.cfgOff(b.length),config=b.slice(cfg,Math.min(cfg+160,b.length));
  const doc={bytes:b,songs:[],config,header:b.slice(7,32),dirty:false};
  if(!magic(b,"SMDJ4")){
    if(b.every((v,i)=>(i>=cfg&&i<cfg+160)||v===0||v===255))return normalize(doc);
    throw new Error("Expected SMDJ4 cartridge data. Convert older SRAM formats with the SMSGGDJ migration tool first.");
  }
  if(b[5]!==1||b[6]!==32)throw new Error("Unsupported SMDJ4 header version or directory size.");
  const ranges=[];
  for(let slot=0;slot<32;slot++){
    const e=32+slot*32;if(b[e]!==0xa5)continue;
    if(b[e+1]>1)throw new Error(`Song ${slot}: invalid storage flag.`);
    const start=1056+u16(b,e+2),size=u16(b,e+4),end=start+size;
    if(!size||start<1056||end>b.length||(start<16384&&end>cfg)||(start>=16384&&end>32768))
      throw new Error(`Song ${slot}: blob crosses a bank, configuration area or SRAM boundary.`);
    if(ranges.some(([a,z])=>start<z&&end>a))throw new Error(`Song ${slot}: overlapping song blobs.`);
    ranges.push([start,end]);
    const blob=b.subarray(start,end),block=b[e+1]?blob.slice():decodeRLE(blob);
    if(block.length!==SONG_SIZE||S.checksum(block)!==u16(b,e+6))throw new Error(`Song ${slot}: checksum or size mismatch.`);
    doc.songs.push({block,echo:b.slice(e+8,e+16),name:b.slice(e+16,e+24),reserved:b.slice(e+24,e+32),stored:size,slot});
  }
  // Existing 32 KiB data remains byte-identical until explicitly edited.
  return b.length===32768?doc:normalize(doc);
}
function normalize(doc){return {...doc,bytes:assemble(doc,doc.songs),dirty:doc.bytes.length!==32768};}
export function assemble(doc,songs){
  if(songs.length>32)throw new Error("The cartridge can hold at most 32 songs.");
  const b=S.buildSav(songs,32);
  b.set(doc.config.subarray(0,160),0x3f60);
  if(doc.header.length===25)b.set(doc.header,7);
  songs.forEach((s,i)=>{if(s.reserved)b.set(s.reserved.subarray(0,8),32+i*32+24);});
  return b;
}
export function editSongs(doc,songs){const bytes=assemble(doc,songs);return {...readSRAM(bytes),dirty:true};}
export function emptySRAM(){return readSRAM(S.buildSav([],32));}
export function importSong(input,filename="UNTITLED.smdj4"){
  const b=new Uint8Array(input);let block;
  if(magic(b,"SMDJ4")&&b.length===16+SONG_SIZE)block=b.slice(16);
  else if(magic(b,"SMDJ3")&&b.length===5392){const old=b.slice(16);if(S.checksum(old)!==u16(b,5))throw new Error("SMDJ3 song checksum mismatch.");block=S.expand(old);}
  else throw new Error("Expected one .smdj4 song or a legacy SMDJ3 .smdj song.");
  if(magic(b,"SMDJ4")&&S.checksum(block)!==u16(b,5))throw new Error("Song checksum mismatch.");
  return {block,echo:b.slice(7,15),name:nameBytes(filename.replace(/\.[^.]+$/,"")),reserved:new Uint8Array(8)};
}
export function exportSong(song){return S.wrapSmdj4(song.block,song.echo);}

export const SYMBOLS=["editor_input","engine_frame","scr_mode","ed_track","cur_chain","cur_phrase","cur_instr","phr_row","phr_col","last_note","last_instr","phrase_pool","song_edited","dirty_rows","sel_active","dt1_timer","tp_dt","play_state","pad_raw","pad_prev","pad_edge","pad_rep","das_timer","key_delay","key_speed"];
export function decodeProfile(b){
  if(b.length!==100||u32(b)!==0x31504747||u32(b,96)!==crc32(b.subarray(0,96)))throw new Error("Invalid ROM profile.");
  const symbols={};SYMBOLS.forEach((k,i)=>symbols[k]=u16(b,16+i*2));
  return {bytes:u32(b,4),crc32:u32(b,8),code_crc32:u32(b,12),symbols,phrases:u16(b,66),midi_low:b[68],midi_high:b[69],instruments:b[70],name:new TextDecoder().decode(b.subarray(72,96)).replace(/\0.*$/s,""),save_format:"SMDJ4"};
}
export function encodeProfile(p,rom){
  const b=new Uint8Array(100);put32(b,0,0x31504747);put32(b,4,rom.length);put32(b,8,crc32(rom));put32(b,12,crc32(rom.subarray(0,32768)));
  SYMBOLS.forEach((k,i)=>{const a=p.symbols?.[k];if(!Number.isInteger(a)||(i<2?(a<0||a>=16384):(a<0xc000||a>=0xe000)))throw new Error(`Invalid RAM profile address: ${k}`);put16(b,16+i*2,a);});
  const phrases=p.phrases??52,lo=p.midi_low??45,hi=p.midi_high??155,ins=p.instruments??16;
  if(!Number.isInteger(phrases)||phrases<1||phrases>128||p.symbols.phrase_pool+phrases*64>0xe000||p.symbols.dirty_rows+16>0xe000
    ||![lo,hi,ins].every(Number.isInteger)||lo<0||hi>255||lo>hi||hi-lo>=254||ins<1||ins>16||p.symbols.editor_input===p.symbols.engine_frame)throw new Error("Incompatible ROM profile limits.");
  put16(b,66,phrases);b[68]=lo;b[69]=hi;b[70]=ins;
  b.set(new TextEncoder().encode((p.name||`SMSGGDJ ${p.version||"CUSTOM"}`).replace(/[^\x20-\x7e]/g,"").slice(0,23)),72);
  put32(b,96,crc32(b.subarray(0,96)));return b;
}
export async function prepareROM(input,manifest,defaultProfile){
  const rom=new Uint8Array(input);
  if(rom.length<32768||rom.length>131072||(rom.length&16383))throw new Error("ROM must be a Game Gear .gg file, 32–128 KiB in 16 KiB steps.");
  if(!magic(rom.subarray(0x7ff0),"TMR SEGA")||rom[0x7fff]>>4<5||rom[0x7fff]>>4>7)throw new Error("Game Gear ROM header not found.");
  let profile=manifest;
  if(profile){
    if(profile.save_format&&profile.save_format!=="SMDJ4")throw new Error("This manager supports SMDJ4 songs.");
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",rom)),v=>v.toString(16).padStart(2,"0")).join("");
    if(profile.sha256!==hash)throw new Error("Profile SHA-256 does not match this ROM.");
  }else{
    if(rom.length!==defaultProfile.bytes||crc32(rom.subarray(0,32768))!==defaultProfile.code_crc32)throw new Error("This ROM needs its matching build-profile JSON. Sample-bank replacements with unchanged v0.48 code are recognised automatically.");
    profile=defaultProfile;
  }
  return {rom,profile:encodeProfile(profile,rom),name:profile.name||`SMSGGDJ ${profile.version||"CUSTOM"}`};
}
