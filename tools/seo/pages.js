/**
 * seo/pages.js — the page registry. One list, every consumer.
 *
 * Before this existed, the de-facto registry was the HTML_FILES array inside
 * gen-asset-manifest.js, and anything else that needed to know "what pages does
 * this site have" (the sitemap, llms.txt, the markdown twins) kept its own copy.
 * Those copies drift the first time someone adds a page. Now gen-asset-manifest
 * requires this file too, so there is exactly one list and a missing entry fails
 * the build instead of silently omitting a page from the sitemap.
 *
 * Deliberately structural only. Titles and descriptions are NOT duplicated here
 * — gen-seo.js reads them out of each page's actual <head>, so the sitemap and
 * llms.txt can never disagree with what the page says about itself.
 *
 * Fields:
 *   file      path under client/
 *   url       the canonical path this page is served at (extensionless)
 *   section   grouping for llms.txt; null hides it from llms.txt
 *   sitemap   include in sitemap.xml
 *   md        how to produce the .md twin:
 *               'generated' — built from source data, not from the HTML
 *               'convert'   — run the HTML through seo/html-to-md.js
 *               'copy:<f>'  — verbatim from seo/copy/<f>
 *               false       — no twin
 *
 * Node built-ins only (runs on the Render static build with no npm install).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CLIENT = path.join(ROOT, 'client');

/** Pages that are hand-authored and committed. */
const PAGES = [
  // Indexable content.
  { file: 'index.html',     url: '/',          section: 'Pages', sitemap: true,  md: 'generated' },
  { file: 'learn.html',     url: '/learn',     section: 'Pages', sitemap: true,  md: 'generated' },
  { file: 'about.html',     url: '/about',     section: 'Pages', sitemap: true,  md: 'convert' },
  { file: 'community.html', url: '/community', section: 'Pages', sitemap: true,  md: 'convert' },
  { file: 'download.html',  url: '/download',  section: 'Pages', sitemap: true,  md: 'convert' },
  { file: 'api.html',       url: '/api',       section: 'Data & APIs', sitemap: true, md: 'convert' },
  { file: 'privacy.html',   url: '/privacy',   section: 'Policies', sitemap: true, md: 'convert' },
  { file: 'terms.html',     url: '/terms',     section: 'Policies', sitemap: true, md: 'convert' },

  // Real pages, deliberately not indexed. No sitemap entry (a noindex page in
  // a sitemap is a direct contradiction — /replays used to be exactly that),
  // and no markdown twin, because there is no stable content to convert:
  // /replays renders the visitor's own IndexedDB and /viewer is an app shell.
  { file: 'viewer.html',    url: '/viewer',    section: null, sitemap: false, md: false },
  { file: 'replays.html',   url: '/replays',   section: null, sitemap: false, md: false },
  { file: 'handoff.html',   url: '/handoff',   section: null, sitemap: false, md: false },
  { file: '404.html',       url: '/404',       section: null, sitemap: false, md: false },

  // Interim stub, deleted once /builds is real. Kept in the registry so
  // gen-asset-manifest still rewrites its cache busters.
  { file: 'builds.html',    url: '/builds.html', section: null, sitemap: false, md: false },
  { file: 'compare.html',   url: '/compare',   section: null, sitemap: false, md: false }
];

/**
 * The generated build pages. Derived from the manifest rather than listed, so
 * a 17th build costs nothing and the list can never be stale.
 * Returns [] if the manifest is unreadable — callers that need it will fail
 * loudly on their own; this must not throw at require() time.
 */
function buildPages () {
  const p = path.join(CLIENT, 'data', 'builds-manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return [];
  }
  if (!Array.isArray(manifest.builds)) return [];

  const out = [{
    file: 'builds/index.html',
    url: '/builds',
    section: 'Build orders',
    sitemap: true,
    md: 'generated',
    generated: true
  }];
  for (const b of manifest.builds) {
    out.push({
      file: 'builds/' + b.id + '.html',
      url: '/builds/' + b.id,
      section: 'Build orders',
      sitemap: true,
      md: 'generated',
      generated: true,
      buildId: b.id
    });
  }
  return out;
}

/** Every page, hand-authored and generated. */
function allPages () {
  return PAGES.concat(buildPages());
}

/**
 * The list gen-asset-manifest.js rewrites cache busters in. Generated build
 * pages are included: they are on disk by the time that script runs (gen-seo
 * runs first in buildCommand) and they reference /css/*.css like any other page.
 * Filtered to what actually exists so a fresh checkout, where gen-seo has not
 * run yet, does not fail.
 */
const HTML_FILES = allPages()
  .map(p => p.file)
  .filter(f => fs.existsSync(path.join(CLIENT, f)));

module.exports = { PAGES, buildPages, allPages, HTML_FILES, ROOT, CLIENT };
