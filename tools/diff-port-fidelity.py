# Systematic structural diff: src/opl.js (JS port) vs choco_i_oplmusic.c (reference).
# For each timbre-critical C function, extract the sequence of register writes /
# constants / control flow, then grep the JS for the corresponding pieces.
# Prints PASS/FAIL per check — a checklist of porting fidelity.
import re, sys, pathlib

root = pathlib.Path('/home/mike/code/doom-redone')
c = (root / 'tools/oplsrc/choco_i_oplmusic.c').read_text()
js = (root / 'src/opl.js').read_text()

checks = []
def check(name, c_expr, js_exprs, src=None):
    c_ok = re.search(c_expr, src or c, re.S) is not None
    js_ok = all(re.search(p, js, re.S) is not None for p in js_exprs)
    checks.append((name, c_ok, js_ok))

# --- LoadOperatorData: register order & max_level semantics
check('LoadOperatorData C exists', r'static void LoadOperatorData\(int operator, genmidi_op_t \*data,\s*boolean max_level',
      [r'function LoadOpOut\(operator, o, max_level\)'])
check('C: LEVEL reg written from level var', r'level = data->scale;\s*if \(max_level\)\s*\{\s*level \|= 0x3f;\s*\}\s*else\s*\{\s*level \|= data->level;\s*\}',
      [r'var level = o\.scale;\s*if \(max_level\) level \|= 0x3f;\s*else level \|= o\.level;'])
check('C: writes LEVEL,TREMOLO,ATTACK,SUSTAIN,WAVEFORM in that order',
      r'OPL_WriteRegister\(OPL_REGS_LEVEL \+ operator, level\);\s*OPL_WriteRegister\(OPL_REGS_TREMOLO \+ operator, data->tremolo\);\s*OPL_WriteRegister\(OPL_REGS_ATTACK \+ operator, data->attack\);\s*OPL_WriteRegister\(OPL_REGS_SUSTAIN \+ operator, data->sustain\);\s*OPL_WriteRegister\(OPL_REGS_WAVEFORM \+ operator, data->waveform\);',
      # JS must write 0x40 LEVEL, 0x20 tremolo, 0x60 attack, 0x80 sustain, 0xE0 waveform
      [r'oplWrite\(0x40 \+ operator, level\);',
       r'oplWrite\(0x20 \+ operator, o\.tremolo\);',
       r'oplWrite\(0x60 \+ operator, o\.attack\);',
       r'oplWrite\(0x80 \+ operator, o\.sustain\);',
       r'oplWrite\(0xe0 \+ operator, o\.waveform\);'])

# --- SetVoiceInstrument: carrier first with max_level true, modulator with !modulating
check('C: SetVoiceInstrument loads carrier then modulator',
      r'LoadOperatorData\(voice->op2 \| voice->array, &data->carrier, true,\s*&voice->car_volume\);\s*LoadOperatorData\(voice->op1 \| voice->array, &data->modulator, !modulating,\s*&voice->mod_volume\);',
      [r'voice\.car_volume = LoadOpOut\(voice\.op2 \| voice\.array,\s*opData\(instrOff, instr_voice, "car"\), true\);\s*voice\.mod_volume = LoadOpOut\(voice\.op1 \| voice\.array,\s*opData\(instrOff, instr_voice, "mod"\), !modulating\);'])
check('C: modulating = (feedback & 0x01) == 0', r'modulating = \(data->feedback & 0x01\) == 0;',
      [r'var modulating = \(instrField\(instrOff, instr_voice, "feedback"\) & 0x01\) === 0;'])
check('C: feedback reg = feedback | reg_pan at FEEDBACK+index',
      r'OPL_WriteRegister\(\(OPL_REGS_FEEDBACK \+ voice->index\) \| voice->array,\s*data->feedback \| voice->reg_pan\);',
      [r'oplWrite\(0xc0 \+ voice\.index \| voice\.array, feedback \| voice\.reg_pan\);'])

# --- SetVoiceVolume math
check('C: midi_volume = 2 * (volume_mapping_table[channel->volume] + 1)',
      r'midi_volume = 2 \* \(volume_mapping_table\[voice->channel->volume\] \+ 1\);',
      [r'var midi_volume = 2 \* \(volume_mapping_table\[voice\.channel\.volume\] \+ 1\);'])
check('C: full_volume = (table[note_volume] * midi_volume) >> 9',
      r'full_volume = \(volume_mapping_table\[voice->note_volume\] \* midi_volume\)\s*\*\*\s*>> 9;|full_volume = \(volume_mapping_table\[voice->note_volume\] \* midi_volume\)\s*>> 9;',
      [r'var full_volume = \(volume_mapping_table\[voice\.note_volume\] \* midi_volume\) >> 9;'])
check('C: car_volume = 0x3f - full_volume', r'car_volume = 0x3f - full_volume;',
      [r'var car_volume = 0x3f - full_volume;'])
check('C: mod_volume floor at car_volume then |0xc0 scale', 
      r'mod_volume = opl_voice->modulator\.level;\s*if \(mod_volume < car_volume\)\s*\{\s*mod_volume = car_volume;\s*\}\s*mod_volume \|= voice->mod_volume & 0xc0;',
      [r'var mod_volume = mod\.level;\s*if \(mod_volume < car_volume\) mod_volume = car_volume;\s*mod_volume \|= voice\.mod_volume & 0xc0;'])

# --- voice_operators table
m = re.search(r'voice_operators\[2\]\[OPL_NUM_VOICES\] = \{\s*\{([^}]+)\},\s*\{([^}]+)\}\s*\}', c)
cops = m and [[int(x.strip(), 0) for x in m.group(1).split(',')], [int(x.strip(), 0) for x in m.group(2).split(',')]]
mm = re.search(r'voice_operators = \[\[([^\]]+)\],\[([^\]]+)\]\]|voice_operators = \[ \[([^\]]+)\], ?\[([^\]]+)\] \]', js)
if mm: jops = [[int(x) for x in mm.group(1).split(',')], [int(x) for x in mm.group(2).split(',')]]
else:
    mm2 = re.search(r'voice_operators = \[\s*\[([^\]]+)\],\s*\[([^\]]+)\]', js)
    jops = mm2 and [[int(x.strip(), 0) for x in mm2.group(1).split(',')], [int(x.strip(), 0) for x in mm2.group(2).split(',')]]
checks.append(('voice_operators tables equal', True, cops == jops))

# --- percussion instrument offset: main + 128*INSTR_SIZE (128 main instrs!)
check('C: percussion_instrs = main + GENMIDI_NUM_INSTRS', r'percussion_instrs = main_instrs \+ GENMIDI_NUM_INSTRS;',
      [r'percussionInstrs = mainInstrs \+ GENMIDI_NUM_INSTRS \* INSTR_SIZE;'])
check('JS GENMIDI_NUM_INSTRS == 128', r'#define GENMIDI_NUM_INSTRS\s+128',
      [r'GENMIDI_NUM_INSTRS = 128'])

# --- KeyOn percussion: note = 60, instrument = percussion[key-35]
check('C: percussion note=60', r'note = 60;', [r'note = 60;'])
check('C: percussion instrument key-35', r'instrument = &percussion_instrs\[key - 35\];',
      [r'instrument = percussionInstrs \+ \(key - 35\) \* INSTR_SIZE;'])

# --- bend: MSB only - 64; freq index adds channel->bend
check('C: bend MSB - 64', r'channel->bend = event->data\.channel\.param2 - 64;',
      [r'channel\.bend = param2 - 64;'])
check('C: freq_index = 64 + 32*note + bend', r'freq_index = 64 \+ 32 \* note \+ voice->channel->bend;',
      [r'var freq_index = 64 \+ 32 \* note \+ voice\.channel\.bend;'])
check('C: fine tuning voice1 (fine/2)-64', r'freq_index \+= \(voice->current_instr->fine_tuning / 2\) - 64;',
      [r'freq_index \+= \(instrField\(instrOff, iv, "fine"\) / 2\) - 64;'])

# --- MUS pitch wheel key*64
mus = (root / 'tools/oplsrc/mus2mid.c').read_text()
check('mus2mid: pitch wheel key*64', r'\(key \* 64\)', [r'wheelkey \* 64\)\s*& 0xffff'], src=mus)

for name, c_ok, js_ok in checks:
    status = 'PASS' if (c_ok and js_ok) else ('C-MISS?' if not c_ok else 'JS-DIFF')
    print(f'{status:8} {name}')
