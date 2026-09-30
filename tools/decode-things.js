// Decode missing doomednums -> info.c entry (name, spawnstate sprite, flags)
const fs = require('fs');
const src = fs.readFileSync('reference/linuxdoom-1.10/info.c', 'utf8');
const missing = process.argv[2].split(',').map(Number);
const re = /\{\s*\/\/\s*(MT_[A-Z0-9_]+)\s*\n\s*(-?\d+),\s*\/\/\s*doomednum\s*\n\s*(S_[A-Z0-9_]+),/g;
let m, table = {};
while ((m = re.exec(src))) table[+m[2]] = { name: m[1], spawn: m[3] };
// flags: last two ints before raisestate — crude: capture whole entry
const ent = /\{\s*\/\/\s*(MT_[A-Z0-9_]+)((?:[^{}]|\n)*)\n\s*\},/g;
let e, flags = {};
while ((e = ent.exec(src))) {
  const dm = /\/\/\s*doomednum/.exec(e[2]);
  const num = /(-?\d+),\s*\/\/\s*doomednum/.exec(e[2]);
  if (num) flags[+num[1]] = e[2];
}
for (const d of missing) {
  const t = table[d];
  if (!t) { console.log(d, '???'); continue; }
  // sprite from spawnstate: S_<SPR>_<...>
  const spr = /^S_([A-Z0-9]+?)_/.exec(t.spawn);
  console.log(String(d).padStart(4), t.name.padEnd(12), 'spr=' + (spr ? spr[1] : '?'), t.spawn);
}
