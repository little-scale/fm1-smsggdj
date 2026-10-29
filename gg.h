/* SPDX-License-Identifier: MIT */
#pragma once
#include <stdint.h>
#include "profile.h"
#define GG_SRAM_BYTES 32768u
#define GG_RATE 44100u
#define GG_VIEW_W 160u
#define GG_VIEW_H 144u
enum { GG_NOTE, GG_FORWARD, GG_BACK };
int gg_init(void);
void gg_render(int32_t *lr, uint32_t n, uint32_t gain);
void gg_set_pad(uint8_t mask);
int gg_enqueue(unsigned action, unsigned midi);
const uint8_t *gg_picture(void);
const uint16_t *gg_palette(void);
uint32_t gg_frames(void);
uint32_t gg_dropped(void);
unsigned gg_arena_used(void);
int gg_faulted(void);
int gg_screen(void);
int gg_row(void);
int gg_playing(void);
uint8_t *gg_sram(void);
uint8_t *gg_ram(void); /* diagnostics/tests: never called concurrently with emulation */
void gg_hold(int on);
void gg_unhold(void);
const gg_profile *gg_current_profile(void);
const uint8_t *gg_rom_data(void);
int gg_use_rom(const uint8_t *, uint32_t, const gg_profile *);
int gg_boot_ready(void);
