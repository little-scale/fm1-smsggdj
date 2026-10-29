/* SPDX-License-Identifier: MIT */
#pragma once
#include <stddef.h>
#include <stdint.h>
#include "ram_map.h"
#include "profile.h"
void *fmgg_malloc(size_t n);
void *fmgg_calloc(size_t n, size_t size);
void fmgg_free(void *p);
void fmgg_fault(void);
static inline int fmgg_abs(int x) { return x < 0 ? -x : x; }
void fmgg_instruction(uint16_t pc);
#define malloc fmgg_malloc
#define calloc fmgg_calloc
#define free fmgg_free
#define abs fmgg_abs
#undef assert
#define assert(test) ((test) ? (void)0 : fmgg_fault())
#define abort() fmgg_fault()
