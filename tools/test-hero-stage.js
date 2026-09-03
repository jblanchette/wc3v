/**
 * test-hero-stage.js — the parts of the homepage hero stage a browser is not
 * needed to check.
 *
 * tools/hero-stage-check.js drives the real thing and is where rendering,
 * timing and interaction are proved. This is the cheap gate that runs in any
 * Node: the constants two files have to agree on, the four models existing
 * with the clip this code plays, and the markup contract the CSS and the JS
 * both hang off.
 *
 * The one that actually bites: MODEL_ASSET_VERSION is a closure const inside
 * UnitModelRenderer.js, not an export, so HeroStage.js carries a copy. Bump
 * one without the other and every hero silently 404s into its portrait.
 *
 *   node tools/test-hero-stage.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0;
const fails = [];
function test (name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fails.push(name); console.log('  FAIL  ' + name + '\n          ' + e.message); }
}

const heroStage = read('client/js/HeroStage.js');
const index = read('client/index.html');

// The four heroes HeroStage.HEROES names, kept here as the expectation
// rather than parsed out of it, so a typo in either shows up as a failure.
const HEROES = [
  { race: 'H', id: 'Hamg', model: 'heroarchmage' },
  { race: 'O', id: 'Obla', model: 'heroblademaster' },
  { race: 'E', id: 'Edem', model: 'herodemonhunter' },
  { race: 'U', id: 'Udea', model: 'herodeathknight' }
];

console.log('\nhero stage');

test('HeroStage MODEL_ASSET_VERSION matches UnitModelRenderer', () => {
  const grab = (src, file) => {
    const m = /MODEL_ASSET_VERSION\s*=\s*'([^']+)'/.exec(src);
    assert(m, 'no MODEL_ASSET_VERSION literal in ' + file);
    return m[1];
  };
  const a = grab(heroStage, 'HeroStage.js');
  const b = grab(read('client/js/UnitModelRenderer.js'), 'UnitModelRenderer.js');
  assert.strictEqual(a, b,
    'HeroStage says ' + a + ', UnitModelRenderer says ' + b +
    '. Every hero .glb would 404 into its portrait.');
});

test('HeroStage pins the same three.js build as the viewer', () => {
  const m = /const THREE_URL = '([^']+)'/.exec(heroStage);
  assert(m, 'no THREE_URL in HeroStage.js');
  assert(/three@\d+\.\d+\.\d+\//.test(m[1]), 'three.js URL is not version-pinned: ' + m[1]);
  const viewer = read('client/viewer.html');
  assert(viewer.includes(m[1]), 'viewer.html serves a different three.js build than ' + m[1]);
});

test('HeroStage touches no THREE global at module scope', () => {
  // Everything 3D has to wait until _boot(), because three.js is injected
  // long after this file has executed.
  const head = heroStage.split(/\n\s*class HeroStage/)[0];
  const hit = head.split('\n').find(l => /\bTHREE\./.test(l) && !/^\s*(\/\/|\*)/.test(l.trim()));
  assert(!hit, 'THREE used before the class body: ' + (hit || '').trim());
});

test('the manifest maps each hero to the model HeroStage asks for', () => {
  const manifest = JSON.parse(read('client/assets/models/units/unit-models.json'));
  for (const h of HEROES) {
    const entry = manifest[h.id];
    assert(entry, h.id + ' is not in unit-models.json');
    assert.strictEqual(entry.model, h.model, h.id + ' maps to ' + entry.model + ', not ' + h.model);
  }
});

test('every hero GLB is on disk and carries an "idle" clip', () => {
  for (const h of HEROES) {
    const file = path.join(ROOT, 'client/assets/models/units', h.model + '.glb');
    assert(fs.existsSync(file), h.model + '.glb is missing (R2-only assets: pull them first)');

    // Read the glTF JSON chunk the way GLBLoader.parse does: a 12-byte
    // header, then a length-prefixed chunk.
    const buf = fs.readFileSync(file);
    assert.strictEqual(buf.readUInt32LE(0), 0x46546C67, h.model + ': not a GLB');
    const jsonLen = buf.readUInt32LE(12);
    const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));

    const names = (gltf.animations || []).map(a => a.name);
    // HeroStage looks up the CANONICAL category name, not the manifest's
    // source-MDX name ("Stand 1", "Attack - 1"), because that is what the
    // converter writes into the GLB.
    assert(names.includes('idle'),
      h.model + ' has no clip named "idle" (has: ' + names.join(', ') + ')');
    assert(gltf.skins && gltf.skins.length, h.model + ' is not skinned');
  }
});

test('the Demon Hunter tags its alternate-form meshes', () => {
  // If they are not tagged, HeroStage cannot hide them and the Metamorphosis
  // body draws straight through the elf.
  const buf = fs.readFileSync(path.join(ROOT, 'client/assets/models/units/herodemonhunter.glb'));
  const gltf = JSON.parse(buf.slice(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  const forms = new Set();
  for (const mesh of gltf.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.extras && prim.extras.form) forms.add(prim.extras.form);
    }
  }
  assert(forms.has('alternate'), 'no primitive tagged "alternate" (forms: ' + [...forms].join(', ') + ')');
  assert(/wc3Form/.test(heroStage), 'HeroStage does not read userData.wc3Form');
});

console.log('\nhomepage markup contract');

test('index.html has the four slots, with a race and a pressed state each', () => {
  for (const h of HEROES) {
    const re = new RegExp('class="hp-stage-slot"[^>]*data-race="' + h.race + '"[^>]*aria-pressed=');
    assert(re.test(index), 'no .hp-stage-slot for race ' + h.race + ' with aria-pressed');
  }
  const n = (index.match(/class="hp-stage-slot"/g) || []).length;
  assert.strictEqual(n, 4, 'expected 4 slots, found ' + n);
});

test('index.html loads HeroStage.js and no three.js', () => {
  assert(/<script src="js\/HeroStage\.js/.test(index), 'HeroStage.js is not loaded');
  assert(!/<script[^>]+src="[^"]*three[^"]*"/i.test(index),
    'three.js is a static script tag. It must be injected after first paint.');
});

test('the page owns the slot clicks, not HeroStage', () => {
  // Both binding click is what made every pick toggle twice and cancel out.
  assert(/wireRacePicker/.test(index), 'index.html has no wireRacePicker');
  assert(!/addEventListener\('click'/.test(heroStage),
    'HeroStage binds a click; index.html already does, and two handlers cancel');
});

test('the old race chips and their CSS hooks are gone', () => {
  for (const dead of ['race-filter', 'site-race-pick', 'buildRaceFilter', 'hp-newbie', 'mobile-filters-toggle']) {
    assert(!index.includes(dead), 'index.html still references ' + dead);
  }
});

test('every hidden-toggled homepage panel has its own [hidden] rule', () => {
  // An author `display:` rule beats the UA sheet's [hidden] { display: none },
  // so a panel with its own display needs the rule spelled out or it renders
  // while the JS thinks it is closed.
  const css = read('client/css/home.css');
  for (const sel of ['.hp-pop', '.hp-matchups']) {
    assert(new RegExp(sel.replace('.', '\\.') + '\\[hidden\\]').test(css),
      sel + ' sets its own display but has no ' + sel + '[hidden] rule');
  }
});

test('home.css is only on the homepage', () => {
  const pages = fs.readdirSync(path.join(ROOT, 'client')).filter(f => f.endsWith('.html'));
  const others = pages.filter(f => f !== 'index.html' && read('client/' + f).includes('css/home.css'));
  assert(!others.length, 'home.css is also linked by ' + others.join(', '));
  assert(index.includes('css/home.css'), 'index.html does not link home.css');
  assert(/<body class="site-page hp-page"/.test(index), 'body is missing the hp-page class');
});

test('the homepage skin repaints no :root token', () => {
  // The viewer and the other eight .site-page pages read tokens.css, so the
  // warm palette has to stay scoped to body.hp-page.
  const css = read('client/css/home.css');
  assert(!/^:root\s*\{/m.test(css), 'home.css declares a :root block');
  const scoped = (css.match(/body\.hp-page/g) || []).length;
  assert(scoped >= 2, 'home.css barely scopes anything to body.hp-page');
});

console.log('\n' + (fails.length ? fails.length + ' FAILED of ' + (pass + fails.length)
                                 : 'all ' + pass + ' checks passed'));
process.exit(fails.length ? 1 : 0);
