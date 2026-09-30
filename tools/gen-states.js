// Emit port-style S() lines for state chains the port is missing, straight
// from gospel info.c (name = trailing comment; row order preserved).
'use strict';
const fs = require('fs');
const ROOT = '/home/mike/code/doom-redone';
const g = fs.readFileSync(ROOT + '/reference/linuxdoom-1.10/info.c', 'utf8');

// rows: {SPR_XXXX,frame,tics,{Action},S_NEXT,0,0},\t// S_NAME
const table = g.slice(g.indexOf('states[NUMSTATES]'), g.indexOf('mobjinfo_t'));
const rowRe = /^\s*\{SPR_([A-Z0-9]+),(\d+),(-?\d+),\{(NULL|A_[A-Za-z0-9_]+)\},(S_[A-Z0-9_]+|NULL),0,0\},\s*\/\/\s(S_[A-Z0-9_]+)\s*$/gm;
const rows = [];
let m;
while ((m = rowRe.exec(table))) {
  rows.push({ spr: m[1], fr: +m[2], tics: +m[3], act: m[4], next: m[5], name: m[6] });
}
console.error('gospel rows parsed:', rows.length);

const game = fs.readFileSync(ROOT + '/src/game.js', 'utf8');
const have = new Set([...game.matchAll(/S\("(S_[A-Z0-9_]+)"/g)].map(x => x[1]));

const wantPrefixes = process.argv[2]
  ? process.argv[2].split(',')
  : ['S_VILE_', 'S_SKEL_', 'S_FATT_', 'S_BSPI_', 'S_PAIN_', 'S_CYBR_', 'S_BOS2_',
     'S_PLAY_READ', 'S_PLAY_RO_A', 'S_SHT', 'SHELL', 'S_BAL7'];
const out = [];
for (const r of rows) {
  if (have.has(r.name)) continue;
  if (!wantPrefixes.some(p => r.name.startsWith(p.replace(/[*]/g, '')))) {
    // also catch exact singletons listed without trailing underscore
    continue;
  }
  const frame = r.fr >= 32768 ? `FF_FULLBRIGHT | ${r.fr - 32768}` : String(r.fr);
  const act = r.act === 'NULL' ? 'null' : `"${r.act}"`;
  const next = r.next === 'NULL' ? 'S_NULL' : r.next;
  out.push(`  S("${r.name}", "${r.spr}", ${frame}, ${r.tics}, ${act === 'null' ? 'null' : act}, "${next}");`);
}
fs.writeFileSync(process.env.TMPDIR + '/states-missing.txt', out.join('\n') + '\n');
console.error('missing rows emitted:', out.length);
console.log(out.slice(0, 6).join('\n'));
