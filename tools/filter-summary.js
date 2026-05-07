/**
 * filter-summary.js — Keep only summary blocks whose ID appears in an allow-list.
 *
 * Usage:
 *   node tools/filter-summary.js <ids-file> <summary-file> > <out-file>
 */

const fs = require('fs');

const idsPath = process.argv[2];
const summaryPath = process.argv[3];
if (!idsPath || !summaryPath) {
  console.error('usage: node tools/filter-summary.js <ids-file> <summary-file>');
  process.exit(1);
}

const ids = new Set(fs.readFileSync(idsPath, 'utf8').trim().split('\n').filter(Boolean));
const summary = fs.readFileSync(summaryPath, 'utf8');
const blocks = summary.split(/\n=== /);

let count = 0;
process.stdout.write(blocks[0]);
for (let i = 1; i < blocks.length; i++) {
  const id = blocks[i].split(' ===')[0].trim();
  if (ids.has(id)) {
    process.stdout.write('\n=== ' + blocks[i]);
    count++;
  }
}

process.stderr.write(`filtered: ${count} blocks (of ${blocks.length - 1})\n`);
