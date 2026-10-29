// SPDX-License-Identifier: MIT
import {crc32,u16,u32,put16,put32,decodeProfile} from "./format.mjs";
export const OP={INFO:1,READ_BEGIN:2,READ:3,END:4,WRITE_BEGIN:5,WRITE:6,COMMIT:7,ROM_BEGIN:8,ROM_WRITE:9,ROM_COMMIT:10,ABORT:11,BUILTIN:12};
const ERR=["OK","Invalid request.","Stop playback on the FM1 first.","Another transfer is in progress.","Transfer offset or size is invalid.","Checksum mismatch; no valid replacement was committed.","Flash write failed.","The device SRAM changed since it was read. Read it again before sending edits.","The ROM and RAM profile are incompatible.","Transfer is incomplete or has expired.","The ROM is still booting. Try again in a moment."];
export function pack7(data){const out=[];let acc=0,bits=0;for(const b of data){acc|=b<<bits;bits+=8;while(bits>=7){out.push(acc&127);acc>>>=7;bits-=7;}}if(bits)out.push(acc&127);return out;}
export function unpack7(data){const out=[];let acc=0,bits=0;for(const b of data){if(b>127)throw new Error("Invalid SysEx data byte.");acc|=b<<bits;bits+=7;while(bits>=8){out.push(acc&255);acc>>>=8;bits-=8;}}return Uint8Array.from(out);}
export function frame(body){const raw=new Uint8Array(body.length+7);raw.set([0,0x59,0x66,body.length&255,body.length>>>8,0]);raw.set(body,6);raw[raw.length-1]=~body.reduce((s,b)=>s+b,0)&255;return Uint8Array.from([0xf0,...pack7(raw),0xf7]);}
export function unframe(bytes){
  if(bytes[0]!==0xf0||bytes.at(-1)!==0xf7)return null;
  let raw;try{raw=unpack7(bytes.subarray(1,-1));}catch{return null;}
  if(raw.length<7||raw[0]!==0||raw[1]!==0x59||raw[2]!==0x66||raw.length!==7+u16(raw,3)||raw[5]!==0)return null;
  if((raw.subarray(6).reduce((s,b)=>s+b,0)&255)!==255)return null;return raw.slice(6,-1);
}
export class MidiTransport {
  constructor(input,output){this.input=input;this.output=output;this.wait=null;this.listener=e=>{const b=unframe(e.data);if(b&&this.wait&&b[2]===this.wait.seq[0]&&b[3]===this.wait.seq[1]&&b[1]===this.wait.op){const w=this.wait;this.wait=null;clearTimeout(w.timer);w.resolve(b);}};input.addEventListener("midimessage",this.listener);}
  async exchange(body,timeout=15000){
    if(this.wait)throw new Error("A request is already in progress.");
    if(this.input.state==="disconnected"||this.output.state==="disconnected")throw new Error("FM1 disconnected.");
    await this.input.open();await this.output.open();
    return new Promise((resolve,reject)=>{
      this.wait={resolve,reject,seq:body.subarray(2,4),op:body[1]|128,timer:setTimeout(()=>{this.wait=null;reject(new Error("FM1 did not reply. Check the selected MIDI ports and install the GG DJ firmware with manager support."));},timeout)};
      try{this.output.send(frame(body));}catch(e){clearTimeout(this.wait.timer);this.wait=null;reject(e);}
    });
  }
  close(){this.input.removeEventListener("midimessage",this.listener);if(this.wait){clearTimeout(this.wait.timer);this.wait.reject(new Error("Disconnected."));this.wait=null;}}
}
export class PreviewTransport {
  async exchange(body){if(!window.opener?.ggPreviewRequest)throw new Error("Open this manager from the running browser preview.");return new Uint8Array(await window.opener.ggPreviewRequest(body));}
  close(){}
}
export class Client {
  constructor(transport,progress=()=>{}){this.transport=transport;this.progress=progress;this.sequence=1+Math.floor(Math.random()*60000);this.cancelled=false;}
  async call(op,data=new Uint8Array(),retry=true){
    const req=new Uint8Array(4+data.length);req[0]=1;req[1]=op;put16(req,2,this.sequence++&65535);req.set(data,4);
    let b;
    try{b=await this.transport.exchange(req,op===OP.INFO?1800:15000);}catch(e){if(!retry)throw e;b=await this.transport.exchange(req,op===OP.INFO?1800:15000);}
    if(b.length<5||b[0]!==1||b[1]!== (op|128)||u16(b,2)!==u16(req,2))throw new Error("Unexpected manager reply.");
    if(b[4]){const e=new Error(ERR[b[4]]||`Manager error ${b[4]}`);e.code=b[4];throw e;}return b.slice(5);
  }
  async info(){const d=await this.call(OP.INFO);if(d.length!==116||u32(d)!==0x314a4447)throw new Error("This is not a compatible GG DJ manager.");return {busy:d[4],playing:!!d[5],external:!!d[6],bootReady:!!d[7],sramCRC:u32(d,8),generation:u32(d,12),profile:decodeProfile(d.subarray(16))};}
  async waitReady(){for(let k=0;k<80;k++){const info=await this.info();if(info.bootReady)return info;await new Promise(r=>setTimeout(r,100));}throw new Error("The ROM did not finish booting. You can restore the built-in ROM.");}
  async read(kind=0){
    this.cancelled=false;let begun=false;
    try{
      const head=await this.call(OP.READ_BEGIN,Uint8Array.of(kind)),size=u32(head),crc=u32(head,4);
      begun=true;
      if(head.length!==8||size>(kind?131072:32768)||(kind===0&&size!==32768))throw new Error("Unexpected transfer length.");
      const all=new Uint8Array(size);
      for(let off=0;off<size;off+=256){if(this.cancelled)throw new Error("Transfer cancelled.");const count=Math.min(256,size-off),q=new Uint8Array(6);put32(q,0,off);put16(q,4,count);const part=await this.call(OP.READ,q);if(part.length!==4+count||u32(part)!==off)throw new Error("Read offset mismatch.");all.set(part.subarray(4),off);this.progress((off+count)/size);}
      if(crc32(all)!==crc)throw new Error("Downloaded checksum mismatch.");await this.call(OP.END);return all;
    }catch(e){if(begun)await this.call(OP.ABORT,new Uint8Array(),false).catch(()=>{});throw e;}
  }
  async write(bytes,baseCRC){
    this.cancelled=false;let begun=false;
    const q=new Uint8Array(12);put32(q,0,bytes.length);put32(q,4,crc32(bytes));put32(q,8,baseCRC);
    try{await this.call(OP.WRITE_BEGIN,q);begun=true;await this.chunks(bytes,OP.WRITE);await this.call(OP.COMMIT);}
    catch(e){if(begun)await this.call(OP.ABORT,new Uint8Array(),false).catch(()=>{});throw e;}
  }
  async replaceROM(prepared){
    this.cancelled=false;let begun=false;
    try{await this.call(OP.ROM_BEGIN,prepared.profile);begun=true;await this.chunks(prepared.rom,OP.ROM_WRITE);await this.call(OP.ROM_COMMIT);}
    catch(e){if(begun)await this.call(OP.ABORT,new Uint8Array(),false).catch(()=>{});throw e;}
  }
  async chunks(bytes,op){for(let off=0;off<bytes.length;off+=256){if(this.cancelled)throw new Error("Transfer cancelled.");const chunk=bytes.subarray(off,off+256),q=new Uint8Array(4+chunk.length);put32(q,0,off);q.set(chunk,4);const ack=await this.call(op,q);if(ack.length!==4||u32(ack)!==off+chunk.length)throw new Error("Write offset mismatch.");this.progress((off+chunk.length)/bytes.length);}}
  cancel(){this.cancelled=true;}
  close(){this.transport.close();}
}
