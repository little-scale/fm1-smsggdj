#include "../vendor/smsplus/render.c"
unsigned gg_test_pixel(unsigned bg, unsigned sp) { return fmgg_pixel(bg, sp); }

int gg_test_tile_cache(void)
{
    static uint8 test_vram[16384];
    uint8 *saved_vram = vdp.vram;
    unsigned i, j, name, row, flips, pass, x, plane;
    uint32 state = 0x53454741u;
    vdp.vram=test_vram;
    for(i=0;i<256;i++) {
        uint32 bits=0;
        for(j=0;j<8;j++)if(i&(0x80u>>j))bits|=1u<<(j*4);
        fmgg_expand[i]=bits;
    }
    for(i=0;i<sizeof test_vram;i++) {
        state^=state<<13;state^=state>>17;state^=state<<5;test_vram[i]=(uint8)state;
    }
    for(pass=0;pass<3;pass++)for(name=0;name<512;name++)for(row=0;row<8;row++)for(flips=0;flips<4;flips++) {
        unsigned attr=name|((flips&1)?0x200:0)|((flips&2)?0x400:0);
        unsigned sy=(flips&2)?row^7u:row;
        if(pass==2)test_vram[(name*32+sy*4)+(row&3)]^=0x81;
        uint8 *got=tile_get(attr,row);
        for(x=0;x<8;x++) {
            unsigned sx=(flips&1)?x^7u:x, expected=0;
            for(plane=0;plane<4;plane++)expected|=((test_vram[name*32+sy*4+plane]>>(7-sx))&1u)<<plane;
            if(got[x]!=expected)return 0;
        }
    }
    /* 8x16 sprites address the second tile with line 8..15. */
    for(name=0;name<512;name+=2)for(row=8;row<16;row++) {
        uint8 *got=tile_get(name,row);
        unsigned address=(name<<5)|(row<<2);
        for(x=0;x<8;x++) {
            unsigned expected=0;
            for(plane=0;plane<4;plane++)expected|=((test_vram[address+plane]>>(7-x))&1u)<<plane;
            if(got[x]!=expected)return 0;
        }
    }
    vdp.vram=saved_vram;
    return 1;
}
