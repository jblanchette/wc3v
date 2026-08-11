/**
 * test-build-deps.js — every file the Render build reaches must be in git.
 *
 * Render builds from a clean clone. Anything gitignored simply is not there, so
 * a build script that requires it works perfectly on a dev machine and fails
 * the deploy with MODULE_NOT_FOUND.
 *
 * That happened on 2026-08-11: tools/seo/build-page.js required
 * helpers/mappings.js for itemId lookups, and mappings.js line 2 requires
 * ./UnitBalance.json, which is gitignored SLK game data. Local builds passed,
 * every Render deploy after it failed, and the site silently kept serving the
 * last good build for close to an hour before anyone read the deploy log.
 *
 * This walks the require graph statically from the buildCommand entry points
 * and asserts each repo-local file is tracked. Static rather than executed, so
 * it is fast, deterministic, and cannot be fooled by a lazy require.
 *
 * Usage: node tools/test-build-deps.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// Must match render.yaml's buildCommand.
const ENTRY_POINTS = [
  'tools/gen-builds-cards.js',
  'tools/gen-seo.js',
  'tools/gen-asset-manifest.js'
];

/** Relative require/import specifiers in a source file. */
function relativeRequires (src) {
  const out = [];
  for (const m of src.matchAll(/\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g)) out.push(m[1]);
  for (const m of src.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) out.push(m[1]);
  return out;
}

/** Resolve a relative specifier the way Node would, for files we can see. */
function resolveFrom (fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, base + '.js', base + '.json',
    path.join(base, 'index.js'), path.join(base, 'index.json')];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function main () {
  const seen = new Set();
  const reached = [];
  const unresolved = [];
  const stack = ENTRY_POINTS.map(p => path.join(ROOT, p));

  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    reached.push(file);

    if (!file.endsWith('.js')) continue;              // JSON has no requires
    if (!fs.existsSync(file)) { unresolved.push(file); continue; }

    const src = fs.readFileSync(file, 'utf8');
    for (const spec of relativeRequires(src)) {
      const resolved = resolveFrom(file, spec);
      if (!resolved) {
        unresolved.push(spec + '  (from ' + path.relative(ROOT, file) + ')');
        continue;
      }
      // node_modules is installed by Render, so it is out of scope here.
      if (resolved.includes('node_modules')) continue;
      stack.push(resolved);
    }
  }

  // One `git ls-files` call over everything reached, rather than one per file.
  const rel = reached
    .filter(f => !f.includes('node_modules'))
    .map(f => path.relative(ROOT, f).split(path.sep).join('/'));

  let tracked = new Set();
  try {
    const out = execFileSync('git', ['ls-files', '--', ...rel],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 });
    tracked = new Set(out.split('\n').filter(Boolean));
  } catch (e) {
    console.error('build-deps: could not run git ls-files — ' + e.message);
    process.exit(1);
  }

  const untracked = rel.filter(f => !tracked.has(f));

  console.log('build-deps: ' + rel.length + ' repo file(s) reachable from the build command');
  if (unresolved.length) {
    console.log('\n  UNRESOLVED require(s):');
    for (const u of unresolved) console.log('    ' + u);
  }
  if (untracked.length) {
    console.log('\n  NOT TRACKED BY GIT — Render builds from a clean clone, so these');
    console.log('  do not exist there and the deploy will fail:');
    for (const f of untracked) {
      let why = '';
      try {
        why = execFileSync('git', ['check-ignore', '-v', '--', f],
          { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch (e) { why = '(untracked, not ignored)'; }
      console.log('    ' + f + '\n      ' + why);
    }
  }

  if (untracked.length || unresolved.length) {
    console.error('\nbuild-deps: FAILED');
    process.exit(1);
  }
  console.log('  all tracked');
}

main();
