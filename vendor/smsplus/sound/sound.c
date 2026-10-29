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
 *   Sound emulation.
 *
 ******************************************************************************/

/* Waveshare port: sample-clock pacing and optional write-time synchronization.
 * FM1: output is 44.1 kHz; use bounded 32-bit sample-clock arithmetic.
 * Times are quantized to output samples; this is not cycle-exact analogue audio.
 */
#include "shared.h"

snd_t snd;
static unsigned frame_phase;
static unsigned next_phase;
static int frame_cycles;
static int capacity;
static int sync_writes = 1;

void sound_set_write_sync(int enabled) { sync_writes = enabled != 0; }

int sound_init(void)
{
    if (snd.enabled) sound_shutdown();
    snd.psg_clock = sms.display == DISPLAY_NTSC ? CLOCK_NTSC : CLOCK_PAL;
    snd.fm_clock = snd.psg_clock;
    snd.sample_rate = option.sndrate;
    snd.fps = sms.display == DISPLAY_NTSC ? 60 : 50;
    frame_cycles = CYCLES_PER_LINE * (sms.display == DISPLAY_NTSC ? 262 : 313);
    if (snd.sample_rate < 8000 || snd.sample_rate > 48000) return 0;
    capacity = ((uint32_t)frame_cycles * snd.sample_rate / snd.psg_clock) + 2;
    snd.buffer_size = capacity * sizeof(int16);
    for (int i = 0; i < STREAM_MAX; ++i) {
        snd.stream[i] = calloc(capacity, sizeof(int16));
        if (!snd.stream[i]) abort();
    }
    SN76489_Init(0, snd.psg_clock, snd.sample_rate);
    SN76489_Config(0, MUTE_ALLON, BOOST_OFF, VOL_FULL, FB_SEGAVDP);
    snd.enabled = 1;
    sound_reset();
    return 1;
}

void sound_reset(void)
{
    if (!snd.enabled) return;
    frame_phase = next_phase = 0;
    snd.done_so_far = snd.sample_count = 0;
    SN76489_Reset(0);
}

void sound_shutdown(void)
{
    for (int i = 0; i < STREAM_MAX; ++i) {
        free(snd.stream[i]);
        snd.stream[i] = NULL;
    }
    SN76489_Shutdown();
    snd.enabled = 0;
}

void sound_begin_frame(void)
{
    if (!snd.enabled) return;
    frame_phase = next_phase;
    /* Maximum PAL frame * 48 kHz + remainder fits uint32_t. */
    uint32_t ticks = frame_phase + (uint32_t)frame_cycles * snd.sample_rate;
    snd.sample_count = ticks / snd.psg_clock;
    next_phase = ticks % snd.psg_clock;
    snd.done_so_far = 0;
    assert(snd.sample_count <= capacity);
}

static void sound_until(int cycle)
{
    if (!snd.enabled) return;
    if (cycle < 0) cycle = 0;
    if (cycle > frame_cycles) cycle = frame_cycles;
    /* Fits uint32_t for <= 48000 Hz and both supported video timings. */
    unsigned ticks = frame_phase + (unsigned)cycle * (unsigned)snd.sample_rate;
    int target = ticks / snd.psg_clock;
    if (target > snd.sample_count) target = snd.sample_count;
    if (target <= snd.done_so_far) return;
    int16 *buffers[2] = {snd.stream[0] + snd.done_so_far,
                        snd.stream[1] + snd.done_so_far};
    SN76489_Update(0, buffers, target - snd.done_so_far);
    snd.done_so_far = target;
}

void sound_update(int line)
{
    /* CPU instructions may straddle a line/frame boundary. Never rewind sound. */
    sound_until(z80_get_elapsed_cycles());
    if (line == (sms.display == DISPLAY_NTSC ? 261 : 312))
        sound_until(frame_cycles);
}

void psg_write(int data)
{
    if (!snd.enabled) return;
    if (sync_writes) sound_until(z80_get_elapsed_cycles());
    SN76489_Write(0, data);
}

void psg_stereo_w(int data)
{
    if (!snd.enabled) return;
    if (sync_writes) sound_until(z80_get_elapsed_cycles());
    SN76489_GGStereoWrite(0, data);
}

void sound_mixer_callback(int16 **stream, int16 **output, int length)
{
    for (int i = 0; i < length; ++i) {
        output[0][i] = stream[0][i];
        output[1][i] = stream[1][i];
    }
}

/* Optional GGFM and external link synchronization are outside this port. */
int fmunit_detect_r(void) { return 0; }
void fmunit_detect_w(int data) { (void)data; }
void fmunit_write(int offset, int data) { (void)offset; (void)data; }
void stream_update(int which, int position) { (void)which; (void)position; }
