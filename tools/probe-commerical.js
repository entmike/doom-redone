// Commercial-mode content coverage probe
const WAD = require('../src/wad.js'), fs = require('fs');
const NEED = ['INTERPIC', 'HELP', 'CWILV00', 'CWILV31', 'WISCRT2', 'WISCRTS',
  'VICTORY2', 'ENDPIC', 'PFUB1', 'PFUB2', 'END0', 'END6', 'BOSSBACK', 'DM2TTL',
  'WIURH0', 'WISPLAT', 'WIMAP0', 'HELP2', 'CREDIT', 'M_DOOM', 'M_EPISOD',
  'GRNROCK', 'FLOOR7_2', 'SKY1', 'SKY2', 'SKY3', 'SLIME16', 'D_EVIL', 'D_DM2INT',
  'D_DM2TTL', 'D_READ_M', 'D_RUNNIN', 'THEEND', 'WIAMMO', 'WIA', 'MAP31', 'MAP32',
  'WIOSTK', 'WIOSTI', 'WITIME', 'WIPAR', 'WINUM0', 'WIPCNT', 'WIF', 'WIENTER',
  'WIMINUS', 'WISUCKS', 'WICOLON', 'WIBR', 'M_THERML'];
for (const f of ['wads/PLUTONIA.wad', 'wads/DOOM2.WAD', 'wads/doom1.9-retail.wad', 'wads/doom1.wad']) {
  const b = fs.readFileSync(f);
  const w = WAD.load(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const have = new Set(w.lumps.map(l => l.name.replace(/\0.*$/, '')));
  const missing = NEED.filter(n => !have.has(n));
  const maps = WAD.mapList(w).map(m => m.name);
  console.log(f.split('/').pop().padEnd(22),
    'magic=' + w.magic, 'maps=' + maps.length, 'missing(' + missing.length + '):' + (missing.join(',') || 'none'));
}
