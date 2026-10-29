/* Tests the compact core against the inherited table's full input domain. */
#include "../vendor/smsplus/cpu/z80.c"
unsigned gg_test_flags(unsigned key, int sub) { return fmgg_flags(key, sub); }

/* Check instruction-boundary rounding, refresh wrap, masked IRQs, the EI
 * shadow, and IRQ/NMI wake-up without depending on the tracker program. */
int gg_test_halt(void)
{
    static unsigned char code[1024] = {0x76};
    unsigned cycles, masked, i;
    uint16_t editor = fmgg_editor_pc, engine = fmgg_engine_pc;
    fmgg_editor_pc = 0xfffd; fmgg_engine_pc = 0xfffe;
    for (i = 0; i < 64; ++i) cpu_readmap[i] = code;
    for (masked = 0; masked < 2; ++masked) for (cycles = 1; cycles <= 512; ++cycles) {
        unsigned repeats = (cycles + 3) / 4;
        z80_init(0,0,0,0); z80_reset();
        HALT = 1; R = 254; Z80.irq_state = masked ? ASSERT_LINE : CLEAR_LINE;
        if (z80_execute(cycles) != (int)(repeats * 4) || !HALT || PC != 0 || R != (UINT8)(254 + repeats)) return 0;
    }
    for (i = 0; i < 2; ++i) {
        z80_init(0,0,0,0); z80_reset();
        HALT=1; IFF1=IFF2=1; IM=1; Z80.irq_state=ASSERT_LINE; Z80.after_ei=i;
        if (z80_execute(13) != (int)(13 + 4*i) || HALT || PC != 0x38 || IFF1 || R != i) return 0;
    }
    z80_init(0,0,0,0); z80_reset();HALT=1;Z80.nmi_pending=1;
    if (z80_execute(11) != 11 || HALT || PC != 0x66 || Z80.nmi_pending) return 0;
    fmgg_editor_pc=editor;fmgg_engine_pc=engine;
    return 1;
}
