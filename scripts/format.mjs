// Formats the code with Prettier: the Worker's modules, the build scripts, and the office and crew apps.
//   node scripts/format.mjs          rewrite the files
//   node scripts/format.mjs --check  only report files that are not formatted (exit 1 if any)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import prettier from 'prettier';

const check = process.argv.includes('--check');
const opts = { ...(await prettier.resolveConfig('src/worker.js')), parser: 'babel' };
const js = (dir, ext = '.js') =>
  readdirSync(dir, { recursive: true })
    .filter(f => f.endsWith(ext))
    .map(f => dir + '/' + f);
const files = [...js('src'), ...js('scripts', '.mjs'), ...js('public/assets/office'), ...js('public/crew')];
let bad = 0;
for (const f of files) {
  const s = readFileSync(f, 'utf8'),
    out = await prettier.format(s, opts);
  if (out !== s) {
    bad++;
    if (check) console.log('not formatted: ' + f);
    else writeFileSync(f, out);
  }
}
if (check && bad) process.exit(1);
console.log(check ? 'formatting ok' : `formatted ${bad} file(s)`);
