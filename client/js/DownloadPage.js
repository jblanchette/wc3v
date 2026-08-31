/**
 * DownloadPage.js — client/download.html only.
 *
 * Fetches the live desktop update manifest (the same latest.json
 * tools/deploy-desktop.js publishes and the Tauri updater itself polls) and
 * uses it as the single source of truth for version, publish date, checksum
 * and filename. Nothing on this page is hardcoded, so it can never advertise
 * a version that is no longer the one install.ps1 would fetch.
 *
 * There is no direct-installer link any more. The one-liner is the only path
 * the page hands out: it is the path that does not trip SmartScreen, and it is
 * the only one that verifies the checksum on the user's behalf. The manifest's
 * installer URL is still read, because the JSON-LD node's downloadUrl is a
 * true statement about where the software lives, and because the filename is
 * worth showing next to the hash.
 *
 * The install command is deliberately NOT manifest-driven. It is static markup
 * pointing at /install.ps1, which resolves the same latest.json itself, so the
 * primary path keeps working on the one occasion it matters most: when this
 * fetch is the thing that failed.
 *
 * The version appears in more than one place (the strip and the spec table),
 * so those fields are addressed by [data-dl-*] attribute and filled together.
 * Anything that appears once (the checksum, the failure notice) keeps an id.
 * A [data-dl-*] with no elements on the page is a no-op, which is what lets
 * the same module serve a layout that drops the publish date or the filename.
 *
 * Usage: <script src="js/DownloadPage.js"></script>, then call
 * DownloadPage.init() and DownloadPage.initStage() after DOM ready.
 */

const DownloadPage = {
  MANIFEST_URL: 'https://cdn.wc3v.com/desktop/latest.json',

  async init() {
    await this._loadManifest();
  },

  _fill(attr, text) {
    for (const el of document.querySelectorAll('[' + attr + ']')) el.textContent = text;
  },

  async _loadManifest() {
    const failEl = document.getElementById('dl-fail');
    const shaCode = document.getElementById('dl-sha-code');

    try {
      const res = await fetch(this.MANIFEST_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('manifest fetch failed: ' + res.status);
      const manifest = await res.json();
      const win = manifest && manifest.platforms && manifest.platforms['windows-x86_64'];
      if (!win || !win.url) throw new Error('manifest missing windows-x86_64 platform');

      this._fill('data-dl-version', manifest.version || 'unknown version');

      if (manifest.pub_date) {
        const d = new Date(manifest.pub_date);
        if (!isNaN(d.getTime())) {
          this._fill('data-dl-date', 'Released ' +
            d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
        }
      }

      this._fill('data-dl-filename', win.url.split('/').pop());

      // The hash ships as an em dash and is replaced, rather than shipping
      // hidden and being revealed: the row is part of a fixed spec table, and
      // a row that appears late would jog everything under it.
      if (win.sha256 && shaCode) shaCode.textContent = win.sha256;

      this._patchStructuredData(manifest, win);
    } catch (err) {
      // Hide the version lines, NOT the boxes that contain them. Those boxes
      // also hold the install command, which resolves this same manifest
      // itself and is the one thing still working when this fetch is what
      // broke.
      for (const el of document.querySelectorAll('[data-dl-line]')) el.hidden = true;
      this._fill('data-dl-version', 'Latest');
      if (failEl) failEl.hidden = false;
    }
  },

  // Fill the version-dependent fields of the SoftwareApplication JSON-LD in
  // download.html. They cannot be committed statically — latest.json is the
  // single source of truth for the shipped version, and a hardcoded number in
  // the markup would be wrong from the first release after the commit.
  //
  // Crawlers that render JS (Googlebot does) pick this up; ones that don't
  // still get a valid node, just without softwareVersion/downloadUrl. Failing
  // silently is correct here: a broken manifest fetch already surfaces to the
  // user through the fail notice, and structured data is not worth a throw.
  _patchStructuredData(manifest, win) {
    try {
      const el = document.getElementById('ld-desktop-app');
      if (!el) return;
      const node = JSON.parse(el.textContent);
      if (manifest.version) node.softwareVersion = manifest.version;
      if (win.url) node.downloadUrl = win.url;
      if (manifest.pub_date) {
        const d = new Date(manifest.pub_date);
        if (!isNaN(d.getTime())) node.datePublished = d.toISOString().slice(0, 10);
      }
      el.textContent = JSON.stringify(node, null, 2);
    } catch (e) { /* structured data is not worth breaking the page over */ }
  },

  /**
   * Copy the install command next to the button that was clicked. Both boxes
   * carry the same command, so the button finds its own .dl-cmd rather than
   * either box needing a unique id.
   */
  copyCommand(btn) {
    if (!btn) return;
    const box = btn.closest('.dl-get');
    this._copy(box && box.querySelector('.dl-cmd'), btn);
    // Anonymous count of copy clicks; actual installs are counted when
    // install.ps1 is fetched (workers/stats).
    if (window.SiteStats) window.SiteStats.event('download_copy');
  },

  /**
   * The screenshot stage: one frame, one tab per screen. A tab swaps the
   * image and the line under it, and nothing else on the page moves.
   *
   * A shot that 404s takes its own tab with it. client/assets/press/ is
   * gitignored and rides the asset deploy, so the page can legitimately be
   * live before a given screenshot is, and a tab that opens onto a black
   * rectangle is worse than a tab that is not there. If the tab being
   * dropped is the one that was showing, the next surviving tab takes over.
   */
  initStage() {
    const stage = document.getElementById('dl-stage');
    const tabs = document.getElementById('dl-tabs');
    const note = document.getElementById('dl-stage-note');
    if (!stage || !tabs) return;

    const buttons = [...tabs.querySelectorAll('.dl-tab')];
    const show = (shot) => {
      for (const b of buttons) b.setAttribute('aria-selected', String(b.dataset.shot === shot));
      for (const img of stage.querySelectorAll('img')) img.classList.toggle('is-on', img.dataset.shot === shot);
      const live = buttons.find(b => b.dataset.shot === shot);
      if (note && live && live.dataset.note) note.textContent = live.dataset.note;
    };

    for (const btn of buttons) btn.addEventListener('click', () => show(btn.dataset.shot));

    // Left/right arrows walk the tablist, which is what a tablist is expected
    // to do once role="tab" is on the buttons.
    tabs.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      const live = buttons.filter(b => !b.hidden);
      const i = live.findIndex(b => b.getAttribute('aria-selected') === 'true');
      const next = live[(i + step + live.length) % live.length];
      if (next) { show(next.dataset.shot); next.focus(); }
      e.preventDefault();
    });

    const drop = (img) => {
      const btn = buttons.find(b => b.dataset.shot === img.dataset.shot);
      const wasLive = btn && btn.getAttribute('aria-selected') === 'true';
      img.remove();
      if (btn) btn.hidden = true;
      const survivor = buttons.find(b => !b.hidden);
      if (wasLive && survivor) show(survivor.dataset.shot);
    };

    for (const img of stage.querySelectorAll('img')) {
      img.addEventListener('error', () => drop(img));
      // The first shot is eager, so it can have failed before this ran and
      // its error event is already gone. A finished load with no intrinsic
      // width is that failure, after the fact.
      if (img.complete && img.naturalWidth === 0) drop(img);
    }
  },

  _copy(code, btn) {
    if (!code || !btn || !navigator.clipboard) return;
    const text = (code.textContent || '').trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const original = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = original; }, 1500);
    }).catch(() => {});
  }
};

if (typeof window !== 'undefined') window.DownloadPage = DownloadPage;
