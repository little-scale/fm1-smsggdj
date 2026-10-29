#!/usr/bin/env python3
"""Compare compact port against the previously working, unmodified ESP32 core.

Pass the earlier components/smsplus directory. Builds two native executables;
compares stereo PSG samples and full framebuffers from real SMSGGDJ v0.48.
"""
import argparse
import array
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from paths import APP, BASE
CORE=['cpu/z80.c','memz80.c','pio.c','render.c','sms.c','system.c','tms.c','vdp.c','sound/sn76489.c','sound/sound.c']
HARNESS=r'''
#include "shared.h"
#include <stdio.h>
#ifdef COMPACT
#include "gg.h"
const uint8_t *plat_data(uint32_t off) { return 0; }
int plat_data_erase(uint32_t off) { return -1; }
int plat_data_write(uint32_t off,const void *p,uint32_t n) { return -1; }
#endif
int main(int argc,char **argv) {
    if(argc!=4)return 2;
    int type=atoi(argv[2]);
#ifdef COMPACT
    if(!gg_init())return 3;
#else
    system_reset_config();option.overscan=0;option.sndrate=44100;
    if(!load_rom_file(argv[1]))return 3;
    bitmap.width=256;bitmap.height=192;bitmap.pitch=256;bitmap.data=calloc(1,256*192);
    system_poweron();
#endif
    FILE *out=fopen(argv[3],"wb");if(!out)return 4;
    for(int f=0;f<600;f++) {
        unsigned pad=f>=205&&f<208?32:f>=208&&f<210?48:f>=210&&f<213?32:0;
        if(f==200) {
            sms.wram[0x1d39]=2; /* PHRASE */
            sms.wram[0x1d3a]=0; /* T1 */
            sms.wram[0x1d3c]=0;
            sms.wram[0x1d5e]=0;
            sms.wram[0x1300]=0; /* song row 0 / T1 -> chain 0 */
            sms.wram[0x0e00]=0; /* chain 0 / row 0 -> phrase 0 */
            sms.wram[0x0e01]=0;
            sms.wram[0x1500]=type;
            sms.wram[0x1501]=15; /* boot blank instruments have zero volume */
            sms.wram[0x1502]=3;
            sms.wram[0x1503]=1;
            sms.wram[0x1509]=255;
            sms.wram[0x150a]=1;
            for(int r=0;r<16;r++)sms.wram[0x1e7a+r]=1;
            for(int r=0;r<16;r++){
                uint8 *s=sms.wram+0x100+r*4;s[0]=r%4==0?16+r:0;s[1]=0;s[2]=s[3]=0;
            }
        }
#ifdef COMPACT
        gg_set_pad(pad);
#else
        input.pad[0]=pad;
#endif
        system_frame(0);
        for(int s=0;s<snd.sample_count;s++)for(int ch=0;ch<2;ch++){
            uint16 v=(uint16)snd.stream[ch][s];fputc(v&255,out);fputc(v>>8,out);
        }
    }
    fwrite(bitmap.data,1,256*192,out);fclose(out);return 0;
}
'''
def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('reference',type=Path);a=ap.parse_args()
    out=APP/'build/reference-comparison';out.mkdir(parents=True,exist_ok=True)
    src=out/'compare.c';src.write_text(HARNESS)
    flags=['clang','-O2','-fno-strict-aliasing','-ffp-contract=off','-w']
    subprocess.run([*flags,'-I'+str(a.reference),str(src),*[str(a.reference/s) for s in CORE],str(a.reference/'loadrom.c'),'-o',str(out/'reference')],check=True)
    subprocess.run([*flags,'-DPLAT_HOST','-DCOMPACT',*['-I'+str(p) for p in [APP,APP/'build/gen',BASE/'include',APP/'vendor/smsplus']],str(src),str(APP/'engine.c'),str(APP/'profile.c'),str(APP/'save.c'),*[str(APP/'vendor/smsplus'/s) for s in CORE],'-o',str(out/'compact')],check=True)
    results={}
    for type,name in [(0,'tone'),(2,'kit'),(3,'wav')]:
        files=[]
        for version in ['reference','compact']:
            target=out/(name+'-'+version+'.bin')
            subprocess.run([str(out/version),str(APP/'rom/smsggdj-v0.48.gg'),str(type),str(target)],check=True,timeout=30,capture_output=True)
            files.append(target.read_bytes())
        pcm=array.array('h',files[0][:-256*192]);peak=max(abs(v) for v in pcm);nonzero=sum(bool(v) for v in pcm)
        same=files[0]==files[1] and peak>100 and nonzero>100
        results[name]={'identical':same,'bytes':len(files[0]),'peak':peak,'nonzero_samples':nonzero,'reference_sha256':hashlib.sha256(files[0]).hexdigest(),'compact_sha256':hashlib.sha256(files[1]).hexdigest()}
        print(('PASS' if same else 'FAIL')+' '+name+': stereo PSG output and framebuffer '+('byte-identical' if same else 'differ or silent')+f'; peak {peak}, nonzero {nonzero}')
    (out/'result.json').write_text(json.dumps(results,indent=2)+'\n')
    return 0 if all(v['identical'] for v in results.values()) else 1
if __name__=='__main__':raise SystemExit(main())
