#!/usr/bin/env python3
"""One-time reproducible import of the user's working Waveshare SMS Plus core.

The resulting vendor tree is checked in; normal builds do not need the old project.
Original per-file licences apply, including the Z80 non-commercial notice.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]).resolve()
dest = APP / 'vendor/smsplus'
files = ['COPYING', 'CREDITS', 'PORTING', 'shared.h', 'hvc.h',
         'memz80.c', 'memz80.h', 'pio.c', 'pio.h', 'render.c', 'render.h',
         'sms.c', 'sms.h', 'system.c', 'system.h', 'tms.c', 'tms.h',
         'vdp.c', 'vdp.h', 'state.h', 'loadrom.h',
         'cpu/z80.c', 'cpu/z80.h', 'cpu/cpuintrf.h', 'cpu/osd_cpu.h',
         'sound/sn76489.c', 'sound/sn76489.h', 'sound/sound.c', 'sound/sound.h',
         'sound/emu2413.h', 'sound/ym2413.h', 'sound/fmintf.h']
original = {}
for name in files:
    data = (source / name).read_bytes()
    original[name] = hashlib.sha256(data).hexdigest()
    (dest / name).parent.mkdir(parents=True, exist_ok=True)
    (dest / name).write_bytes(data)

p = dest / 'shared.h'
s = p.read_text().replace('#define LOG_PRINTF(level, x...) printf(x)', '#define LOG_PRINTF(level, x...) ((void)0)')
s = s.replace('#include "cpu/z80.h"', '#include "memory.h"\n#include "cpu/z80.h"')
p.write_text(s)

# 256 KiB arithmetic tables become their original generating equations.
p = dest / 'cpu/z80.c'
s = p.read_text()
s = s.replace('static UINT8 *SZHVC_add = 0;\nstatic UINT8 *SZHVC_sub = 0;', '''/* FM1: same flag equations as the upstream table generator, no 256 KiB heap. */
static inline UINT8 fmgg_flags(unsigned key, int sub)
{
    int oldval = (key >> 8) & 255, newval = key & 255, carry = (key >> 16) & 1;
    int val = sub ? oldval - newval - carry : newval - oldval - carry;
    UINT8 f = (newval & 0xA8) | (newval ? 0 : ZF) | (sub ? NF : 0);
    if (sub ? ((newval & 15) + carry > (oldval & 15))
            : ((newval & 15) < (oldval & 15) + carry)) f |= HF;
    if (sub ? (newval + carry > oldval) : (newval < oldval + carry)) f |= CF;
    if (sub ? ((val ^ oldval) & (oldval ^ newval) & 128)
            : ((val ^ oldval ^ 128) & (val ^ newval) & 128)) f |= VF;
    return f;
}''')
s = re.sub(r'SZHVC_add\[([^\]]+)\]', r'fmgg_flags(\1, 0)', s)
s = re.sub(r'SZHVC_sub\[([^\]]+)\]', r'fmgg_flags(\1, 1)', s)
a = s.index('  if( !SZHVC_add || !SZHVC_sub )')
b = s.index('  for (i = 0; i < 256; i++)', a)
s = s[:a] + s[b:]
a = s.index('void z80_exit(void)')
b = s.index('/****************************************************************************', a)
s = s[:a] + 'void z80_exit(void) {}\n\n' + s[b:]
s = s.replace('      R++;\n      EXEC_OP(ROP());', '      if (PC == fmgg_editor_pc || PC == fmgg_engine_pc) fmgg_instruction(PC);\n      R++;\n      EXEC_OP(ROP());')
s = '/* FM1 port: compact arithmetic flags and RAM adapter hook; original notice retained below. */\n' + s
p.write_text(s)

# 320 KiB rendering tables become a 1 KiB bit-expansion table and pixel logic.
p = dest / 'render.c'
s = p.read_text()
s = s.replace('static const uint8 *lut; // )[0x10000];', '''static inline uint8 fmgg_pixel(uint8 bg, uint8 sp)
{
    if (bg & 0x40) return bg & 0x7F;
    if ((bg & 0x20) && (bg & 15)) return (bg & 0x7F) | 0x40;
    return (sp & 15) ? ((sp & 15) | 0x50) : (bg & 0x7F);
}''')
s = s.replace('static const uint32 *bp_lut; // 0x10000', 'static uint32 fmgg_expand[256];')
a = s.index('  /* Generate 64k of data for the look up table */')
b = s.index('  sms_cram_expand_table[0]', a)
s = s[:a] + '''  for (i = 0; i < 256; ++i) {
    uint32 out = 0;
    for (j = 0; j < 8; ++j)
      if (i & (0x80 >> j)) out |= UINT32_C(1) << (j * 4);
    fmgg_expand[i] = out;
  }
\n''' + s[b:]
s = s.replace('    const uint16* ptr = (uint16*)&vdp.vram[(name << 5) | (y << 2) | (0)];\n    const uint32 temp = (bp_lut[*ptr] >> 2) | (bp_lut[*(ptr+1)]);', '''    const uint8 *ptr = &vdp.vram[(name << 5) | (y << 2)];
    const uint32 temp = fmgg_expand[ptr[0]] | (fmgg_expand[ptr[1]] << 1)
                      | (fmgg_expand[ptr[2]] << 2) | (fmgg_expand[ptr[3]] << 3);''')
s = s.replace('lut[(bg << 8) | (sp)]', 'fmgg_pixel(bg, sp)')
p.write_text(s)

# Incremental scanline execution: audio callbacks never run an entire 16.7 ms frame.
p = dest / 'system.c'
s = p.read_text()
a = s.index('/* Run the virtual console emulation for one frame */')
b = s.index('void system_reset_config()', a)
s = s[:a] + '''/* FM1: one scanline at a time, with the original IRQ/PSG ordering. */
static int fmgg_line, fmgg_line_cycles;
int system_step_line(int skip)
{
  int iline = vdp.height;
  if (!fmgg_line) {
    sound_begin_frame();
    render_mode(skip);
    text_counter = 0;
    vdp.vscroll = vdp.reg[9];
    vdp.left = vdp.reg[0x0A];
    vdp.spr_col = 0xff00;
    fmgg_line_cycles = 0;
  }
  vdp.line = fmgg_line;
  if (!skip) render_line(vdp.line);
  if (sms.console >= CONSOLE_SMS && vdp.line <= iline && --vdp.left < 0) {
    vdp.left = vdp.reg[0x0A];
    vdp.hint_pending = 1;
    if (vdp.reg[0] & 0x10) {
      if (!(z80_get_elapsed_cycles() % CYCLES_PER_LINE)) z80_execute(1);
      z80_set_irq_line(0, ASSERT_LINE);
    }
  }
  fmgg_line_cycles += CYCLES_PER_LINE;
  z80_execute(fmgg_line_cycles - z80_cycle_count);
  if (vdp.line == iline) {
    vdp.status |= 0x80;
    vdp.vint_pending = 1;
    if (vdp.reg[1] & 0x20) z80_set_irq_line(vdp.irq, ASSERT_LINE);
  }
  sound_update(vdp.line);
  if (++fmgg_line == vdp.lpf) {
    z80_cycle_count -= fmgg_line_cycles;
    fmgg_line = 0;
    return 1;
  }
  return 0;
}
void system_frame(int skip) { while (!system_step_line(skip)) {} }
void system_reset_line(void) { fmgg_line = fmgg_line_cycles = 0; }
\n''' + s[b:]
s = s.replace('  sms_reset();', '  system_reset_line();\n  sms_reset();')
p.write_text(s)

# Remove application-name collisions; the core is compiled separately.
p = dest / 'system.h'
s = p.read_text().replace('#define APP_NAME            "SMS Plus"', '').replace('#define APP_VERSION         "1.3"', '')
s += '\nint system_step_line(int skip);\nvoid system_reset_line(void);\n'
p.write_text(s)

# The supported <=48 kHz / PAL-or-NTSC sample clock fits 32 bits. Avoid software
# int64 division and the documented pi32v2 multiply/load hazard.
p = dest / 'sound/sound.c'
s = p.read_text().replace(' * Output remains 48 kHz with the original lightweight PSG synthesizer.',
                         ' * FM1: output is 44.1 kHz; use bounded 32-bit sample-clock arithmetic.')
s = s.replace('((uint64_t)frame_cycles * snd.sample_rate', '((uint32_t)frame_cycles * snd.sample_rate')
s = s.replace('    /* 64-bit division only once per frame. A rational remainder avoids drift. */\n    uint64_t ticks = frame_phase + (uint64_t)frame_cycles * snd.sample_rate;',
              '    /* Maximum PAL frame * 48 kHz + remainder fits uint32_t. */\n    uint32_t ticks = frame_phase + (uint32_t)frame_cycles * snd.sample_rate;')
p.write_text(s)

(APP / 'vendor/provenance.json').write_text(json.dumps({
    'source': 'https://github.com/ducalex/retro-go',
    'revision': '4ced120669750ca7228fd0414211430c1d923166',
    'inherited_port': 'smsggdj-waveshare, September 2026, write-timed PSG and portable renderer',
    'original_sha256': original,
    'imported_sha256': {f: hashlib.sha256((dest/f).read_bytes()).hexdigest() for f in files},
    'rom_modified': False,
}, indent=2) + '\n')
print('Imported SMS Plus; RAM tables replaced, scanline stepping and instruction hook added.')
