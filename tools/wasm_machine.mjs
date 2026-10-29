// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
export const APP=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const bytes=fs.readFileSync(path.join(APP,"build/emu/app.wasm"));
export async function machine(storage){
  let mem;
  const wasi=new Proxy({
    clock_time_get:(id,prec,p)=>{new DataView(mem.buffer).setBigUint64(p,process.hrtime.bigint(),true);return 0;},
    fd_write:(fd,iov,n,p)=>{new DataView(mem.buffer).setUint32(p,0,true);return 0;},
    proc_exit:code=>{throw new Error("WASM exit "+code);}
  },{get:(o,k)=>o[k]||(()=>0)});
  const {instance}=await WebAssembly.instantiate(bytes,{wasi_snapshot_preview1:wasi,env:new Proxy({},{get:()=>()=>0})});
  const ex=instance.exports;mem=ex.memory;ex._initialize?.();ex.gg_web_hold();ex.web_boot();
  if(storage)new Uint8Array(mem.buffer,ex.gg_web_journal(),storage.length).set(storage);
  ex.gg_web_reload();ex.web_master(4096);
  const run=samples=>{while(samples){const n=Math.min(1024,samples);ex.web_render(n);samples-=n;}};
  const buttons=mask=>{ex.web_buttons(mask);run(4410);},tap=mask=>{buttons(mask);buttons(0);};
  const rpc=body=>{new Uint8Array(mem.buffer,ex.gg_web_request_ptr(),body.length).set(body);const n=ex.gg_web_request_run(body.length);return new Uint8Array(mem.buffer,ex.gg_web_answer_ptr(),n).slice();};
  const storageBytes=()=>new Uint8Array(mem.buffer,ex.gg_web_journal(),ex.gg_web_journal_size()).slice();
  return {ex,mem,run,buttons,tap,rpc,storageBytes};
}
