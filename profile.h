/* SPDX-License-Identifier: MIT */
#pragma once
#include <stdint.h>
#define GG_PROFILE_BYTES 100u
#define GG_ROM_MAX 131072u
#define GG_PROFILE_MAGIC 0x31504747u
enum {
    GG_A_EDITOR_INPUT, GG_A_ENGINE_FRAME, GG_A_SCR_MODE, GG_A_ED_TRACK,
    GG_A_CUR_CHAIN, GG_A_CUR_PHRASE, GG_A_CUR_INSTR, GG_A_PHR_ROW, GG_A_PHR_COL,
    GG_A_LAST_NOTE, GG_A_LAST_INSTR, GG_A_PHRASE_POOL, GG_A_SONG_EDITED,
    GG_A_DIRTY_ROWS, GG_A_SEL_ACTIVE, GG_A_DT1_TIMER, GG_A_TP_DT, GG_A_PLAY_STATE,
    GG_A_PAD_RAW, GG_A_PAD_PREV, GG_A_PAD_EDGE, GG_A_PAD_REP, GG_A_DAS_TIMER,
    GG_A_KEY_DELAY, GG_A_KEY_SPEED, GG_ADDRESS_COUNT
};
typedef struct {
    uint32_t magic, rom_size, rom_crc, code_crc;
    uint16_t address[GG_ADDRESS_COUNT], phrases;
    uint8_t midi_low, midi_high, instruments, reserved;
    char name[24];
} gg_profile;
extern uint16_t fmgg_editor_pc, fmgg_engine_pc;
const gg_profile *gg_builtin_profile(void);
int gg_profile_valid(const gg_profile *p);
int gg_profile_decode(gg_profile *p, const uint8_t wire[GG_PROFILE_BYTES]);
void gg_profile_encode(uint8_t wire[GG_PROFILE_BYTES], const gg_profile *p);
