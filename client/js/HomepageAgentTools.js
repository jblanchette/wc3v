/**
 * HomepageAgentTools.js — expose the homepage's real actions to in-browser AI
 * agents via WebMCP.
 *
 * The point of WebMCP over the remote MCP server at mcp.wc3v.com is that this
 * runs IN THE PAGE. It can drive the actual UI (the user watches the grid
 * filter itself) and it can reach the visitor's own replay library in
 * IndexedDB, which exists on no server and which a remote tool can never see.
 *
 * NO POLYFILL, deliberately. `document.modelContext` is feature-detected and
 * this is a no-op without it. Chrome ships it from 149 behind an origin trial,
 * and the extension-based clients inject their own polyfill into the page
 * before the page's scripts run. Vendoring one would mean a new npm dependency
 * and an esbuild step to get an IIFE (CLAUDE.md: no modules, no bundlers on the
 * client, vendored deps only in js/vendor/), to serve browsers that would not
 * have an agent attached anyway.
 *
 * Coordinator pattern, per CLAUDE.md: this owns no state. index.html's inline
 * script owns the build list and the filters and publishes window.WC3VHome;
 * this subsystem takes that reference and adapts it to tool calls.
 *
 * Canonical API is document.modelContext.registerTool(). navigator.modelContext
 * is deprecated (Chrome 150) and provideContext() was removed from the spec in
 * March 2026 — do not reintroduce either.
 */

(function () {
  'use strict';

  const RACE_NAMES = { H: 'Human', O: 'Orc', E: 'Night Elf', U: 'Undead' };
  const LEVELS = ['new', 'improving', 'pro'];
  const CLASSES = window.BuildClass.KEYS;

  function text (s) {
    return { content: [{ type: 'text', text: s }] };
  }

  function describeBuild (b) {
    const bits = [
      '**' + b.name + '** (`' + b.id + '`)',
      RACE_NAMES[b.race] || b.race,
      (b.matchups || []).join('/'),
      window.BuildClass.labelOf(b),
      (b.replays || []).length + ' replay' + ((b.replays || []).length === 1 ? '' : 's')
    ].filter(Boolean);
    return '- ' + bits.join(' — ') + '\n  ' + (b.description || '').trim();
  }

  function renderList (list, note) {
    if (!list || !list.length) {
      return 'No builds match those filters.' + (note ? '\n' + note : '');
    }
    return list.length + ' build' + (list.length === 1 ? '' : 's') + ':\n\n' +
      list.map(describeBuild).join('\n\n') +
      (note ? '\n\n' + note : '') +
      '\n\nFull detail for any of them: https://wc3v.com/builds/<id>';
  }

  const HomepageAgentTools = {
    registered: false,

    /** @param {object} home the window.WC3VHome facade published by index.html */
    install (home) {
      const ctx = (typeof document !== 'undefined') && document.modelContext;
      if (!ctx || typeof ctx.registerTool !== 'function') return false;
      if (!home) return false;
      if (this.registered) return true;

      const tools = this._tools(home);
      for (const t of tools) {
        try {
          ctx.registerTool(t);
        } catch (e) {
          // One bad tool must not take down the rest, and must never take down
          // the page: this whole subsystem is an enhancement.
          if (window.console && console.debug) {
            console.debug('[wc3v] could not register tool ' + t.name, e);
          }
        }
      }
      this.registered = true;
      return true;
    },

    _tools (home) {
      return [
        {
          name: 'filter_builds',
          title: 'Filter the build library',
          description:
            'Filter the Warcraft III build library on this page by race, matchup, ' +
            'classification or a text query, and return what matches. This drives ' +
            'the actual page, so the user sees the grid update.',
          inputSchema: {
            type: 'object',
            properties: {
              race: { type: 'string', enum: ['H', 'O', 'E', 'U'], description: 'H Human, O Orc, E Night Elf, U Undead.' },
              matchup: { type: 'string', description: 'Your race then theirs, e.g. "EvU". Requires race to agree.' },
              level: { type: 'string', enum: LEVELS, description: 'Skill band the build is written for. Sets the nav band; buildClasses is what filters the grid.' },
              buildClasses: { type: 'array', items: { type: 'string', enum: CLASSES }, description: 'Which classifications the grid shows. Omit for all of them.' },
              query: { type: 'string', description: 'Free text matched against name, hero and description.' }
            },
            additionalProperties: false
          },
          annotations: { readOnlyHint: true, openWorldHint: false },
          async execute (args) {
            const list = home.setFilters(args || {}) || [];
            return text(renderList(list, 'The page now shows exactly these.'));
          }
        },

        {
          name: 'get_build_details',
          title: 'Get one build in full',
          description:
            'Return everything known about one build: its strategy, tier progression, ' +
            'common mistakes and the pro replays behind it.',
          inputSchema: {
            type: 'object',
            properties: {
              buildId: { type: 'string', description: 'The build id, e.g. "ne-dh-fast-bear".' }
            },
            required: ['buildId'],
            additionalProperties: false
          },
          annotations: { readOnlyHint: true, openWorldHint: false },
          async execute (args) {
            const b = home.getBuild(args && args.buildId);
            if (!b) {
              const ids = (home.getAllBuilds() || []).map(x => x.id);
              return text('No build with id "' + (args && args.buildId) + '".\n\nAvailable ids:\n' +
                ids.map(i => '- ' + i).join('\n'));
            }
            let s = '# ' + b.name + '\n\n' + (b.description || '') + '\n\n';
            s += '- Race: ' + (RACE_NAMES[b.race] || b.race) + '\n';
            s += '- Matchups: ' + (b.matchups || []).join(', ') + '\n';
            s += '- Classification: ' + window.BuildClass.labelOf(b) + '\n';
            if (b.level) s += '- Level: ' + b.level + '\n';
            if (b.difficulty) s += '- Difficulty: ' + b.difficulty + '\n';
            if (b.heroOpener) s += '- Hero opener: ' + b.heroOpener + '\n';
            if ((b.strategyPoints || []).length) {
              s += '\n## How it plays\n\n' + b.strategyPoints.map(p => '- ' + p).join('\n') + '\n';
            }
            if ((b.commonMistakes || []).length) {
              s += '\n## Common mistakes\n\n' + b.commonMistakes.map(m =>
                typeof m === 'string' ? '- ' + m : '- ' + m.mistake + (m.fix ? '\n  Fix: ' + m.fix : '')
              ).join('\n') + '\n';
            }
            s += '\nPage: https://wc3v.com/builds/' + b.id;
            return text(s);
          }
        },

        {
          name: 'list_my_replays',
          title: "List the user's own parsed replays",
          description:
            "List the Warcraft III replays this visitor has parsed on this device. " +
            'These are stored only in their browser and were never uploaded, so no ' +
            'server-side tool can see them. Use this before offering to analyse ' +
            '"my last game".',
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 20.' }
            },
            additionalProperties: false
          },
          annotations: { readOnlyHint: true, openWorldHint: false },
          async execute (args) {
            const limit = (args && args.limit) || 20;
            let records;
            try {
              records = await home.listMyReplays({ limit });
            } catch (e) {
              return text('Could not read the local replay library: ' + (e && e.message));
            }
            if (!records || !records.length) {
              return text('This visitor has no parsed replays stored on this device. ' +
                'They can add one by dropping a .w3g file on https://wc3v.com/ — it is ' +
                'parsed in the browser and never uploaded.');
            }
            const lines = records.map(r => {
              const who = (r.players || []).map(p =>
                (p.name || '?') + (p.race ? ' (' + p.race + ')' : '')).join(' vs ');
              return '- `' + r.id + '` — ' + (r.map || 'unknown map') +
                (r.durationFormatted ? ', ' + r.durationFormatted : '') +
                (who ? ' — ' + who : '');
            });
            return text(records.length + ' local replay' + (records.length === 1 ? '' : 's') +
              ' on this device:\n\n' + lines.join('\n') +
              '\n\nOpen one in the 3D viewer: https://wc3v.com/viewer?local=<id>');
          }
        },

        {
          name: 'open_build',
          title: 'Open a build page',
          description:
            'Navigate this tab to a build\'s full page. Use only when the user asked ' +
            'to open or go to a build; use get_build_details to read one.',
          inputSchema: {
            type: 'object',
            properties: {
              buildId: { type: 'string', description: 'The build id.' }
            },
            required: ['buildId'],
            additionalProperties: false
          },
          // Not read-only: it navigates the user's tab.
          annotations: { readOnlyHint: false, openWorldHint: false },
          async execute (args) {
            const b = home.getBuild(args && args.buildId);
            if (!b) return text('No build with id "' + (args && args.buildId) + '".');
            home.openBuild(b.id);
            return text('Opening ' + b.name + ' at https://wc3v.com/builds/' + b.id);
          }
        }
      ];
    }
  };

  window.HomepageAgentTools = HomepageAgentTools;
})();
