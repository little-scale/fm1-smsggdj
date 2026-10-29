/* SPDX-License-Identifier: MIT */
#include "compat.h"
#include "profile.h"
#include "save.h"
#include "default_profile.h"
uint16_t fmgg_editor_pc, fmgg_engine_pc;
static uint16_t r16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1]<<8)); }
static uint32_t r32(const uint8_t *p) { return (uint32_t)r16(p) | ((uint32_t)r16(p+2)<<16); }
static void w16(uint8_t *p, uint32_t v) { p[0]=(uint8_t)v;p[1]=(uint8_t)(v>>8); }
static void w32(uint8_t *p, uint32_t v) { w16(p,v);w16(p+2,v>>16); }
const gg_profile *gg_builtin_profile(void) { return &default_profile; }
int gg_profile_valid(const gg_profile *p)
{
    unsigned i;
    if (p->magic!=GG_PROFILE_MAGIC || p->rom_size<32768u || p->rom_size>GG_ROM_MAX
        || (p->rom_size&16383u) || !p->phrases || p->phrases>128u
        || !p->instruments || p->instruments>16u || p->midi_low>p->midi_high
        || p->midi_high-p->midi_low>=254 || p->reserved || p->name[23]) return 0;
    if (p->address[0]>=0x4000u || p->address[1]>=0x4000u || p->address[0]==p->address[1]) return 0;
    for (i=2;i<GG_ADDRESS_COUNT;i++) if (p->address[i]<0xc000u || p->address[i]>=0xe000u) return 0;
    if ((uint32_t)p->address[GG_A_PHRASE_POOL]+p->phrases*64u>0xe000u
        || p->address[GG_A_DIRTY_ROWS]+16u>0xe000u) return 0;
    return 1;
}
void gg_profile_encode(uint8_t *w,const gg_profile *p)
{
    unsigned i;
    w32(w,p->magic);w32(w+4,p->rom_size);w32(w+8,p->rom_crc);w32(w+12,p->code_crc);
    for(i=0;i<GG_ADDRESS_COUNT;i++)w16(w+16+i*2,p->address[i]);
    w16(w+66,p->phrases);w[68]=p->midi_low;w[69]=p->midi_high;w[70]=p->instruments;w[71]=p->reserved;
    memcpy(w+72,p->name,24);w32(w+96,gg_crc32(w,96));
}
int gg_profile_decode(gg_profile *p,const uint8_t *w)
{
    unsigned i;
    if(r32(w+96)!=gg_crc32(w,96))return 0;
    p->magic=r32(w);p->rom_size=r32(w+4);p->rom_crc=r32(w+8);p->code_crc=r32(w+12);
    for(i=0;i<GG_ADDRESS_COUNT;i++)p->address[i]=r16(w+16+i*2);
    p->phrases=r16(w+66);p->midi_low=w[68];p->midi_high=w[69];p->instruments=w[70];p->reserved=w[71];
    memcpy(p->name,w+72,24);return gg_profile_valid(p);
}
