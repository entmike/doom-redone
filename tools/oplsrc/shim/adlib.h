// Minimal adlib.h shim: dbopl.h only needs the Adlib::Handler / MixerChannel
// names to exist; the WASM wrapper drives Chip directly, so the Handler
// vtable just needs to compile.
#ifndef DOSBOX_ADLIB_H
#define DOSBOX_ADLIB_H
#include "dosbox.h"
#include <ostream>
#include <istream>
struct MixerChannel {
    void AddSamples_m32(Bitu, int32_t*) {}
    void AddSamples_s32(Bitu, int32_t*) {}
};
namespace Adlib {
struct Handler {
    virtual ~Handler() {}
    virtual uint32_t WriteAddr(uint32_t, uint8_t) { return 0; }
    virtual void WriteReg(uint32_t, uint8_t) {}
    virtual void Generate(MixerChannel *, Bitu) {}
    virtual void Init(Bitu) {}
    virtual void SaveState(std::ostream &) {}
    virtual void LoadState(std::istream &) {}
};
}
#endif
