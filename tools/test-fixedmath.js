// FixedMul/FixedDiv/SlopeDiv fidelity fuzz: JS engine vs gospel C semantics
// ((long long)a*b)>>FRACBITS with arithmetic-shift floor; ((long long)a<<16)/b
// with C truncation-toward-zero; SlopeDiv = (num<<3)/(den>>8) unsigned.
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Buffer });
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js)
for (const f of ['src/tables.js', 'src/engine.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const FM = ctx.FixedMul, FD = ctx.FixedDiv, SD = ctx.SlopeDiv;
const FU = 65536;

function cFixedMul(a, b) { return Number(BigInt(a | 0) * BigInt(b | 0) >> 16n) | 0; }
function cFixedDiv(a, b) {
  if (((Math.abs(a) >> 14) >= Math.abs(b)) | 0) return ((a ^ b) < 0) ? -2147483648 : 2147483647;
  return Number((BigInt(a | 0) << 16n) / BigInt(b | 0)) | 0;   // C int div truncs toward 0
}
function cSlopeDiv(num, den) {
  num = num >>> 0; den = den >>> 0;
  if (den < 512) return 2048;
  const ans = Math.floor(num * 8 / (den >>> 8));   // exact: den>>8 is an int, num*8 exact in f64
  return ans <= 2048 ? ans : 2048;
}

let mbad = 0, ms = [];
const mvals = [-1, 1, -65536, 65536, -47000, 47000, -FU * 10, FU * 10, -12345, 12345,
               2048, -2048, 0x7fffffff, -2147483647];
for (let a = -3000000; a <= 3000000; a += 1013) {
  for (const b of mvals) {
    const j = FM(a, b), c = cFixedMul(a, b);
    if (j !== c) { mbad++; if (ms.length < 5) ms.push([a, b, j, c]); }
  }
}
console.log('FixedMul mismatches:', mbad, JSON.stringify(ms));

let fbad = 0, fsx = [];
const dvals = [-3, -7, 49151, 49152, -49151, -65537, 32767, -32768, 99991, 1, -1];
for (let a = -3000000; a <= 3000000; a += 1013) {
  for (const b of dvals) {
    const j = FD(a, b), c = cFixedDiv(a, b);
    if (j !== c) { fbad++; if (fsx.length < 5) fsx.push([a, b, j, c]); }
  }
}
console.log('FixedDiv mismatches:', fbad, JSON.stringify(fsx));

let sbad = 0, ss = [];
for (let num = 0; num < 0x10000000; num += 7919) {
  for (const den of [512, 513, 100000, 16777216, 4294967295, 999999]) {
    const j = SD(num, den), c = cSlopeDiv(num, den);
    if (j !== c) { sbad++; if (ss.length < 5) ss.push([num, den, j, c]); }
  }
}
console.log('SlopeDiv mismatches:', sbad, JSON.stringify(ss));
process.exit(mbad || fbad || sbad ? 1 : 0);
