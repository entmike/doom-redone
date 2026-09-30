// Minimal dosbox.h shim so dbopl.cpp compiles standalone (WASM build).
#ifndef DOSBOX_DOSBOX_H
#define DOSBOX_DOSBOX_H
#include <cstdint>
#include <cstddef>
typedef uint32_t Bitu;
typedef int32_t  Bits;
#define GCC_UNLIKELY(x) (__builtin_expect(!!(x), 0))
#define GCC_UNLIKELY_UNUSED
#endif
