// SPDX-License-Identifier: MIT
import {readSRAM,emptySRAM,editSongs,importSong,exportSong,songName,nameBytes,crc32,prepareROM} from "./format.mjs";
import {Client,MidiTransport,PreviewTransport,OP} from "./transport.mjs";
const $=id=>document.getElementById(id);
let doc=emptySRAM(),label="New cartridge",baseCRC=null,client=null,midi=null,busy=false,replaceSlot=null;
const defaults=fetch("default-profile.json").then(r=>{if(!r.ok)throw new Error("Bundled ROM profile unavailable.");return r.json();});
function message(text,error=false){$("message").textContent=text;$("message").classList.toggle("error",error);}
function download(bytes,name){const url=URL.createObjectURL(new Blob([bytes],{type:"application/octet-stream"})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function refreshButtons(){document.querySelectorAll("button").forEach(b=>{if(b.id!=="cancel")b.disabled=busy||((b.hasAttribute("data-device")||b.id==="disconnect")&&!client);});}
async function task(fn){if(busy)return;busy=true;$("progress").hidden=false;$("progress").value=0;$("cancel").hidden=!client;refreshButtons();try{await fn();}catch(e){message(e.message||String(e),true);}finally{busy=false;$("progress").hidden=true;$("cancel").hidden=true;refreshButtons();}}
function progress(v){$("progress").value=v;}
function change(songs){doc=editSongs(doc,songs);render();}
function render(){
  $("document-status").textContent=`${label} · ${doc.songs.length}/32 songs${doc.dirty?" · unsent edits":""}`;
  $("songs").hidden=!doc.songs.length;$("empty").hidden=!!doc.songs.length;
  const body=$("songs").querySelector("tbody");body.replaceChildren();
  doc.songs.forEach((s,i)=>{
    const tr=document.createElement("tr"),slot=document.createElement("td"),name=document.createElement("td"),size=document.createElement("td"),actions=document.createElement("td");slot.textContent=i.toString(16).toUpperCase().padStart(2,"0");
    const input=document.createElement("input");input.maxLength=8;input.value=songName(s);input.setAttribute("aria-label",`Name for song ${i}`);input.onchange=()=>task(async()=>change(doc.songs.map((x,k)=>k===i?{...x,name:nameBytes(input.value)}:x)));name.append(input);
    size.textContent=`${s.stored} B`;actions.className="actions";
    const button=(text,fn)=>{const b=document.createElement("button");b.textContent=text;b.onclick=()=>task(fn);actions.append(b);return b;};
    button("Export",async()=>download(exportSong(s),songName(s)+".smdj4"));
    button("Replace",async()=>{replaceSlot=i;$("song-file").click();});
    button("↑",async()=>{if(i){const a=doc.songs.slice();[a[i-1],a[i]]=[a[i],a[i-1]];change(a);}}).setAttribute("aria-label",`Move song ${i} up`);
    button("↓",async()=>{if(i+1<doc.songs.length){const a=doc.songs.slice();[a[i+1],a[i]]=[a[i],a[i+1]];change(a);}}).setAttribute("aria-label",`Move song ${i} down`);
    button("Delete",async()=>{if(confirm(`Remove ${songName(s)} from the browser cartridge? The device is unchanged until you send SRAM.`))change(doc.songs.filter((_,k)=>k!==i));});
    tr.append(slot,name,size,actions);body.append(tr);
  });refreshButtons();
}
async function showInfo(){const info=await client.info();$("device-info").textContent=`${info.profile.name} · ${info.bootReady?(info.playing?"playing":"stopped"):"booting"} · SRAM save ${info.generation}`;$("rom-current").textContent=`${info.external?"Uploaded":"Built-in"} · ${info.profile.name} · ${info.profile.bytes/1024} KiB`;return info;}
function connected(c,name){client=c;$("connection-badge").textContent=name;refreshButtons();}
$("enable-midi").onclick=()=>task(async()=>{
  if(!navigator.requestMIDIAccess)throw new Error("Use a browser with Web MIDI and SysEx support, or connect from the browser preview.");
  midi=await navigator.requestMIDIAccess({sysex:true});
  for(const [id,ports]of[["midi-in",midi.inputs],["midi-out",midi.outputs]]){$(id).replaceChildren();for(const p of ports.values()){const o=document.createElement("option");o.value=p.id;o.textContent=p.name||p.id;$(id).append(o);}}
  message("Choose the FM1 input and output, then connect.");
});
$("connect").onclick=()=>task(async()=>{
  if(!midi)throw new Error("Enable USB MIDI first.");const input=midi.inputs.get($("midi-in").value),output=midi.outputs.get($("midi-out").value);
  if(!input||!output)throw new Error("Choose MIDI input and output ports.");
  const c=new Client(new MidiTransport(input,output),progress);try{await c.info();}catch(e){c.close();throw e;}
  client?.close();connected(c,"FM1 USB connected");await showInfo();message("Connected. Stop playback before transferring cartridge data.");
});
$("preview").onclick=()=>task(async()=>{const c=new Client(new PreviewTransport(),progress);await c.info();client?.close();connected(c,"Browser preview connected");await showInfo();message("Connected to the running preview. Transfers use the same cartridge-manager code as the firmware.");});
$("preview").hidden=!(new URLSearchParams(location.search).has("preview")||window.opener?.ggPreviewRequest);
$("disconnect").onclick=()=>{client?.close();client=null;$("connection-badge").textContent="Offline file editor";$("device-info").textContent="No device connected.";refreshButtons();};
$("open-sram").onclick=()=>$("sram-file").click();
$("sram-file").onchange=()=>task(async()=>{const file=$("sram-file").files[0];if(!file)return;if(file.size>32768)throw new Error("SRAM is at most 32 KiB.");const next=readSRAM(new Uint8Array(await file.arrayBuffer()));if(doc.dirty&&!confirm("Replace the browser cartridge and its unsent edits?"))return;doc=next;label=file.name;baseCRC=null;render();message("SRAM opened. The device has not changed.");$("sram-file").value="";});
$("download-sram").onclick=()=>download(doc.bytes,"smsggdj.sav");
$("new-sram").onclick=()=>{if(doc.songs.length&&!confirm("Start an empty browser cartridge? The device is unchanged."))return;doc=emptySRAM();label="New cartridge";baseCRC=null;render();};
$("import-song").onclick=()=>{replaceSlot=null;$("song-file").click();};
$("song-file").onchange=()=>task(async()=>{const file=$("song-file").files[0];if(!file)return;if(file.size>6928)throw new Error("That file is too large for one song.");const song=importSong(new Uint8Array(await file.arrayBuffer()),file.name),a=doc.songs.slice();if(replaceSlot===null)a.push(song);else a[replaceSlot]=song;change(a);$("song-file").value="";replaceSlot=null;message("Song added to the browser cartridge. Download SRAM or send it to the device when ready.");});
$("read-device").onclick=()=>task(async()=>{if(doc.dirty&&!confirm("Replace the browser cartridge and its unsent edits with device SRAM?"))return;const bytes=await client.read();doc=readSRAM(bytes);baseCRC=crc32(bytes);label="Device SRAM";render();await showInfo();message("SRAM read and checksum verified.");});
$("send-device").onclick=()=>task(async()=>{
  const info=await client.info(),expected=baseCRC??info.sramCRC;
  if(!confirm(`Replace all device cartridge SRAM with these ${doc.songs.length} songs and restart the tracker? Unsaved working-song edits on the device will be lost.`))return;
  await client.write(doc.bytes,expected);await client.waitReady();const check=await client.read();
  if(crc32(check)!==crc32(doc.bytes))throw new Error("Write completed, but read-back differs. Read device SRAM before continuing.");
  baseCRC=crc32(check);doc.dirty=false;render();await showInfo();message("SRAM saved and read-back verified. Use FILES → LOAD in the tracker to open a song.");
});
async function selectedROM(){const f=$("rom-file").files[0];if(!f)throw new Error("Choose a Game Gear ROM.");if(f.size>131072)throw new Error("ROM slot capacity is 128 KiB.");const pf=$("profile-file").files[0];if(pf&&pf.size>16384)throw new Error("Profile JSON is too large.");return prepareROM(new Uint8Array(await f.arrayBuffer()),pf?JSON.parse(await pf.text()):null,await defaults);}
$("check-rom").onclick=()=>task(async()=>{const p=await selectedROM();$("rom-check").textContent=`Compatible: ${p.name} · ${p.rom.length/1024} KiB · matching RAM profile`;message("ROM and profile checked. Nothing has been sent.");});
$("upload-rom").onclick=()=>task(async()=>{const p=await selectedROM();if(!confirm(`Upload ${p.name} and restart? Cartridge SRAM is retained. Unsaved working-song edits will be lost.`))return;message("Uploading ROM. Keep the connection open…");await client.replaceROM(p);await client.waitReady();const result=await client.read(1);if(crc32(result)!==crc32(p.rom))throw new Error("ROM read-back mismatch.");await showInfo();message("ROM installed, restarted and read-back verified. Cartridge SRAM retained.");});
$("download-rom").onclick=()=>task(async()=>{const info=await client.info(),bytes=await client.read(1);download(bytes,info.profile.name.replace(/[^a-z0-9_-]/gi,"_")+".gg");message("Current ROM downloaded and checksum verified.");});
$("builtin-rom").onclick=()=>task(async()=>{if(!confirm("Restore the built-in v0.48 ROM and restart? Cartridge SRAM is retained; unsaved working-song edits will be lost."))return;await client.call(OP.BUILTIN);await client.waitReady();await showInfo();message("Built-in ROM restored. Cartridge SRAM retained.");});
$("cancel").onclick=()=>{client?.cancel();message("Cancelling after the current block…");};
render();
