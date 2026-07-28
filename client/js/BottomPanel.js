/**
 * BottomPanel — single tabbed container for all bottom-left side overlays.
 *
 * Previously we had three independent floating panels (Battle Report,
 * Economy, Camp Ring Key) that competed for screen real estate, overlapped
 * the minimap and player status. This consolidates them into one panel
 * with tabs so the bottom-left corner is predictable and tidy.
 *
 * Tabs live at the panel top; content lives below. Click a tab to switch.
 * The panel itself is collapsible via the title bar (▾/▸ toggle).
 *
 * Other renderers (BattleReportRenderer, ResourceCharts, CampPanel) own
 * their own DOM and ask the BottomPanel to host it as tab content. Keeps
 * rendering logic separated from layout.
 */

(function () {
  class BottomPanel {
    constructor () {
      this.el = null;
      this.tabBarEl = null;
      this.bodyEl = null;
      this.headerEl = null;
      this.tabs = [];          // [{ id, label, btn, contentEl, badgeEl }]
      this.activeId = null;
      // ALWAYS collapsed on load. Previously persisted via localStorage,
      // but "default closed" was getting defeated whenever the user had
      // opened it in a prior session. Open state is intentional + cheap
      // to recover (one click), so we don't remember it.
      this._collapsed = true;
      // Fired whenever the visible tab changes (switch, collapse, expand).
      // Per-frame consumers skip work for hidden tabs, so when one becomes
      // visible again the viewer needs a frame to bring it up to date — which
      // won't happen on its own while paused with the render loop stopped.
      this.onVisibilityChange = null;
    }

    _emitVisibilityChange () {
      if (typeof this.onVisibilityChange === 'function') this.onVisibilityChange(this.activeId);
    }

    setup () {
      this.el = document.getElementById('insights-panel');
      if (!this.el) return;
      this.headerEl = this.el.querySelector('.ip-header');
      this.tabBarEl = this.el.querySelector('.ip-tabs');
      this.bodyEl = this.el.querySelector('.ip-body');
      const title = this.el.querySelector('.ip-title');
      if (title) {
        title.addEventListener('click', () => this._toggleCollapsed());
      }
      this._applyCollapsed();
    }

    _toggleCollapsed () {
      this._collapsed = !this._collapsed;
      this._applyCollapsed();
      this._emitVisibilityChange();
    }

    _applyCollapsed () {
      if (!this.el) return;
      this.el.classList.toggle('ip-collapsed', this._collapsed);
    }

    /**
     * Register a tab.
     * @param {string} id        — stable identifier
     * @param {string} label     — display text on the tab button
     * @param {Element} contentEl — DOM node to show when tab is active
     * @param {Object} opts
     *   @param {boolean} [opts.default] — make this the active tab on register
     *   @param {string}  [opts.badge]   — small text next to label (e.g. count)
     */
    addTab (id, label, contentEl, opts) {
      if (!this.el || !this.tabBarEl || !this.bodyEl) return;
      opts = opts || {};
      if (this.tabs.find(t => t.id === id)) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ip-tab';
      btn.dataset.tabId = id;
      const labelEl = document.createElement('span');
      labelEl.className = 'ip-tab-label';
      labelEl.textContent = label;
      btn.appendChild(labelEl);
      const badgeEl = document.createElement('span');
      badgeEl.className = 'ip-tab-badge';
      badgeEl.hidden = true;
      btn.appendChild(badgeEl);
      this.tabBarEl.appendChild(btn);

      // Move content into the body and hide initially.
      contentEl.classList.add('ip-tab-content');
      contentEl.dataset.tabId = id;
      contentEl.hidden = true;
      this.bodyEl.appendChild(contentEl);

      btn.addEventListener('click', () => this.activate(id));

      const tab = { id, label, btn, contentEl, badgeEl };
      this.tabs.push(tab);

      if (opts.badge != null) this.setBadge(id, opts.badge);
      // Set active ID without expanding the panel (so default-collapsed
      // state is preserved when tabs register).
      if (opts.default || !this.activeId) {
        this.activeId = id;
        for (const t of this.tabs) {
          const on = (t.id === id);
          t.btn.classList.toggle('ip-tab-active', on);
          t.contentEl.hidden = !on;
        }
      }

      // Reveal panel once at least one tab is registered.
      this.el.hidden = false;
    }

    // Public activate: triggered by a user click on a tab button. Auto-
    // expands the panel because that's the intent of clicking a tab.
    activate (id) {
      if (!this._setActiveTab(id)) return;
      if (this._collapsed) this._toggleCollapsed();
    }

    // Internal: switch active tab WITHOUT auto-expanding. Used by
    // setTabVisible's fallback so hiding a tab doesn't surprise-open the
    // panel.
    _setActiveTab (id) {
      const tab = this.tabs.find(t => t.id === id);
      if (!tab) return false;
      this.activeId = id;
      for (const t of this.tabs) {
        const on = (t.id === id);
        t.btn.classList.toggle('ip-tab-active', on);
        t.contentEl.hidden = !on;
      }
      this._emitVisibilityChange();
      return true;
    }

    // Hide or show the entire tab (button + content). When the only visible
    // tab is hidden, falls back to the next visible tab.
    setTabVisible (id, visible) {
      const tab = this.tabs.find(t => t.id === id);
      if (!tab) return;
      tab.btn.hidden = !visible;
      if (!visible) {
        tab.contentEl.hidden = true;
        if (this.activeId === id) {
          const nextTab = this.tabs.find(t => t.id !== id && !t.btn.hidden);
          // Internal switch — do not auto-expand a collapsed panel as a
          // side effect of hiding a tab.
          if (nextTab) this._setActiveTab(nextTab.id);
        }
      }
    }

    // Is this tab's content actually on screen right now? Per-frame subsystems
    // (chart cursors, log sync) use this to skip work nobody can see — a hidden
    // tab's content element is `hidden`, and a collapsed panel shows none of it.
    isTabShowing (id) {
      if (this._collapsed) return false;
      if (this.activeId !== id) return false;
      const tab = this.tabs.find(t => t.id === id);
      return !!(tab && !tab.btn.hidden && !tab.contentEl.hidden);
    }

    setBadge (id, value) {
      const tab = this.tabs.find(t => t.id === id);
      if (!tab) return;
      if (value == null || value === '' || value === 0 || value === '0') {
        tab.badgeEl.hidden = true;
        tab.badgeEl.textContent = '';
      } else {
        tab.badgeEl.hidden = false;
        tab.badgeEl.textContent = String(value);
      }
    }
  }

  window.BottomPanel = BottomPanel;
})();
