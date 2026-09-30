// C wrapper around DBOPL::Chip for the DOOM JS port (WASM build).
// OPL2-only (YM3812) — exactly what DMX/OPL music in vanilla DOOM used.
#include <cstdint>
#include <cstring>
#include "dbopl.h"
namespace DBOPL { void InitTables(void); }

static DBOPL::Chip* g_chip = 0;

extern "C" {

void opl_create(uint32_t rate) {
    if (!g_chip) g_chip = new DBOPL::Chip(false /*opl2*/);
    DBOPL::InitTables();
    g_chip->Setup(rate);
    // Setup() clears regs but in OPL2 mode nothing ever writes 0x104/0x105,
    // so synth handlers stay NULL unless we prime them explicitly.
    g_chip->UpdateSynths();
    // Setup()'s OPL2 clear loop stops at reg 0xFE — 0x01 is never written,
    // which leaves waveFormMask=0 (all waveforms silent). Real init sequence
    // (BIOS/DMX) writes 0x20 here; that enables waveforms 0-7 mask.
    g_chip->WriteReg(0x01, 0x20);
}

uint32_t opl_write_addr(uint32_t port, uint8_t val) {
    return g_chip->WriteAddr(port, val);
}

void opl_write_reg(uint32_t reg, uint8_t val) {
    g_chip->WriteReg(reg, val);
}

// Generate `samples` mono OPL2 samples as int32 into buf.
void opl_generate(int32_t* buf, uint32_t samples) {
    g_chip->GenerateBlock2(samples, buf);
}

// For JS-side sanity checks
uint32_t opl_chip_size() { return (uint32_t)sizeof(DBOPL::Chip); }

}

void* opl_chip_ptr() { return (void*)g_chip; }

// Debug: dump interesting state to out[]: [waveFormMask, opl3Active, chan0.synthHandler!=null, chan0.regB0, chan0.regC0, op0.volume, op0.waveMode, op0.operand, op3.sustain, ...]
extern "C" void opl_dbg2(uint32_t* out) {
    DBOPL::Channel* c = &g_chip->chan[0];
    out[0] = (uint32_t)(uintptr_t)c->op[0].waveBase;
    out[1] = c->op[1].waveAdd;
    out[2] = (uint32_t)c->old[0];
    out[3] = (uint32_t)c->old[1];
    out[4] = c->op[1].waveIndex;
    out[5] = c->op[0].waveIndex;
    out[6] = c->op[1].waveCurrent;
    out[7] = c->op[1].currentLevel;
    out[8] = c->op[1].totalLevel;
    out[9] = c->op[1].volume;
    out[10] = c->op[1].state;
    out[11] = c->op[1].rateZero;
}
