// One-shot measurement script — count cht-default calc shape distribution
// and dump the exact set of cells that flip to raw under the §3.1 self-check.
// Run via: `node scripts/measure-calc-flips.mjs`
//
// Used to regenerate `shared/src/xlsform/__fixtures__/known-raw-flip-cells.json`
// after a legitimate parser change. The roundtrip test pins against that
// fixture so a silent flip-set expansion fails CI.
/* eslint-disable no-undef */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCalculation,
  serializeCalculation,
  parseXlsForm,
} from '../shared/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'server', 'templates', 'cht-default', 'forms', 'app');
const files = readdirSync(dir).filter((n) => n.endsWith('.xlsx'));

const cells = new Set();
for (const f of files) {
  const form = await parseXlsForm(readFileSync(join(dir, f)));
  for (const row of form.survey) {
    const calc = row.extras['calculation'];
    if (typeof calc === 'string' && calc.trim() !== '') cells.add(calc);
  }
}

console.log(`distinct calc cells: ${cells.size}`);

const flips = [];
const ifChains = [];
const singles = [];
for (const src of cells) {
  const p = parseCalculation(src);
  if (p.shape === 'raw') flips.push(src);
  else if (p.shape === 'decision_table') ifChains.push(src);
  else if (p.shape === 'single') singles.push(src);
}

console.log(`decision_table: ${ifChains.length}`);
console.log(`single: ${singles.length}`);
console.log(`raw (flipped): ${flips.length}`);
console.log('\n--- FLIPPED CELLS ---');
for (const f of flips) console.log(JSON.stringify(f));

// Drift check + present-becomes-deletable check
const drifters = [];
const dels = [];
for (const src of cells) {
  const p = parseCalculation(src);
  const out = serializeCalculation(p);
  if (out !== src.trim()) drifters.push(src);
  if (out.length === 0) dels.push(src);
}
console.log(`\ndrifters: ${drifters.length}`);
console.log(`present→deletable: ${dels.length}`);
