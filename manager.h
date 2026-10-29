/* SPDX-License-Identifier: MIT */
#pragma once
#include <stdint.h>
#define GG_MANAGER_CMD 0x66u
#define GG_MANAGER_REPLY_MAX 272u
enum { GM_INFO=1, GM_READ_BEGIN, GM_READ, GM_END, GM_WRITE_BEGIN, GM_WRITE,
       GM_WRITE_COMMIT, GM_ROM_BEGIN, GM_ROM_WRITE, GM_ROM_COMMIT, GM_ABORT, GM_BUILTIN };
enum { GM_OK, GM_BAD, GM_PLAYING, GM_BUSY, GM_RANGE, GM_CRC, GM_FLASH, GM_STALE, GM_PROFILE, GM_STATE, GM_BOOTING };
int gg_manager_boot(void);
uint32_t gg_manager_packet(const uint8_t *,uint32_t,uint8_t *,uint32_t);
uint32_t gg_manager_usb(const uint8_t *,uint32_t,uint8_t *,uint32_t);
void gg_manager_tick(uint32_t now);
int gg_manager_busy(void);
uint8_t *gg_manager_buffer(void);
uint32_t gg_manager_revision(void);
int gg_manager_external(void);
