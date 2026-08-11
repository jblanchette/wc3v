/**
 * DownloadPage.js — client/download.html only.
 *
 * Fetches the live desktop update manifest (the same latest.json
 * tools/deploy-desktop.js publishes and the Tauri updater itself polls) and
 * uses it as the single source of truth for version, release notes, checksum,
 * and the actual download URL. Nothing on this page is hardcoded, so it can
 * never point at a stale installer.
 *
 * The download link starts inert and arms when the manifest loads, because
 * until then there is no URL to send anyone to. It is not a consent gate:
 * this page briefly made you tick two "I understand" boxes before it would
 * let you download, which is not a thing real software does and reads as an
 * admission that something is wrong with the file.
 *
 * Usage: <script src="js/DownloadPage.js"></script>, then call
 * DownloadPage.init() after DOM ready.
 */

const DownloadPage = {
  MANIFEST_URL: 'https://cdn.wc3v.com/desktop/latest.json',
  _downloadUrl: null,

  async init() {
    const link = document.getElementById('dl-download-link');
    if (link) {
      // Even if a browser lets a click through on an aria-disabled anchor with
      // no href, this stops it explicitly.
      link.addEventListener('click', (e) => {
        if (link.getAttribute('aria-disabled') === 'true') e.preventDefault();
      });
    }

    this._refreshGate();
    await this._loadManifest();
  },

  _refreshGate() {
    const link = document.getElementById('dl-download-link');
    if (!link) return;
    const ready = !!this._downloadUrl;
    link.setAttribute('aria-disabled', ready ? 'false' : 'true');
    link.tabIndex = ready ? 0 : -1;
    if (ready) link.href = this._downloadUrl;
    else link.removeAttribute('href');
  },

  async _loadManifest() {
    const cardEl = document.getElementById('dl-version-card');
    const failEl = document.getElementById('dl-fail');
    const versionEl = document.getElementById('dl-version');
    const dateEl = document.getElementById('dl-date');
    const notesEl = document.getElementById('dl-notes');
    const filenameEl = document.getElementById('dl-filename');
    const shaRow = document.getElementById('dl-sha-row');
    const shaCode = document.getElementById('dl-sha-code');
    const shaPending = document.getElementById('dl-sha-pending');

    try {
      const res = await fetch(this.MANIFEST_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('manifest fetch failed: ' + res.status);
      const manifest = await res.json();
      const win = manifest && manifest.platforms && manifest.platforms['windows-x86_64'];
      if (!win || !win.url) throw new Error('manifest missing windows-x86_64 platform');

      this._downloadUrl = win.url;

      if (versionEl) versionEl.textContent = manifest.version || 'unknown version';
      if (dateEl && manifest.pub_date) {
        const d = new Date(manifest.pub_date);
        if (!isNaN(d.getTime())) {
          dateEl.textContent = 'Released ' + d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        }
      }
      if (notesEl) notesEl.textContent = manifest.notes || '';
      if (filenameEl) filenameEl.textContent = win.url.split('/').pop();

      if (win.sha256 && shaRow && shaCode) {
        shaCode.textContent = win.sha256;
        shaRow.hidden = false;
        if (shaPending) shaPending.hidden = true;
      }

      this._patchStructuredData(manifest, win);
      this._refreshGate();
    } catch (err) {
      if (cardEl) cardEl.hidden = true;
      // The notes card is manifest-fed too; empty chrome under the fail
      // notice reads as a second bug.
      const notesCard = document.getElementById('dl-notes-card');
      if (notesCard) notesCard.hidden = true;
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

  copySha() {
    const code = document.getElementById('dl-sha-code');
    const btn = document.getElementById('dl-sha-copy');
    if (!code || !btn || !navigator.clipboard) return;
    const text = code.textContent || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const original = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = original; }, 1500);
    }).catch(() => {});
  }
};

if (typeof window !== 'undefined') window.DownloadPage = DownloadPage;
