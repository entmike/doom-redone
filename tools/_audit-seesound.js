// Audit: every MI() seesound id in game.js vs gospel info.c row order.
const fs = require('fs');
const c = fs.readFileSync('reference/linuxdoom-1.10/info.c', 'utf8');
const lit = c.slice(c.indexOf('mobjinfo_t mobjinfo[NUMMOBJTYPES]'));
// info.c rows: '{' line carries '// MT_NAME', fields on following lines;
// the line tagged // seesound holds the sfx token.
const g = {};
{
  let cur = null, got = false;
  for (const line of lit.split('\n')) {
    const mt = line.match(/\/\/\s*MT_(\w+)/);
    if (mt) { cur = mt[1]; got = false; continue; }
    if (cur && !got) {
      const ss = line.match(/sfx_(\w+)/);
      if (ss) { g[cur] = ss[1]; got = true; }
    }
  }
}
console.log('gospel rows parsed:', Object.keys(g).length);

const gm = fs.readFileSync('src/game.js', 'utf8');
const mis = [...gm.matchAll(/MI\(\/\*(MT_\w+) @\d+\*\/\s*(-?\d+),\s*statenames\.\w+,\s*\d+,\s*(?:statenames\.\w+|\d+),\s*(\d+),/g)];
console.log('MI rows parsed:', mis.length);

const h = fs.readFileSync('src/sound.js', 'utf8');
const t = h.match(/var SFX_TABLE = \[([\s\S]*?)\n  \];/)[1];
const names = [...t.matchAll(/\["(\w+)"/g)].map(x => x[1]);

let bad = 0, seen = 0;
for (const m of mis) {
  const mt = m[1].replace('MT_', '');
  const pid = +m[3];
  const gname = g[mt];
  if (gname === undefined) continue;
  seen++;
  const gid = gname === 'none' ? 0 : names.indexOf(gname);
  if (gid !== pid) { console.log('MISMATCH', mt, 'port:', pid, names[pid], '| gospel sfx_' + gname); bad++; }
}
console.log('checked', seen, '— seesound mismatches:', bad);
