/* Modified for the Waveshare smsggdj port; see THIRD_PARTY.md. */
/******************************************************************************
 *  Sega Master System / GameGear Emulator
 *  Copyright (C) 1998-2007  Charles MacDonald
 *
 *  additionnal code by Eke-Eke (SMS Plus GX)
 *
 *   This program is free software; you can redistribute it and/or modify
 *   it under the terms of the GNU General Public License as published by
 *   the Free Software Foundation; either version 2 of the License, or
 *   (at your option) any later version.
 *
 *   This program is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU General Public License for more details.
 *
 *   You should have received a copy of the GNU General Public License
 *   along with this program; if not, write to the Free Software
 *   Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
 *
 *   Sega Master System manager
 *
 ******************************************************************************/

#include "shared.h"

smsplus_t smsplus;

/* FM1: one scanline at a time, with the original IRQ/PSG ordering. */
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

void system_reset_config()
{
  option.sndrate      = 48000;
  option.country      = 0;
  option.console      = 0;
  option.fm           = SND_NONE;
  option.overscan     = 1;
  option.xshift       = 0;
  option.yshift       = 0;
  option.xscale       = 0;
  option.yscale       = 0;
  option.aspect       = 1;
  option.render       = 0;
  option.ntsc         = 0;
  option.tv_mode      = 0;
  option.sms_pal      = 1;
  option.tms_pal      = 0;
  option.spritelimit  = 1;
  option.extra_gg     = 0;
}

static void system_init2(void)
{
  sms_init();
  pio_init();
  vdp_init();
  render_init();
  sound_init();
}

void system_shutdown(void)
{
  sms_shutdown();
  pio_shutdown();
  vdp_shutdown();
  render_shutdown();
  sound_shutdown();
}

void system_reset(void)
{
  system_reset_line();
  sms_reset();
  pio_reset();
  vdp_reset();
  render_reset();
  sound_reset();
}

void system_poweron(void)
{
  system_init2();
  system_reset();
}

void system_poweroff(void)
{
  //
}
