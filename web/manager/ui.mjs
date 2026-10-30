// SPDX-License-Identifier: MIT
import {readSRAM,emptySRAM,editSongs,importSong,exportSong,songName,nameBytes,crc32,prepareROM,u32} from "./format.mjs";
import {Client,MidiTransport,PreviewTransport,OP} from "./transport.mjs";
import {discoverFM1,connectManager,updaterAccess} from "./connect.mjs";
import {describeIdentity,inspectFirmware,installationIssue,installPrepared} from "./firmware.mjs";
import {Updater} from "./vendor/fm1ota.mjs";
import {validateRelease} from "./release.mjs";
const $=id=>document.getElementById(id);
let doc=emptySRAM(),label="New cartridge",baseCRC=null,client=null,midi=null,busy=false,replaceSlot=null,device=null,preparedFirmware=null,writingFirmware=false,availableRelease=null;
let defaults;
function loadDefaults(){return defaults??=fetch("default-profile.json").then(r=>{if(!r.ok)throw new Error("Bundled ROM profile unavailable.");return r.json();});}
function message(text,error=false){$("message").textContent=text;$("message").classList.toggle("error",error);}
function download(bytes,name){const url=URL.createObjectURL(new Blob([bytes],{type:"application/octet-stream"})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function refreshButtons(){
  document.querySelectorAll("button").forEach(b=>{
    if(b.id==="cancel")return;
    b.disabled=busy||(b.hasAttribute("data-device")&&!client);
    if(b.id==="disconnect")b.disabled=busy||(!client&&!device);
    if(b.id==="firmware-install")b.disabled=busy||!device||!preparedFirmware||!!installationIssue(device?.id,preparedFirmware);
    if(b.id==="get-release")b.disabled=busy||!availableRelease;
  });
  document.querySelectorAll("input,select").forEach(e=>{e.disabled=busy;});
  $("cancel").hidden=!busy||!client||writingFirmware;
  $("backup-option").hidden=!client||!device;
}
async function task(fn){if(busy)return;busy=true;$("progress").hidden=false;$("progress").value=0;$("cancel").hidden=!client||writingFirmware;refreshButtons();try{await fn();}catch(e){message(e.message||String(e),true);}finally{busy=false;$("progress").hidden=true;$("cancel").hidden=true;refreshButtons();}}
function progress(v){$("progress").value=v;}
function change(songs){doc=editSongs(doc,songs);render();}
function chooseSong(slot=null){replaceSlot=slot;$("song-file").value="";$("song-file").click();}
function render(){
  $("document-status").textContent=`${label} · ${doc.songs.length}/32 songs${doc.dirty?" · unsent edits":""}`;
  $("songs").hidden=!doc.songs.length;$("empty").hidden=!!doc.songs.length;
  const body=$("songs").querySelector("tbody");body.replaceChildren();
  doc.songs.forEach((s,i)=>{
    const tr=document.createElement("tr"),slot=document.createElement("td"),name=document.createElement("td"),size=document.createElement("td"),actions=document.createElement("td");slot.textContent=i.toString(16).toUpperCase().padStart(2,"0");
    const input=document.createElement("input");input.maxLength=8;input.value=songName(s);input.setAttribute("aria-label",`Name for song ${i}`);input.onchange=()=>task(async()=>change(doc.songs.map((x,k)=>k===i?{...x,name:nameBytes(input.value)}:x)));name.append(input);
    size.textContent=`${s.stored} B`;actions.className="actions";
    // Open file pickers synchronously: task() disables inputs during work.
    const button=(text,fn,{picker=false}={})=>{const b=document.createElement("button");b.textContent=text;b.onclick=picker?fn:()=>task(fn);actions.append(b);return b;};
    button("Export",async()=>download(exportSong(s),songName(s)+".smdj4"));
    button("Replace",()=>chooseSong(i),{picker:true});
    button("↑",async()=>{if(i){const a=doc.songs.slice();[a[i-1],a[i]]=[a[i],a[i-1]];change(a);}}).setAttribute("aria-label",`Move song ${i} up`);
    button("↓",async()=>{if(i+1<doc.songs.length){const a=doc.songs.slice();[a[i+1],a[i]]=[a[i],a[i+1]];change(a);}}).setAttribute("aria-label",`Move song ${i} down`);
    button("Delete",async()=>{if(confirm(`Remove ${songName(s)} from the browser cartridge? The device is unchanged until you send SRAM.`))change(doc.songs.filter((_,k)=>k!==i));});
    tr.append(slot,name,size,actions);body.append(tr);
  });refreshButtons();
}
async function showInfo(){
  const info=await client.info();
  $("device-info").textContent=`${info.profile.name} · ${info.bootReady?(info.playing?"playing":"stopped"):"booting"} · SRAM save ${info.generation}`;
  $("rom-current").textContent=`${info.external?"Uploaded":"Built-in"} · ${info.profile.name} · ${info.profile.bytes/1024} KiB`;
  return info;
}
function connected(c,name){client=c;$("connection-badge").textContent=name;refreshButtons();}
function disconnect(){
  client?.close();client=null;device=null;
  $("connection-badge").textContent="Offline file editor";
  $("device-info").textContent="No device connected. Your browser cartridge is still here.";
  $("installed-firmware").textContent="Connect the FM1 to identify its installed firmware.";
  $("rom-current").textContent="Not connected";refreshButtons();
}
function ports(){
  if(!midi)return;
  for(const [id,list] of [["midi-in",midi.inputs],["midi-out",midi.outputs]]){
    const previous=$(id).value;$(id).replaceChildren();
    for(const port of list.values())if(port.state!=="disconnected"){
      const option=document.createElement("option");option.value=port.id;option.textContent=port.name||port.id;$(id).append(option);
    }
    if([...list.values()].some(p=>p.id===previous&&p.state!=="disconnected"))$(id).value=previous;
  }
}
async function enableMidi(){
  if(midi)return midi;
  if(!navigator.requestMIDIAccess||window.isSecureContext===false)throw new Error("Open this page in Chrome or Edge over HTTPS, or use Manager-GGDJ.command to open it locally.");
  try{midi=await navigator.requestMIDIAccess({sysex:true});}
  catch(error){throw new Error("MIDI/SysEx permission was not allowed. Allow MIDI access in your browser’s site settings, then connect again.");}
  midi.addEventListener("statechange",()=>{
    ports();
    if(!writingFirmware&&device&&(device.input.state==="disconnected"||device.output.state==="disconnected")){
      disconnect();message("FM1 disconnected. Reconnect its USB data cable and click Connect FM1.");
    }
  });
  ports();return midi;
}
async function connectDevice(manual=false){
  await enableMidi();
  const next=await discoverFM1(midi,manual?{inputId:$("midi-in").value,outputId:$("midi-out").value}:{});
  client?.close();client=null;device=next;
  $("midi-in").value=next.input.id;$("midi-out").value=next.output.id;
  $("installed-firmware").textContent=`${describeIdentity(next.id)} · ${next.id.text}`;
  $("device-info").textContent=`${describeIdentity(next.id)} · ${next.name}`;
  let managerError=null;
  try{client=await connectManager(next,progress);}catch(error){managerError=error;}
  connected(client,client?"FM1 USB connected":"FM1 detected");
  $("firmware-section").open=!client;
  if(client){await showInfo();message("Connected. Read from FM1 to back up or edit saved songs. Stop playback before cartridge transfers.");}
  else if(managerError)message("SMSGGDJ was detected but its cartridge manager did not answer. Install a current firmware file to enable song transfers.",true);
  else message(next.id.open?"M-VAVE Open firmware detected. See Help & recovery to restore stock V15 before installing SMSGGDJ.":/^ota-/i.test(next.id.model)?"FM1 is in update mode. Choose the same firmware file below to finish installing.":"FM1 detected. Choose an SMSGGDJ firmware file below to install the tracker.");
  if(preparedFirmware){const issue=installationIssue(next.id,preparedFirmware);if(issue)$("firmware-check").textContent=issue;}
  refreshButtons();
}
$("connect").onclick=()=>task(()=>connectDevice());
$("connect-manual").onclick=()=>task(()=>connectDevice(true));
$("preview").onclick=()=>task(async()=>{
  const c=new Client(new PreviewTransport(),progress);try{await c.info();}catch(error){c.close();throw error;}
  client?.close();device=null;connected(c,"Browser preview connected");await showInfo();
  $("installed-firmware").textContent="Browser preview · firmware installation needs a physical FM1.";
  message("Connected to the running preview. Transfers use the same cartridge-manager code as the firmware.");
});
function hasPreviewOpener(){try{return !!window.opener?.ggPreviewRequest;}catch{return false;}}
$("preview").hidden=!(new URLSearchParams(location.search).has("preview")||hasPreviewOpener());
$("disconnect").onclick=()=>{disconnect();message("Disconnected. Browser files and edits are retained.");};
async function firmwareSelected(bytes,name,expectedSHA256){
  const prepared=await inspectFirmware(bytes,{expectedSHA256});
  const releaseVersion=prepared.sha256===availableRelease?.sha256&&prepared.product===availableRelease.product?availableRelease.version:null;
  preparedFirmware={...prepared,fileName:name,releaseVersion};
  const issue=device?installationIssue(device.id,prepared):null;
  $("firmware-check").textContent=issue||`Checked: ${prepared.kind==="stock"?"M-VAVE stock":"SMSGGDJ"} · ${releaseVersion||prepared.version} · ${(bytes.length/1024).toFixed(0)} KiB`;
  message(issue||"Firmware file checked. Connect the FM1 and click Install selected firmware when ready.",!!issue);
  refreshButtons();
}
$("firmware-file").onchange=()=>task(async()=>{
  preparedFirmware=null;$("firmware-check").textContent="Checking the selected firmware…";
  const file=$("firmware-file").files[0];if(!file)return;
  if(file.size>4*1024*1024)throw new Error("Firmware package is too large (maximum 4 MiB).");
  try{await firmwareSelected(new Uint8Array(await file.arrayBuffer()),file.name);}
  catch(error){$("firmware-check").textContent="The selected firmware file could not be validated.";throw error;}
});
function firmwareStep(step,value){
  const text={start:"Starting firmware update…",verify:"Checking the package on your FM1…",loader:"Connecting to the update loader…",write:"Writing firmware. Keep USB and power connected…",reboot:"Restarting your FM1…",done:"Firmware installed and device identity verified."}[step]||step;
  $("firmware-log").textContent+=`${step}${value===undefined?"":" "+value}\n`;
  if(step==="verify")progress(Math.min(.1,(value||0)/740));
  else if(step==="write")progress(.1+.85*Math.min(1,(value||0)/1167));
  else if(step==="done")progress(1);
  message(text);
}
$("firmware-install").onclick=()=>task(async()=>{
  const prepared=preparedFirmware,selected=device;
  if(!prepared||!selected)throw new Error("Choose a firmware file and connect the FM1 first.");
  const issue=installationIssue(selected.id,prepared);if(issue)throw new Error(issue);
  const access=updaterAccess(midi,selected);
  if(!confirm(`Install ${prepared.kind==="stock"?"M-VAVE stock V15":"SMSGGDJ "+(prepared.releaseVersion||prepared.version)}? This replaces the current instrument. Export work you want to keep first. Unsaved working edits will be lost. Keep USB and power connected until the update finishes.`))return;
  if(client&&$("backup-before-install").checked){
    message("Downloading your SRAM backup before installation…");
    const bytes=await client.read();download(bytes,"smsggdj-before-update-"+new Date().toISOString().replace(/[:.]/g,"-")+".sav");
  }
  writingFirmware=true;$("firmware-log").textContent="";
  client?.close();client=null;refreshButtons();
  try{
    await installPrepared(access,prepared,{updaterFactory:(a,log)=>new Updater(a,log),onStep:firmwareStep,onLog:t=>{$("firmware-log").textContent+=t+"\n";}});
    writingFirmware=false;disconnect();
    try{await connectDevice();message("Firmware installed and verified. Your FM1 is ready.");}
    catch(error){message("Firmware installed and verified. Click Connect FM1 to reconnect.");}
  }catch(error){
    disconnect();$("firmware-section").open=true;
    throw new Error((error.message||String(error))+" Keep the same firmware file; reconnect and install it again if the device remains in update mode.");
  }finally{writingFirmware=false;refreshButtons();}
});
$("get-release").onclick=()=>task(async()=>{
  preparedFirmware=null;
  if(!availableRelease)throw new Error("No published firmware download is available yet.");
  const url=new URL(availableRelease.package,location.href);
  if(url.origin!==location.origin)throw new Error("Firmware downloads must come from this site.");
  const response=await fetch(url);if(!response.ok)throw new Error("Firmware download failed. Try again later.");
  const bytes=new Uint8Array(await response.arrayBuffer());
  await firmwareSelected(bytes,url.pathname.split("/").pop(),availableRelease.sha256);
  if(preparedFirmware.product!==availableRelease.product){preparedFirmware=null;throw new Error("The downloaded firmware identity does not match the release.");}
});
$("download-report").onclick=()=>task(async()=>{
  let data;
  try{data=await client.call(13);}catch(error){if(error.code===1)throw new Error("This firmware does not provide performance counters. Update to a current build.");throw error;}
  if(data.length!==20)throw new Error("This firmware does not provide performance counters. Update to a current build.");
  const report={recorded_at:new Date().toISOString(),firmware:device?.id.text||"browser-preview",browser:navigator.userAgent,
    uptime_ms:u32(data,0),cpu_percent:u32(data,4),audio_overruns:u32(data,8),emulated_frames:u32(data,12),core_fault:!!u32(data,16)};
  download(new TextEncoder().encode(JSON.stringify(report,null,2)+"\n"),"fm1-smsggdj-report.json");message("Performance report downloaded. It contains no song data.");
});
window.addEventListener("beforeunload",event=>{if(writingFirmware||busy||doc.dirty){event.preventDefault();event.returnValue="";}});
fetch("release.json").then(r=>{if(!r.ok)throw new Error();return r.json();}).then(release=>{
  validateRelease(release,location.href);
  if(release.available){
    availableRelease=release;$("get-release").hidden=false;$("release-status").textContent=`Published firmware: ${release.version}`;
    for(const [id,field] of [["download-firmware","package"],["download-release-rom","rom"],["download-source","source"],["download-notices","notices"],["release-notes","release_url"]])$(id).href=release[field];
    $("release-downloads").hidden=false;
  }else $("release-status").textContent=release.message||"No firmware download is published yet. Choose a local .fwsc file.";
  refreshButtons();
}).catch(()=>{$("release-status").textContent="Firmware download information is unavailable. You can still choose a local .fwsc file.";});
if(!navigator.requestMIDIAccess||window.isSecureContext===false)$("browser-note").textContent="Device access needs Chrome or Edge over HTTPS or localhost. Offline song-file editing still works here.";
$("open-sram").onclick=()=>$("sram-file").click();
$("sram-file").onchange=()=>task(async()=>{const file=$("sram-file").files[0];if(!file)return;if(file.size>32768)throw new Error("SRAM is at most 32 KiB.");const next=readSRAM(new Uint8Array(await file.arrayBuffer()));if(doc.dirty&&!confirm("Replace the browser cartridge and its unsent edits?"))return;doc=next;label=file.name;baseCRC=null;render();message("SRAM opened. The device has not changed.");$("sram-file").value="";});
$("download-sram").onclick=()=>download(doc.bytes,"smsggdj.sav");
$("new-sram").onclick=()=>{if(doc.songs.length&&!confirm("Start an empty browser cartridge? The device is unchanged."))return;doc=emptySRAM();label="New cartridge";baseCRC=null;render();};
$("import-song").onclick=()=>chooseSong();
$("song-file").onchange=()=>task(async()=>{const file=$("song-file").files[0];if(!file)return;if(file.size>6928)throw new Error("That file is too large for one song.");const song=importSong(new Uint8Array(await file.arrayBuffer()),file.name),a=doc.songs.slice(),replacing=replaceSlot!==null;if(replacing)a[replaceSlot]=song;else a.push(song);change(a);$("song-file").value="";replaceSlot=null;message(`Song ${replacing?"replaced in":"added to"} the browser cartridge. Download SRAM or send it to the device when ready.`);});
$("read-device").onclick=()=>task(async()=>{if(doc.dirty&&!confirm("Replace the browser cartridge and its unsent edits with device SRAM?"))return;const bytes=await client.read();doc=readSRAM(bytes);baseCRC=crc32(bytes);label="Device SRAM";render();await showInfo();message("SRAM read and checksum verified.");});
$("send-device").onclick=()=>task(async()=>{
  const info=await client.info(),expected=baseCRC??info.sramCRC;
  if(!confirm(`Replace all device cartridge SRAM with these ${doc.songs.length} songs and restart the tracker? Unsaved working-song edits on the device will be lost.`))return;
  await client.write(doc.bytes,expected);await client.waitReady();const check=await client.read();
  if(crc32(check)!==crc32(doc.bytes))throw new Error("Write completed, but read-back differs. Read device SRAM before continuing.");
  baseCRC=crc32(check);doc.dirty=false;render();await showInfo();message("SRAM saved and read-back verified. Use FILES → LOAD in the tracker to open a song.");
});
async function selectedROM(){const f=$("rom-file").files[0];if(!f)throw new Error("Choose a Game Gear ROM.");if(f.size>131072)throw new Error("ROM slot capacity is 128 KiB.");const pf=$("profile-file").files[0];if(pf&&pf.size>16384)throw new Error("Profile JSON is too large.");return prepareROM(new Uint8Array(await f.arrayBuffer()),pf?JSON.parse(await pf.text()):null,await loadDefaults());}
$("check-rom").onclick=()=>task(async()=>{const p=await selectedROM();$("rom-check").textContent=`Compatible: ${p.name} · ${p.rom.length/1024} KiB · matching RAM profile`;message("ROM and profile checked. Nothing has been sent.");});
$("upload-rom").onclick=()=>task(async()=>{const p=await selectedROM();if(!confirm(`Upload ${p.name} and restart? Cartridge SRAM is retained. Unsaved working-song edits will be lost.`))return;message("Uploading ROM. Keep the connection open…");await client.replaceROM(p);await client.waitReady();const result=await client.read(1);if(crc32(result)!==crc32(p.rom))throw new Error("ROM read-back mismatch.");await showInfo();message("ROM installed, restarted and read-back verified. Cartridge SRAM retained.");});
$("download-rom").onclick=()=>task(async()=>{const info=await client.info(),bytes=await client.read(1);download(bytes,info.profile.name.replace(/[^a-z0-9_-]/gi,"_")+".gg");message("Current ROM downloaded and checksum verified.");});
$("builtin-rom").onclick=()=>task(async()=>{if(!confirm("Restore the built-in v0.48 ROM and restart? Cartridge SRAM is retained; unsaved working-song edits will be lost."))return;await client.call(OP.BUILTIN);await client.waitReady();await showInfo();message("Built-in ROM restored. Cartridge SRAM retained.");});
$("cancel").onclick=()=>{client?.cancel();message("Cancelling after the current block…");};
render();
