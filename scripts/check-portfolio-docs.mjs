import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
const root = resolve('.');
const dirs = ['docs', 'portfolio-1-database-design', 'portfolio-2-query-optimisation', 'portfolio-3-transactions-concurrency', 'portfolio-4-nosql', 'final-documentation'];
function markdown(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const path = resolve(dir, e.name);
    return e.isDirectory() ? markdown(path) : e.name.endsWith('.md') ? [path] : [];
  });
}
let links = 0;
const failures = [];
for (const file of [resolve('README.md'), ...dirs.flatMap(markdown)]) {
  for (const [, raw] of readFileSync(file, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(raw)) continue;
    const target = resolve(dirname(file), decodeURIComponent(raw.split('#')[0]));
    const rel = relative(root, target);
    if (rel === '..' || rel.startsWith(`..${sep}`) || !existsSync(target)) failures.push(`${relative(root, file)} -> ${raw}`);
    links++;
  }
}
const models = [...readFileSync('prisma/schema.prisma', 'utf8').matchAll(/^model (\w+) \{/gm)].map(m => m[1]);
const diagram = readFileSync('portfolio-1-database-design/evidence/er-diagram.mmd', 'utf8');
const guide = readFileSync('docs/DATABASE.md', 'utf8');
for (const model of models) {
  if (!new RegExp(`\\b${model}\\b`).test(diagram) || !guide.includes(`| ${model} |`)) failures.push(`Missing model: ${model}`);
}
if (models.length !== 13) failures.push(`Expected 13 models, found ${models.length}`);
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`PASS: ${links} local links stay within this repository and resolve; all ${models.length} models appear in the ERD and design table.`);
