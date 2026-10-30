// SPDX-License-Identifier: MIT
// Package layout follows the pinned fm1-base packer; its browser updater is
// vendored separately with its original MPL-2.0 notices.
import {productOf,logicalImage} from './vendor/fm1pkg.mjs';
export const STOCK_PRODUCT='FM-1_015';
export const STOCK_SHA256='db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a';
const appPattern=/^FM-1_95(?:\d{2}|\d{6})$/;
const u16=(a,p)=>a[p]|a[p+1]<<8;
const u32=(a,p)=>(a[p]|a[p+1]<<8|a[p+2]<<16|a[p+3]<<24)>>>0;
const ascii=a=>new TextDecoder().decode(a).replace(/\0.*$/s,'');
function crc16(bytes){let c=0;for(const b of bytes){c^=b<<8;for(let i=0;i<8;i++)c=((c<<1)^((c&0x8000)?0x1021:0))&65535;}return c;}
function decrypt(bytes){const out=bytes.slice();let key=65535;for(let i=0;i<out.length;i++){out[i]^=key&255;key=((key<<1)^((key&0x8000)?0x1021:0))&65535;}return out;}
function contains(bytes,text){const needle=new TextEncoder().encode(text);outer:for(let i=0;i<=bytes.length-needle.length;i++){for(let j=0;j<needle.length;j++)if(bytes[i+j]!==needle[j])continue outer;return true;}return false;}
export function firmwareVersion(product){
  if(!appPattern.test(product))return null;
  const digits=product.slice('FM-1_95'.length);
  return digits.length===6?[0,2,4].map(i=>Number(digits.slice(i,i+2))).join('.'):'Development build';
}
export function describeIdentity(id){
  if(!id)return 'Not connected';
  if(/^ota-/i.test(id.model))return 'FM1 in update mode';
  if(id.open)return 'M-VAVE Open firmware';
  const version=firmwareVersion(id.text);
  if(version)return `SMSGGDJ · ${version}`;
  if(id.text===STOCK_PRODUCT)return 'M-VAVE stock V15';
  return `Other FM1 firmware · ${id.text}`;
}
export async function inspectFirmware(input,{expectedSHA256}={}){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length<1024||bytes.length>4*1024*1024)throw new Error('Choose a complete FM1 .fwsc firmware package (up to 4 MiB).');
  const product=productOf(bytes);
  if(!appPattern.test(product)&&product!==STOCK_PRODUCT)throw new Error('This package is for another firmware. Choose FM1 SMSGGDJ or the verified stock V15 recovery file.');
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(expectedSHA256&&sha256!==expectedSHA256.toLowerCase())throw new Error('Firmware download checksum does not match the release. Nothing was sent.');
  const image=logicalImage(bytes);
  if(product===STOCK_PRODUCT){
    if(sha256!==STOCK_SHA256)throw new Error('This is not the verified M-VAVE stock V15 recovery file.');
    return {bytes,image,product,sha256,kind:'stock',version:'V15'};
  }
  const header=decrypt(image.subarray(0,64)),count=u16(header,8);
  if(u32(header,4)!==image.length||ascii(header.subarray(16,22))!=='AC791N'||u16(header,0)!==crc16(header.subarray(2)))throw new Error('Firmware header is damaged or incomplete. Nothing was sent.');
  if(count!==2||64+count*80>image.length)throw new Error('Unsupported firmware package layout.');
  const list=image.subarray(64,64+count*80);
  if(crc16(list)!==u16(header,2))throw new Error('Firmware file table checksum failed.');
  const entries=[];
  for(let i=0;i<count;i++){
    const entry=decrypt(list.subarray(i*80,(i+1)*80)),start=u32(entry,8),size=u32(entry,12),name=ascii(entry.subarray(64,80));
    if(u16(entry,2)!==i||start<1024||!size||start>image.length||size>image.length-start||u32(entry,16)<size)throw new Error('Firmware file bounds are invalid.');
    if(entries.some(e=>start<e.start+e.size&&e.start<start+size))throw new Error('Firmware files overlap.');
    const data=image.subarray(start,start+size);
    if(crc16(data)!==u16(entry,4))throw new Error(`Firmware ${name} checksum failed.`);
    entries.push({start,size,name,type:u16(entry,0),data});
  }
  const flash=entries.find(e=>e.name==='flash.bin'&&e.type===0),loader=entries.find(e=>e.name==='ota.bin'&&e.type===100);
  if(!flash||flash.size!==0x93000||!loader||!contains(loader.data,'FELUCCA-LOADER-1'))throw new Error('This package does not contain the supported FM1 update loader.');
  return {bytes,image,product,sha256,kind:'smsggdj',version:firmwareVersion(product)};
}
export function installationIssue(identity,prepared){
  if(!identity)return 'Connect your FM1 before installing firmware.';
  if(identity.model!=='FM-1'&&!/^ota-FM-1$/i.test(identity.model))return 'The connected device is not an FM1.';
  if(identity.open&&prepared.kind!=='stock')return 'This FM1 runs M-VAVE Open firmware. Restore the verified stock V15 file first, then install SMSGGDJ.';
  return null;
}
export async function installPrepared(access,prepared,{updaterFactory,onStep=()=>{},onLog=()=>{}}={}){
  if(!updaterFactory)throw new Error('Updater unavailable.');
  const updater=updaterFactory(access,onLog);
  // Re-check before any write: the connected device may have changed since
  // the file was selected or the page's confirmation was displayed.
  const device=await updater.find();
  if(!device)throw new Error('FM1 not found. Check the USB data cable and reconnect.');
  const identity=device.id;device.link.close();
  const issue=installationIssue(identity,prepared);if(issue)throw new Error(issue);
  if(/^ota-/i.test(identity.model)){
    if(!await updater.resume(prepared.image,onStep))throw new Error('Update did not finish. Keep the same firmware file and reconnect to resume.');
    onStep('reboot');
    const back=await updater.waitFor(id=>id.model==='FM-1',40000);
    if(!back)throw new Error('The update was written but the FM1 has not reconnected. Check the device before retrying.');
    back.link.close();
    if(back.id.text!==prepared.product)throw new Error(`The FM1 reports ${back.id.text}, not the selected firmware ${prepared.product}.`);
    onStep('done',back.id.text);return back.id.text;
  }
  return updater.install(prepared.image,prepared.product,onStep);
}
