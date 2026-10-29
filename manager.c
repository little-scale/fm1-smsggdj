/* SPDX-License-Identifier: MIT
 * Cartridge manager v1. All requests run on the main loop. No allocations,
 * no unbounded writes, and no firmware/bootloader-sector access.
 */
#include <stdint.h>
#include "compat.h"
#include "plat.h"
#include "gg.h"
#include "save.h"
#include "manager.h"
#define ROM_META 0xAA000u
#define ROM_DATA 0xAB000u
#define ROM_MARK 0x314D5247u
enum { IDLE, READ_SRAM, READ_ROM, WRITE_SRAM, WRITE_ROM };
static uint8_t staging[GG_SRAM_BYTES] PLAT_POOL;
static uint8_t cached[GG_MANAGER_REPLY_MAX];
static uint32_t cached_n, cached_crc, received, expected_crc, touched, revision;
static uint16_t cached_seq;
static uint8_t cached_op, mode, external_rom;
static const uint8_t *read_source;
static uint32_t read_size;
static gg_profile uploading;
static uint16_t rd16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1]<<8)); }
static uint32_t rd32(const uint8_t *p) { return (uint32_t)rd16(p) | ((uint32_t)rd16(p+2)<<16); }
static void wr16(uint8_t *p,uint32_t v) { p[0]=(uint8_t)v;p[1]=(uint8_t)(v>>8); }
static void wr32(uint8_t *p,uint32_t v) { wr16(p,v);wr16(p+2,v>>16); }

static int stored_profile(gg_profile *p)
{
    const uint8_t *meta=plat_data(ROM_META), *data=plat_data(ROM_DATA);
    return meta && data && rd32(meta)==ROM_MARK && gg_profile_decode(p,meta+4)
        && gg_crc32(data,p->rom_size)==p->rom_crc
        && gg_crc32(data,32768)==p->code_crc;
}
int gg_manager_boot(void)
{
    gg_profile p;
    mode=IDLE;cached_n=0;external_rom=0;
    gg_hold(1);
    if (stored_profile(&p) && gg_use_rom(plat_data(ROM_DATA),p.rom_size,&p)) external_rom=1;
    else if (!gg_use_rom(0,0,0)) return 0;
    gg_save_load(gg_sram());gg_unhold();++revision;return 1;
}
static int restart(const uint8_t *data,const gg_profile *p)
{
    if (!gg_use_rom(data,p?p->rom_size:0,p)) return 0;
    memcpy(gg_sram(),staging,GG_SRAM_BYTES);
    gg_unhold();++revision;return 1;
}
static void abort_transfer(void)
{
    if (mode==WRITE_ROM) { external_rom=0;restart(0,0); }
    mode=IDLE;received=0;cached_n=0;gg_unhold();
}
void gg_manager_tick(uint32_t now)
{
    if (mode && now-touched>5000u) abort_transfer();
}
int gg_manager_busy(void) { return mode!=IDLE; }
uint8_t *gg_manager_buffer(void) { return staging; }
uint32_t gg_manager_revision(void) { return revision; }
int gg_manager_external(void) { return external_rom; }

/* Payload: version, op, sequence LE16, arguments. Reply: same version/op|128/
 * sequence, status, data. The USB envelope supplies pack7 and checksum; the
 * preview calls this exact same parser. Identical retries replay the ACK. */
uint32_t gg_manager_packet(const uint8_t *req,uint32_t n,uint8_t *out,uint32_t cap)
{
    unsigned op,rc=GM_OK;uint32_t data_n=0,request_crc,now=plat_ms();
    uint16_t seq;const uint8_t *p;uint32_t len;
    if (n<4 || n>264 || req[0]!=1 || cap<GG_MANAGER_REPLY_MAX) return 0;
    op=req[1];seq=rd16(req+2);p=req+4;len=n-4;request_crc=gg_crc32(req,n);
    if(op!=GM_INFO && op!=GM_STATS && cached_n && seq==cached_seq && op==cached_op && request_crc==cached_crc) {
        memcpy(out,cached,cached_n);if(mode)touched=now;return cached_n;
    }
    out[0]=1;out[1]=(uint8_t)(op|128);wr16(out+2,seq);out[4]=GM_OK;
    if (op==GM_STATS && !len) {
        /* Non-blocking counters: do not pause audio or scan cartridge SRAM. */
        wr32(out+5,now);wr32(out+9,plat_cpu_pct());wr32(out+13,plat_xruns());
        wr32(out+17,gg_frames());wr32(out+21,gg_faulted());data_n=20;
    } else if (op==GM_INFO && !len) {
        uint8_t held=mode!=IDLE;
        if(!held)gg_hold(1);
        wr32(out+5,0x314A4447u);out[9]=mode;out[10]=gg_playing()!=0;out[11]=external_rom;out[12]=gg_boot_ready()!=0;
        wr32(out+13,gg_crc32(gg_sram(),GG_SRAM_BYTES));
        wr32(out+17,gg_save_generation());gg_profile_encode(out+21,gg_current_profile());data_n=116;
        if(!held)gg_unhold();
    } else if (op==GM_ABORT && !len) {
        abort_transfer();
    } else if (op==GM_READ_BEGIN && len==1 && p[0]<2) {
        if(mode)rc=GM_BUSY;
        else if(!gg_boot_ready())rc=GM_BOOTING;
        else {
            gg_hold(1);
            if(gg_playing()) { gg_unhold();rc=GM_PLAYING; }
            else {
                mode=p[0]?READ_ROM:READ_SRAM;
                if(p[0]) { read_source=gg_rom_data();read_size=gg_current_profile()->rom_size; }
                else { memcpy(staging,gg_sram(),GG_SRAM_BYTES);read_source=staging;read_size=GG_SRAM_BYTES; }
                wr32(out+5,read_size);wr32(out+9,gg_crc32(read_source,read_size));data_n=8;
            }
        }
    } else if (op==GM_READ && len==6) {
        uint32_t off=rd32(p),count=rd16(p+4);
        if(mode!=READ_SRAM && mode!=READ_ROM)rc=GM_STATE;
        else if(!count || count>256 || off>read_size || count>read_size-off)rc=GM_RANGE;
        else { wr32(out+5,off);memcpy(out+9,read_source+off,count);data_n=4+count; }
    } else if (op==GM_END && !len) {
        if(mode!=READ_SRAM && mode!=READ_ROM)rc=GM_STATE;
        else { mode=IDLE;gg_unhold(); }
    } else if (op==GM_WRITE_BEGIN && len==12) {
        if(mode)rc=GM_BUSY;
        else if(!gg_boot_ready())rc=GM_BOOTING;
        else if(rd32(p)!=GG_SRAM_BYTES)rc=GM_RANGE;
        else {
            gg_hold(1);
            if(gg_playing()) { gg_unhold();rc=GM_PLAYING; }
            else if(rd32(p+8)!=gg_crc32(gg_sram(),GG_SRAM_BYTES)) { gg_unhold();rc=GM_STALE; }
            else { expected_crc=rd32(p+4);received=0;mode=WRITE_SRAM; }
        }
    } else if (op==GM_WRITE && len>=5 && len<=260) {
        uint32_t off=rd32(p),count=len-4;
        if(mode!=WRITE_SRAM)rc=GM_STATE;
        else if(off>GG_SRAM_BYTES || count>GG_SRAM_BYTES-off)rc=GM_RANGE;
        else if(off==received) { memcpy(staging+off,p+4,count);received+=count; }
        else if(off>=received || count>received-off || memcmp(staging+off,p+4,count))rc=GM_RANGE;
        if(!rc){wr32(out+5,received);data_n=4;}
    } else if (op==GM_WRITE_COMMIT && !len) {
        if(mode!=WRITE_SRAM || received!=GG_SRAM_BYTES)rc=GM_STATE;
        else if(gg_crc32(staging,GG_SRAM_BYTES)!=expected_crc)rc=GM_CRC;
        else if(gg_save_write(staging))rc=GM_FLASH;
        else {
            gg_profile current=*gg_current_profile();const uint8_t *rom=gg_rom_data();
            if(!restart(rom,&current))rc=GM_PROFILE;
            mode=IDLE;wr32(out+5,gg_save_generation());data_n=4;
        }
    } else if (op==GM_ROM_BEGIN && len==GG_PROFILE_BYTES) {
        if(mode)rc=GM_BUSY;
        else if(!gg_boot_ready())rc=GM_BOOTING;
        else if(!gg_profile_decode(&uploading,p))rc=GM_PROFILE;
        else {
            gg_hold(1);
            if(gg_playing()){gg_unhold();rc=GM_PLAYING;}
            else {
                memcpy(staging,gg_sram(),GG_SRAM_BYTES);
                /* Persist cartridge first. Invalidate metadata before touching
                 * ROM data so an interrupted upload boots the built-in ROM. */
                if(gg_save_write(staging)) {gg_unhold();rc=GM_FLASH;}
                else if(plat_data_erase(ROM_META)) {gg_unhold();rc=GM_FLASH;}
                else {
                    uint32_t i;mode=WRITE_ROM;received=0;external_rom=0;
                    for(i=0;i<uploading.rom_size;i+=4096u)
                        if(plat_data_erase(ROM_DATA+i)){rc=GM_FLASH;break;}
                    if(rc)abort_transfer();
                }
            }
        }
    } else if (op==GM_ROM_WRITE && len>=5 && len<=260) {
        uint32_t off=rd32(p),count=len-4;
        if(mode!=WRITE_ROM)rc=GM_STATE;
        else if(off>uploading.rom_size || count>uploading.rom_size-off)rc=GM_RANGE;
        else if(off==received) {
            if(plat_data_write(ROM_DATA+off,p+4,count))rc=GM_FLASH;
            else received+=count;
        } else if(off>=received || count>received-off || memcmp(plat_data(ROM_DATA)+off,p+4,count))rc=GM_RANGE;
        if(!rc){wr32(out+5,received);data_n=4;}
    } else if (op==GM_ROM_COMMIT && !len) {
        const uint8_t *data=plat_data(ROM_DATA);
        if(mode!=WRITE_ROM || received!=uploading.rom_size)rc=GM_STATE;
        else if(!data || gg_crc32(data,received)!=uploading.rom_crc || gg_crc32(data,32768)!=uploading.code_crc)rc=GM_CRC;
        else if(memcmp(data+0x7ff0,"TMR SEGA",8) || (data[0x7fff]>>4)<5 || (data[0x7fff]>>4)>7)rc=GM_PROFILE;
        else {
            uint8_t wire[GG_PROFILE_BYTES],mark[4];gg_profile_encode(wire,&uploading);wr32(mark,ROM_MARK);
            if(plat_data_write(ROM_META+4,wire,sizeof wire) || memcmp(plat_data(ROM_META)+4,wire,sizeof wire)
                || plat_data_write(ROM_META,mark,4))rc=GM_FLASH;
            else if(!restart(data,&uploading))rc=GM_PROFILE;
            else {external_rom=1;mode=IDLE;}
        }
    } else if (op==GM_BUILTIN && !len) {
        if(mode)rc=GM_BUSY;
        else {
            gg_hold(1);
            if(gg_playing()){gg_unhold();rc=GM_PLAYING;}
            else {
                memcpy(staging,gg_sram(),GG_SRAM_BYTES);
                if(gg_save_write(staging) || plat_data_erase(ROM_META)){gg_unhold();rc=GM_FLASH;}
                else {external_rom=0;if(!restart(0,0))rc=GM_PROFILE;}
            }
        }
    } else rc=GM_BAD;
    if(mode && op!=GM_INFO && op!=GM_STATS)touched=plat_ms();
    out[4]=(uint8_t)rc;
    if(op!=GM_INFO && op!=GM_STATS) {
        cached_n=5+data_n;cached_op=op;cached_seq=seq;cached_crc=request_crc;memcpy(cached,out,cached_n);
    }
    return 5+data_n;
}

uint32_t gg_manager_usb(const uint8_t *d,uint32_t n,uint8_t *wire,uint32_t cap)
{
    uint8_t answer[GG_MANAGER_REPLY_MAX],raw[GG_MANAGER_REPLY_MAX+7],sum=0;
    uint32_t len,i,k=1,acc=0,bits=0,got;
    if(n<7 || cap<324 || d[0] || d[1]!=0x59 || d[2]!=GG_MANAGER_CMD)return 0;
    len=(uint32_t)d[3]|((uint32_t)d[4]<<8)|((uint32_t)d[5]<<16);
    if(len>264 || n!=len+7)return 0;
    for(i=6;i<n;i++)sum=(uint8_t)(sum+d[i]);if(sum!=255)return 0;
    got=gg_manager_packet(d+6,len,answer,sizeof answer);if(!got)return 0;
    raw[0]=0;raw[1]=0x59;raw[2]=GG_MANAGER_CMD;raw[3]=(uint8_t)got;raw[4]=(uint8_t)(got>>8);raw[5]=0;
    memcpy(raw+6,answer,got);sum=0;for(i=0;i<got;i++)sum=(uint8_t)(sum+answer[i]);raw[6+got]=(uint8_t)~sum;
    wire[0]=0xf0;
    for(i=0;i<got+7;i++) { acc|=(uint32_t)raw[i]<<bits;bits+=8;while(bits>=7){wire[k++]=(uint8_t)(acc&127);acc>>=7;bits-=7;} }
    if(bits)wire[k++]=(uint8_t)(acc&127);wire[k++]=0xf7;return k;
}
