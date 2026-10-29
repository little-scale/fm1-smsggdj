// SPDX-License-Identifier: MIT
const KEY="ggdj-fm1-cartridge-v1";
let context;
let rpcID=0;
const rpcPending=new Map();
export function attach(c) {
  context=c;
  const bar=document.querySelector(".bar"), out=document.createElement("button"), inp=document.createElement("input"), load=document.createElement("button");
  out.textContent="Export cartridge .sav";out.type="button";
  out.onclick=()=>c.node.port.postMessage({type:"app",action:"export"});
  load.textContent="Import cartridge .sav";load.type="button";
  inp.type="file";inp.accept=".sav";inp.hidden=true;
  load.onclick=()=>inp.click();
  inp.onchange=async()=>{
    const file=inp.files[0];if(!file)return;
    if(file.size!==32768){c.status("Expected a 32 KiB cartridge .sav file.");return;}
    const bytes=await file.arrayBuffer();
    c.node.port.postMessage({type:"app",action:"import",bytes},[bytes]);inp.value="";
  };
  bar.append(out,load,inp);
  const manager=document.createElement("button");manager.type="button";manager.textContent="Cartridge manager";
  manager.onclick=()=>window.open("./manager/index.html?preview=1","ggdj-manager");bar.append(manager);
  window.ggPreviewRequest=(bytes)=>new Promise((resolve,reject)=>{
    const id=++rpcID, timer=setTimeout(()=>{rpcPending.delete(id);reject(new Error("Preview did not reply."));},20000);
    rpcPending.set(id,{resolve,reject,timer});c.node.port.postMessage({type:"app",action:"manager",id,bytes});
  });
}
export function message(m) {
  if(m.action==="manager-reply") {
    const pending=rpcPending.get(m.id);if(pending){clearTimeout(pending.timer);rpcPending.delete(m.id);pending.resolve(m.bytes);}
  } else if(m.action==="journal-request") {
    let bytes;
    try {const text=localStorage.getItem(KEY);if(text)bytes=Uint8Array.from(atob(text),c=>c.charCodeAt(0)).buffer;}catch{}
    context.node.port.postMessage({type:"app",action:"restore-journal",bytes});
  } else if(m.action==="journal") {
    try {let text="";for(const c of m.bytes)text+=String.fromCharCode(c);localStorage.setItem(KEY,btoa(text));}
    catch {context.status("Browser storage unavailable. Export your cartridge before closing.");}
  } else if(m.action==="save-file") {
    const url=URL.createObjectURL(new Blob([m.bytes],{type:"application/octet-stream"})), a=document.createElement("a");
    a.href=url;a.download="smsggdj.sav";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  } else if(m.action==="imported") context.status("Cartridge imported. Use FILES → LOAD inside SMSGGDJ.");
  else if(m.action==="error")context.status(m.text);
}
