// Full info.c dump for doomednums: state chains + mobjinfo
// states rows: "{SPR_x,fr,tics,{A_Act},S_next,?,?},  // S_NAME" — the trailing
// comment IS this row's enum name (S_NULL row: {0,0,0,{NULL},S_NULL,0,0}).
const fs = require('fs');
const src = fs.readFileSync('reference/linuxdoom-1.10/info.c', 'utf8');
const missing = process.argv[2].split(',').map(Number);

const states = {};
for (const line of src.split('\n')) {
  const m = /^\s*\{(.+?)\},\s*\/\/\s*(S_[A-Z0-9_]+)\s*$/.exec(line);
  if (!m) continue;
  const f = m[1].split(',').map(s => s.trim());
  if (/^SPR_/.test(f[0])) states[m[2]] = { spr: f[0].slice(4), fr: f[1], tics: f[2],
    act: (f[3] || '').replace(/[{}]/g, ''), next: f[4] };
  else if (/^\d/.test(f[0]) || f[0] === 'NULL') states[m[2]] = { spr: null, fr: 0, tics: f[1],
    act: (f[2] || '').replace(/[{}]/g, ''), next: f[3] };
}
console.error('states parsed:', Object.keys(states).length);

// mobjinfo blocks anchored on the "// MT_NAME" line; 23 fields follow.
const lines = src.split('\n');
const info = {};
for (let i = 0; i < lines.length; i++) {
  const nm = /^\s*\{\s*\/\/\s*(MT_[A-Z0-9_]+)\s*$/.exec(lines[i]);
  if (!nm) continue;
  const vals = [];
  for (let j = i + 1; j < lines.length && vals.length < 23; j++) {
    const x = /^\s*([^/\s][^/]*?),\s*(\/\/.*)?$/.exec(lines[j]);
    if (x) vals.push(x[1].trim());
    else if (/^\s*\}/.test(lines[j]) || /^\s*\{/.test(lines[j])) break;
  }
  if (vals.length < 22 || !/^-?\d+$/.test(vals[0])) continue;
  info[nm[1]] = {
    doomed: +vals[0], spawn: vals[1], health: vals[2], seestate: vals[3],
    seesnd: vals[4], reaction: vals[5], atksnd: vals[6], painstate: vals[7],
    painchance: vals[8], painsnd: vals[9], meleestate: vals[10], missilestate: vals[11],
    deathstate: vals[12], xdeathstate: vals[13], deathsnd: vals[14], speed: vals[15],
    radius: vals[16], height: vals[17], mass: vals[18], damage: vals[19],
    activesnd: vals[20], flags: vals[21], raisestate: vals[22]
  };
}
console.error('mobjinfo parsed:', Object.keys(info).length);
const byDoomed = {};
for (const k in info) if (info[k].doomed > 0) byDoomed[info[k].doomed] = k;

for (const d of missing) {
  const nm = byDoomed[d];
  if (!nm) { console.log(d, '?? no mobjinfo'); continue; }
  const i = info[nm];
  console.log('=== ' + d + ' ' + nm + ' hp=' + i.health + ' speed=' + i.speed +
    ' r=' + i.radius + ' h=' + i.height + ' flags=' + i.flags + ' raise=' + i.raisestate);
  let s = i.spawn, seen = 0, prev = null;
  while (states[s] && s !== prev && seen++ < 6) {
    const st = states[s];
    console.log('   ' + s.padEnd(20), String(st.spr).padEnd(6), 'fr=' + st.fr,
      't=' + String(st.tics).padStart(3), (st.act || '').padEnd(16), '-> ' + st.next);
    prev = s; s = st.next;
  }
}
