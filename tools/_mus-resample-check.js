// Verify the music resampler change numerically: simulate the exact
// onAudioProcess phase-walk for chipRate=49716 -> device 44100 and 48000,
// with a 440 Hz test tone, and compare ZOH vs linear-interp against the
// ideal continuous sine (aliasing RMS).
'use strict';
const CHIP = 49716, F = 440;
function run(device, interp) {
  let musPhase = 0, prev = 0, next = 0, err2 = 0, n = 0, i1 = 0;
  const pull = () => { prev = next; next = Math.sin(2 * Math.PI * F * (++i1) / CHIP); };
  pull(); // prime at chip sample 0? our code primes sample 0; ideal grid below
  // emulate: at output index i, chip index floor(total) is `prev`
  let chipIdx = 0;
  const primed = () => { const s0 = Math.sin(2*Math.PI*F*chipIdx/CHIP); const s1 = Math.sin(2*Math.PI*F*(chipIdx+1)/CHIP); return [s0, s1]; };
  prev = 0; next = 0; chipIdx = -1; pull2();
  function pull2() { chipIdx++; prev = next; next = Math.sin(2 * Math.PI * F * (chipIdx + 1) / CHIP); }
  // walk 2 seconds of output at device rate
  const N = device * 2;
  for (let i = 0; i < N; i++) {
    musPhase += CHIP;
    while (musPhase >= device) { musPhase -= device; pull2(); }
    const frac = musPhase / device;
    const outv = interp ? prev + (next - prev) * frac : prev;
    // ideal value at the sample time: total chip advance = (i+1)*CHIP/device
    const t = (i + 1) * CHIP / device / CHIP; // seconds in chip units? -> seconds
    const ideal = Math.sin(2 * Math.PI * F * ((i + 1) / device));
    const e = outv - ideal;
    err2 += e * e; n++;
  }
  return Math.sqrt(err2 / n);
}
console.log('device 44100  ZOH RMS err:', run(44100, false).toFixed(4), ' interp:', run(44100, true).toFixed(4));
console.log('device 48000  ZOH RMS err:', run(48000, false).toFixed(4), ' interp:', run(48000, true).toFixed(4));
console.log('device 49716  ZOH RMS err:', run(49716, false).toFixed(4), ' interp:', run(49716, true).toFixed(4));
