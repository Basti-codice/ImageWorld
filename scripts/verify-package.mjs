// Sanity-checks a packaged (unpacked) app directory:
//   node scripts/verify-package.mjs release/win-unpacked       (or release/linux-unpacked)
// 1. every bare module that out/main + out/preload require()/import is present inside app.asar (incl. its
//    dependency closure), i.e. the `files` exclusions in electron-builder.yml did not remove anything needed;
// 2. the native / spawned binaries exist OUTSIDE the asar (app.asar.unpacked).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const dir = resolve(process.argv[2] ?? 'release/win-unpacked');
const isWin = /win/i.test(dir.split(/[\\/]/).pop() ?? '') && !/linux/i.test(dir);
const resources = existsSync(join(dir, 'resources')) ? join(dir, 'resources') : null;
if (!resources) { console.error('no resources/ in', dir); process.exit(2); }
const asarFile = join(resources, 'app.asar');
const unpacked = join(resources, 'app.asar.unpacked');
if (!existsSync(asarFile)) { console.error('app.asar missing'); process.exit(2); }

const list = new Set(asar.listPackage(asarFile).map((p) => p.replace(/\\/g, '/').replace(/^\//, '')));
const errors = [];
const ok = (m) => console.log('  ok  ', m);
const fail = (m) => { errors.push(m); console.log('  FAIL', m); };

// --- 1. required modules ------------------------------------------------------
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`), 'electron']);
const files = [];
for (const sub of ['out/main', 'out/preload']) {
  const d = join(root, sub);
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d)) if (/\.(c?js|mjs)$/.test(f) && statSync(join(d, f)).isFile()) files.push(join(d, f));
}
const bare = new Set();
const re = /(?:require\(\s*|from\s*|import\(\s*|import\s+)["']([^"'./][^"']*)["']/g;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(re)) {
    const spec = m[1];
    if (builtins.has(spec) || spec.startsWith('node:')) continue;
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    bare.add(name);
  }
}
console.log('externals required by main/preload bundle:', [...bare].sort().join(', ') || '(none)');
const seen = new Set();
function check(name, from) {
  if (seen.has(name) || name.startsWith('@types/')) return; // type-only packages are intentionally not shipped
  seen.add(name);
  const pj = join(root, 'node_modules', name, 'package.json');
  if (!existsSync(pj)) return; // optional / platform-specific dep not installed here
  if (!list.has(`node_modules/${name}/package.json`)) { fail(`node_modules/${name} missing from app.asar (needed by ${from})`); return; }
  const meta = JSON.parse(readFileSync(pj, 'utf8'));
  for (const dep of Object.keys({ ...meta.dependencies, ...meta.optionalDependencies })) check(dep, name);
}
for (const name of bare) check(name, 'main bundle');
if (!errors.length) ok(`all ${seen.size} required modules (incl. transitive) are inside app.asar`);

// --- 2. unpacked binaries -------------------------------------------------------
const must = isWin
  ? [
      'node_modules/exiftool-vendored.exe/bin/exiftool.exe',
      'node_modules/ffmpeg-static/ffmpeg.exe',
      'node_modules/@img/sharp-win32-x64/lib/*.node',
    ]
  : ['node_modules/exiftool-vendored.pl/bin/exiftool', 'node_modules/ffmpeg-static/ffmpeg', 'node_modules/@img/sharp-linux-x64/lib/*.node'];
const exists = (rel) => {
  if (!rel.includes('*')) return existsSync(join(unpacked, rel));
  const d = join(unpacked, dirname(rel));
  const ext = rel.slice(rel.lastIndexOf('*') + 1); // e.g. ".node"
  return existsSync(d) && readdirSync(d).some((f) => f.endsWith(ext));
};
for (const rel of must) {
  if (exists(rel)) ok(`unpacked: ${rel}`); else fail(`NOT unpacked / missing: ${rel}`);
}
const wasm = join(unpacked, 'node_modules/libheif-js');
if (existsSync(wasm)) ok('unpacked: node_modules/libheif-js'); else fail('libheif-js not unpacked');
if (!isWin) {
  // sharp.node must be able to find libvips next to it
  const lv = join(unpacked, 'node_modules/@img/sharp-libvips-linux-x64/lib');
  if (existsSync(lv)) ok('unpacked: sharp-libvips-linux-x64'); else fail('sharp-libvips-linux-x64 missing');
} else {
  const libDir = join(unpacked, 'node_modules/@img/sharp-win32-x64/lib');
  const dlls = existsSync(libDir) ? readdirSync(libDir).filter((f) => f.endsWith('.dll')) : [];
  console.log(`  info  files in sharp-win32-x64/lib: ${existsSync(libDir) ? readdirSync(libDir).join(', ') : '(missing)'}${dlls.length ? '' : '  (no separate .dll: libvips statically linked)'}`);
}
if (errors.length) { console.error(`\n${errors.length} problem(s)`); process.exit(1); }
console.log('package layout OK');
