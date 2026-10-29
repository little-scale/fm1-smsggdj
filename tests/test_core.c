/* SPDX-License-Identifier: MIT
 * Real-ROM integration, arithmetic/pixel equivalence and interrupted-save tests.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "gg.h"
#include "save.h"
#include "manager.h"
#include "ram_map.h"
#include "vendor/smsplus/shared.h"
#define CHECK(x) do { ++checks; if (!(x)) { fprintf(stderr,"FAIL line %d: %s\n",__LINE__,#x); exit(1); } } while (0)
static unsigned checks;
unsigned gg_test_flags(unsigned key, int sub);
unsigned gg_test_pixel(unsigned bg, unsigned sp);
int gg_test_halt(void);
int gg_test_tile_cache(void);
static int32_t block[512];
static unsigned peak, nonzero;
static FILE *audio;

static void run(unsigned samples)
{
    while (samples) {
        unsigned n = samples > 256 ? 256 : samples, i;
        gg_render(block,n,4096);
        for (i=0;i<n*2;i++) {
            int32_t v=block[i]; unsigned a=v<0?(unsigned)-v:(unsigned)v;
            if(a>peak) peak=a;
            if(v) ++nonzero;
        }
        if (audio) for(i=0;i<n*2;i++) {
            int16_t v=(int16_t)(block[i]/256); uint16_t u=(uint16_t)v;
            fputc(u&255,audio);fputc(u>>8,audio);
        }
        samples-=n;
    }
}
static void pad(unsigned p) { gg_set_pad(p);run(4410); }
static void tap(unsigned p) { pad(p);pad(0); }
static void event(unsigned kind,unsigned midi) { CHECK(gg_enqueue(kind,midi));run(1470); }
static uint8_t *at(unsigned a) { return gg_ram()+(a&8191); }
#define R(n) (*at(RAM_##n))

static void tables(void)
{
    unsigned old,res,c,sub,bg,sp;
    for(sub=0;sub<2;sub++) for(c=0;c<2;c++) for(old=0;old<256;old++) for(res=0;res<256;res++) {
        unsigned operand = sub ? ((old-res-c)&255u) : ((res-old-c)&255u);
        unsigned f=(res&0xa8)|(res?0:0x40)|(sub?2:0);
        int arithmetic=sub?(int)old-(int)operand-(int)c:(int)old+(int)operand+(int)c;
        if(sub ? (int)(old&15)-(int)(operand&15)-(int)c<0 : (old&15)+(operand&15)+c>15)f|=0x10;
        if(sub ? arithmetic<0 : arithmetic>255)f|=1;
        if(sub ? ((old^operand)&(old^res)&128) : ((~(old^operand))&(old^res)&128))f|=4;
        CHECK(gg_test_flags((c<<16)|(old<<8)|res,sub)==f);
    }
    for(bg=0;bg<256;bg++) for(sp=0;sp<256;sp++) {
        unsigned expected=bg&127;
        if(!(bg&64)) {
            if((bg&32)&&(bg&15))expected|=64;
            else if(sp&15)expected=(sp&15)|0x50;
        }
        CHECK(gg_test_pixel(bg,sp)==expected);
    }
    puts("PASS 262144 arithmetic flags and 65536 sprite/background combinations");
    CHECK(gg_test_halt());CHECK(gg_test_tile_cache());
    puts("PASS HALT cycle/refresh/IRQ/EI/NMI boundaries and 393216 cached tile pixels, flips and live VRAM changes");
}

/* Real NOR flash model with fail-before-operation power-loss injection. */
static uint8_t flash[0x49000], baseline[sizeof flash], saved[GG_SRAM_BYTES], restored[GG_SRAM_BYTES];
static int fail_after=-1, operations;
static uint32_t simulated_ms;
uint32_t plat_ms(void) { return simulated_ms; }
uint32_t plat_cpu_pct(void) { return 37; }
uint32_t plat_xruns(void) { return 5; }
const uint8_t *plat_data(uint32_t off) { return off>=0x97000 && off<0xe0000 ? flash+(off-0x97000) : 0; }
static int fail(void) { return fail_after>=0 && operations++==fail_after; }
int plat_data_erase(uint32_t off)
{
    CHECK(off>=0x98000 && off+4096<=0xcb000 && !(off&4095));
    if(fail())return -1;memset((void*)plat_data(off),255,4096);return 0;
}
int plat_data_write(uint32_t off,const void *p,uint32_t n)
{
    unsigned i;uint8_t *d=(uint8_t*)plat_data(off);const uint8_t *s=p;
    CHECK(off>=0x98000 && off+n<=0xcb000);
    if(fail())return -1;
    for(i=0;i<n;i++){CHECK((d[i]&s[i])==s[i]);d[i]&=s[i];}return 0;
}
static void saves(void)
{
    unsigned i;int cut;
    memset(flash,255,sizeof flash);
    memset(saved,0x53,sizeof saved);
    CHECK(gg_save_load(restored)==0);
    CHECK(gg_save_write(saved)==0);
    CHECK(gg_save_load(restored)==1 && !memcmp(saved,restored,sizeof saved));
    memcpy(baseline,flash,sizeof flash);
    memset(saved,0x72,sizeof saved);
    for(cut=0;cut<138;cut++) {
        memcpy(flash,baseline,sizeof flash);CHECK(gg_save_load(restored)==1);
        fail_after=cut;operations=0;CHECK(gg_save_write(saved)==-1);fail_after=-1;
        CHECK(gg_save_load(restored)==1);
        for(i=0;i<sizeof restored;i++)CHECK(restored[i]==0x53);
    }
    CHECK(gg_save_write(saved)==0);
    CHECK(gg_save_load(restored)==1 && !memcmp(saved,restored,sizeof saved));
    flash[0xa1000-0x97000+256]^=1;
    CHECK(gg_save_load(restored)==1 && restored[0]==0x53);
    puts("PASS SRAM journal, 138 interrupted erase/write points, corrupt-newest fallback");
}

static void real_rom(const char *dir)
{
    unsigned i, before; uint8_t step[4], *p;
    CHECK(gg_init());CHECK(gg_arena_used()<=120u*1024u);
    run(44100u*4);CHECK(!gg_faulted());CHECK(gg_frames()>230 && gg_frames()<250);
    CHECK(gg_screen()==0);
    tap(16);pad(32);pad(40);pad(32);pad(0);CHECK(gg_screen()==1);
    tap(16);pad(32);pad(40);pad(32);pad(0);CHECK(gg_screen()==2);
    R(PHR_ROW)=0;
    event(GG_NOTE,60);CHECK(R(PHR_ROW)==1);CHECK(at(RAM_PHRASE_POOL)[0]==16);
    CHECK(at(RAM_PHRASE_POOL)[1]==0);CHECK(R(SONG_EDITED)==1);
    CHECK(!gg_playing());CHECK(nonzero>0);
    p=at(RAM_PHRASE_POOL+4);memcpy(step,p,4);
    event(GG_FORWARD,0);CHECK(R(PHR_ROW)==2);CHECK(!memcmp(p,step,4));
    event(GG_BACK,0);event(GG_BACK,0);event(GG_BACK,0);CHECK(R(PHR_ROW)==15);
    event(GG_NOTE,67);CHECK(R(PHR_ROW)==0);CHECK(at(RAM_PHRASE_POOL+60)[0]==23);
    /* Overwrite note, keep the selected cell's instrument and effect columns. */
    p=at(RAM_PHRASE_POOL);p[1]=4;p[2]=11;p[3]=0x23;
    R(PHR_COL)=3;event(GG_NOTE,69);
    CHECK(p[0]==25 && p[1]==4 && p[2]==11 && p[3]==0x23 && R(PHR_COL)==0);
    p[1]=p[2]=p[3]=0;R(LAST_INSTR)=0;
    /* Clear the complete current row, preserve neighbors/cursor, and obey
     * the same screen/selection/navigation guards as keyboard entry. */
    R(PHR_ROW)=15;p=at(RAM_PHRASE_POOL+60);memcpy(step,at(RAM_PHRASE_POOL+56),4);
    p[0]=23;p[1]=4;p[2]=11;p[3]=0x23;R(SONG_EDITED)=0;
    event(GG_CLEAR,0);CHECK(gg_row()==15 && !p[0] && p[1]==255 && !p[2] && !p[3]);
    CHECK(R(SONG_EDITED)==1 && !memcmp(step,at(RAM_PHRASE_POOL+56),4));
    R(SEL_ACTIVE)=1;event(GG_CLEAR,0);CHECK(gg_row()==15);R(SEL_ACTIVE)=0;
    R(SCR_MODE)=0;event(GG_CLEAR,0);CHECK(gg_row()==15);R(SCR_MODE)=2;
    before=gg_row();CHECK(!gg_enqueue(GG_NOTE,44));CHECK(!gg_enqueue(GG_NOTE,156));CHECK(gg_row()==(int)before);
    R(SEL_ACTIVE)=1;event(GG_NOTE,72);CHECK(gg_row()==(int)before);R(SEL_ACTIVE)=0;
    R(SCR_MODE)=0;event(GG_NOTE,72);CHECK(gg_row()==(int)before);R(SCR_MODE)=2;
    for(i=0;i<63;i++)CHECK(gg_enqueue(GG_FORWARD,0));
    CHECK(!gg_enqueue(GG_FORWARD,0));run(44100u*2);CHECK(gg_row()==(int)((before+63)&15));
    CHECK(gg_dropped()==1);
    /* Tone, KIT on each tone channel, and WAV use the ROM's original audition. */
    for(i=0;i<5;i++) {
        unsigned j, type=i==0?0:(i==4?3:2);
        char path[1024];
        R(ED_TRACK)=i==4?2:(i?i-1:0);R(LAST_INSTR)=0;R(PHR_ROW)=0;
        p=at(0xd500);p[0]=type;p[1]=15;p[2]=3;p[3]=1;p[4]=0;
        for(j=0;j<16;j++){uint8_t *s=at(RAM_PHRASE_POOL+j*4);s[0]=0;s[1]=255;s[2]=s[3]=0;}
        peak=nonzero=0;
        snprintf(path,sizeof path,"%s/%s.s16le",dir,i==0?"tone":i==1?"kit-t1":i==2?"kit-t2":i==3?"kit-t3":"wav");
        audio=fopen(path,"wb");CHECK(audio!=0);
        event(GG_NOTE,60);run(22050);fclose(audio);audio=0;
        CHECK(nonzero>100);CHECK(peak>1000 && peak<8388607);CHECK(!gg_faulted());
        printf("PASS %s: peak=%u, nonzero=%u\n",path,peak,nonzero);
    }
    pad(32);pad(48);pad(32);pad(0);CHECK(gg_playing());run(44100u*5);
    pad(32);pad(48);pad(32);pad(0);CHECK(!gg_playing());CHECK(!gg_faulted());
    puts("PASS real v0.48 ROM boot, navigation, RAM step entry, queue, auditions and playback");
}

static uint8_t request[264],answer[GG_MANAGER_REPLY_MAX];
static unsigned sequence,last_request_n;
static void p32(uint8_t *p,uint32_t v){p[0]=v;p[1]=v>>8;p[2]=v>>16;p[3]=v>>24;}
static unsigned command(unsigned op,const void *data,unsigned n)
{
    unsigned got;CHECK(n<=260);request[0]=1;request[1]=op;request[2]=sequence;request[3]=sequence>>8;++sequence;
    if(n)memcpy(request+4,data,n);last_request_n=n+4;
    got=gg_manager_packet(request,n+4,answer,sizeof answer);CHECK(got>=5);return answer[4];
}
static void management(void)
{
    uint8_t args[260],wire[GG_PROFILE_BYTES],bad[264];uint32_t crc,gen;
    unsigned i,off,rc;const uint8_t *rom;gg_profile profile;
    static const int cuts[]={0,8,9,137,138,139,170,171,682,683,684};
    memset(flash,255,sizeof flash);CHECK(gg_manager_boot());run(44100*4);
    CHECK(gg_boot_ready());CHECK(command(GM_INFO,0,0)==GM_OK);
    CHECK(command(GM_STATS,0,0)==GM_OK);CHECK(answer[9]==37 && answer[13]==5);
    R(PLAY_STATE)=1;args[0]=0;CHECK(command(GM_READ_BEGIN,args,1)==GM_PLAYING);R(PLAY_STATE)=0;
    CHECK(command(GM_READ_BEGIN,args,1)==GM_OK);p32(args,GG_SRAM_BYTES);args[4]=1;args[5]=0;
    CHECK(command(GM_READ,args,6)==GM_RANGE);CHECK(command(GM_END,0,0)==GM_OK);
    memset(saved,0x42,sizeof saved);p32(args,GG_SRAM_BYTES);p32(args+4,gg_crc32(saved,sizeof saved));p32(args+8,gg_crc32(gg_sram(),GG_SRAM_BYTES)^1);
    CHECK(command(GM_WRITE_BEGIN,args,12)==GM_STALE);
    p32(args+8,gg_crc32(gg_sram(),GG_SRAM_BYTES));CHECK(command(GM_WRITE_BEGIN,args,12)==GM_OK);
    CHECK(command(GM_WRITE_COMMIT,0,0)==GM_STATE);
    for(off=0;off<GG_SRAM_BYTES;off+=256){p32(args,off);memcpy(args+4,saved+off,256);CHECK(command(GM_WRITE,args,260)==GM_OK);}
    gen=gg_save_generation();CHECK(command(GM_WRITE_COMMIT,0,0)==GM_OK);
    CHECK(gg_manager_packet(request,last_request_n,answer,sizeof answer)>=5&&answer[4]==0);
    CHECK(gg_save_generation()==gen+1);CHECK(!memcmp(saved,gg_sram(),sizeof saved));run(44100*4);
    crc=gg_crc32(gg_sram(),GG_SRAM_BYTES);profile=*gg_builtin_profile();rom=gg_rom_data();gg_profile_encode(wire,&profile);
    wire[99]^=1;CHECK(command(GM_ROM_BEGIN,wire,sizeof wire)==GM_PROFILE);wire[99]^=1;
    memcpy(baseline,flash,sizeof flash);
    for(i=0;i<sizeof cuts/sizeof cuts[0];i++){
        memcpy(flash,baseline,sizeof flash);fail_after=-1;CHECK(gg_manager_boot());run(44100*4);
        operations=0;fail_after=cuts[i];rc=command(GM_ROM_BEGIN,wire,sizeof wire);
        if(!rc)for(off=0;off<profile.rom_size;off+=256){p32(args,off);memcpy(args+4,rom+off,256);rc=command(GM_ROM_WRITE,args,260);if(rc)break;}
        if(!rc)rc=command(GM_ROM_COMMIT,0,0);
        CHECK(rc==GM_FLASH);fail_after=-1;
        /* Simulated reboot, rather than a graceful abort, tests the on-flash commit order. */
        CHECK(gg_manager_boot());CHECK(!gg_manager_external());CHECK(gg_crc32(gg_sram(),GG_SRAM_BYTES)==crc);
    }
    run(44100*4);CHECK(command(GM_READ_BEGIN,(uint8_t[]){0},1)==GM_OK);
    simulated_ms+=6000;gg_manager_tick(simulated_ms);CHECK(!gg_manager_busy());
    for(i=0;i<2000;i++){
        unsigned n=i%265;for(off=0;off<n;off++)bad[off]=(uint8_t)(i*71+off*19);
        if(n)bad[0]=1;
        CHECK(gg_manager_packet(bad,n,answer,sizeof answer)<=sizeof answer);
    }
    puts("PASS manager bounds/leases/retries and 11 ROM erase/data/metadata interruption points under UBSan");
}
int main(int argc,char **argv)
{
    if(argc!=2)return 2;
    tables();saves();real_rom(argv[1]);management();
    printf("PASS %u checks; emulator arena %u bytes; frames %u\n",checks,gg_arena_used(),gg_frames());
    return 0;
}
