// SPDX-License-Identifier: MIT
import {Updater} from './vendor/fm1ota.mjs';
import {Client,MidiTransport} from './transport.mjs';
export const isFM1Port=name=>/fm-?1|felucca|ota|composite|sinco|usb-midi/i.test(name||'');
const live=port=>port.state!=='disconnected';
export function candidatePairs(access){
  const outputs=[...access.outputs.values()].filter(live),pairs=[];
  for(const input of access.inputs.values()){
    if(!live(input)||!isFM1Port(input.name))continue;
    const matching=outputs.filter(p=>p.name===input.name&&(!input.manufacturer||!p.manufacturer||p.manufacturer===input.manufacturer));
    // Never guess which of two identically named outputs is the instrument.
    if(matching.length===1)pairs.push({input,output:matching[0]});
    else if(matching.length===0&&outputs.length===1&&isFM1Port(outputs[0].name))pairs.push({input,output:outputs[0]});
  }
  return pairs;
}
export async function discoverFM1(access,{inputId,outputId,updaterFactory=(a)=>new Updater(a)}={}){
  let pairs;
  if(inputId||outputId){
    const input=access.inputs.get(inputId),output=access.outputs.get(outputId);
    if(!input||!output||!live(input)||!live(output))throw new Error('Choose the connected FM1 input and output.');
    pairs=[{input,output}];
  }else pairs=candidatePairs(access);
  const found=[];
  for(const pair of pairs){
    const subset={inputs:new Map([[pair.input.id,pair.input]]),outputs:new Map([[pair.output.id,pair.output]])};
    const dev=await updaterFactory(subset).find();
    if(!dev)continue;
    dev.link.close();
    if(dev.id.model==='FM-1'||/^ota-FM-1$/i.test(dev.id.model))found.push({...pair,id:dev.id,name:dev.name});
  }
  if(found.length>1)throw new Error('More than one FM1 answered. Select its ports under Advanced connection.');
  if(!found.length)throw new Error('FM1 not found. Check the USB data cable, then try Advanced connection to select its ports.');
  return found[0];
}
export async function connectManager(device,progress=()=>{}){
  if(!/^FM-1_95(?:\d{2}|\d{6})$/.test(device.id.text))return null;
  const client=new Client(new MidiTransport(device.input,device.output),progress);
  try{await client.info();return client;}catch(error){client.close();throw error;}
}
export function updaterAccess(access,device){
  // Firmware updates re-enumerate under a loader name. Permit discovery of
  // that loader, but refuse ambiguous initial setups before starting.
  const pairs=candidatePairs(access);
  if(pairs.some(p=>p.input.id!==device.input.id))throw new Error('Disconnect other FM1 devices before installing firmware.');
  return access;
}
