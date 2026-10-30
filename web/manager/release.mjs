// SPDX-License-Identifier: MIT
// The first public release intentionally retains the tested FM-1_9500 bytes.
export function validateRelease(release,base){
  if(release.schema!==1||typeof release.available!=="boolean")throw new Error("Invalid release information.");
  if(!release.available)return release;
  if(!/^\d{1,2}\.\d{1,2}\.\d{1,2}$/.test(release.version)||!/^[a-f0-9]{64}$/i.test(release.sha256))throw new Error("Invalid release version or checksum.");
  const product="FM-1_95"+release.version.split(".").map(p=>p.padStart(2,"0")).join("");
  if(release.product!=="FM-1_9500"&&release.product!==product)throw new Error("Release identity does not match its version.");
  const prefix=`releases/v${release.version}/`,names={package:`fm1-smsggdj-${release.version}.fwsc`,rom:"smsggdj-v0.48.gg",source:`fm1-smsggdj-${release.version}-source.tar.gz`,notices:`fm1-smsggdj-${release.version}-notices.zip`};
  const origin=new URL(base).origin;
  for(const [field,name] of Object.entries(names)){
    if(release[field]!==prefix+name||new URL(release[field],base).origin!==origin)throw new Error("Unexpected release download path.");
  }
  if(release.release_url!==`https://github.com/little-scale/fm1-smsggdj/releases/tag/v${release.version}`)throw new Error("Unexpected release notes URL.");
  return release;
}
