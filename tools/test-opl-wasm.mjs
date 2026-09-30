// tools/test-opl-wasm.mjs — sanity: boot chip, play a note, check output energy
import { readFileSync } from 'fs';

export async function loadOpl() {
  const bytes = readFileSync(new URL('../src/opl2.wasm', import.meta.url));
  const mod = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: new Proxy({}, { get: () => (() => -1) }) });
  return mod.instance.exports;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^\.\//, ''))) {
  const ex = await loadOpl();
  ex.opl_create(44100);
  const r = (reg, val) => ex.opl_write_reg(reg, val);
  // FM instrument on channel 0 (OPL2 2-op): mod at op0 (reg 0x20+0), carrier at op3 (0x20+3)
  r(0x01, 0x20);   // waveforms enabled (OPL2 requires bit5 for waveFormMask)
  r(0x20, 0x01); r(0x40, 0x30); r(0x60, 0xF0); r(0x80, 0xF5); r(0xE0, 0x00);
  r(0x23, 0x05); r(0x43, 0x20); r(0x63, 0xF5); r(0x83, 0xF5); r(0xE3, 0x00);
  r(0xC0, 0x01);                    // C0 bit0 clear = FM; feedback 0
  r(0xA0, 0x34); r(0xB0, 0x0C);     // fnum 52, block 3 (~220 Hz)
  r(0xB0, 0x0C | 0x20);             // key on
  const N = 44100;
  const ptr = ex.malloc(N * 4);
  ex.opl_generate(ptr, N);
  const buf = new Int32Array(ex.memory.buffer, ptr, N);
  let peak = 0, zc = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
  for (let i = 1; i < N; i++) if ((buf[i - 1] < 0) !== (buf[i] < 0)) zc++;
  console.log('key-on: peak', peak, '~Hz', Math.round(zc / 2));
  if (peak < 100) throw new Error('chip silent on key-on');
  r(0xB0, 0x0C);                     // key off
  ex.opl_generate(ptr, N * 3);
  let peak2 = 0;
  for (let i = 0; i < N; i++) peak2 = Math.max(peak2, Math.abs(buf[i]));
  console.log('peak 1s after release+2s', peak2);
  if (peak2 > 128) throw new Error('chip not releasing');
  console.log('OPL2 WASM OK');
}
