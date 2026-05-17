// Composes 3 social-share PNGs (1200×675, Twitter/Reddit native ratio) for
// the recent feature rollout — one per piece. Self-contained: draws the UI
// mockups with canvas primitives, so it doesn't depend on screenshots of the
// running site. Outputs land alongside the other marketing/*.png assets.
//
// Run: node marketing/build-social-cards.js
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const W = 1200;
const H = 675;
const ROOT = path.resolve(__dirname, '..');

// ── Site palette ─────────────────────────────────────────────────────
const COL = {
  bgTop:   '#0a0e1a',
  bgMid:   '#0d1424',
  bgBot:   '#070a14',
  text:    '#e8eef9',
  muted:   '#8b9bbf',
  dim:     '#5e6a87',
  accent:  '#4e82ff',
  panel:   'rgba(20,22,34,0.85)',
  panelBd: 'rgba(255,255,255,0.10)',
  me:      '#6fc18a',
  them:    '#cdd1de',
  xp:      '#e8b65a',
  win:     '#8fd6a6',
  bandNew:        '#7fd4a1',   // green-ish: phea / new
  bandImproving:  '#7fc4ff',   // blue:     improving
  bandPro:        '#e8b65a',   // gold:     pro
};

// ── Drawing helpers ──────────────────────────────────────────────────
function bg(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0,   COL.bgTop);
  g.addColorStop(0.5, COL.bgMid);
  g.addColorStop(1,   COL.bgBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // radial accent top-right (subtle)
  const r = ctx.createRadialGradient(W - 200, 180, 0, W - 200, 180, 600);
  r.addColorStop(0, 'rgba(78,130,255,0.18)');
  r.addColorStop(1, 'rgba(78,130,255,0)');
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, W, H);
}

function brandStrip(ctx) {
  ctx.fillStyle = COL.text;
  ctx.font = 'bold 36px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('WC3V', 60, 56);
  ctx.fillStyle = COL.accent;
  ctx.fillRect(60, 100, 70, 4);
  ctx.fillStyle = COL.muted;
  ctx.font = '20px sans-serif';
  ctx.fillText('wc3v.com', 1000, 64);
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function headline(ctx, lines, x, y) {
  ctx.fillStyle = COL.text;
  ctx.textBaseline = 'top';
  ctx.font = 'bold 60px sans-serif';
  lines.forEach((s, i) => ctx.fillText(s, x, y + i * 70));
}

function sub(ctx, text, x, y, maxW) {
  ctx.fillStyle = COL.muted;
  ctx.textBaseline = 'top';
  ctx.font = '24px sans-serif';
  wrap(ctx, text, x, y, maxW, 32);
}

function wrap(ctx, text, x, y, maxW, lineH) {
  const words = String(text).split(' ');
  let line = '';
  let yy = y;
  for (let i = 0; i < words.length; i++) {
    const trial = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(trial).width > maxW && line) {
      ctx.fillText(line, x, yy);
      yy += lineH;
      line = words[i];
    } else line = trial;
  }
  if (line) ctx.fillText(line, x, yy);
}

// ── Card 1: Three skill bands ────────────────────────────────────────
function buildBandsCard() {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  bg(ctx);
  brandStrip(ctx);

  headline(ctx, ['Three skill bands.', 'One library.'], 60, 170);
  sub(ctx, 'Pick where you are in your WC3 journey. The site renders the build library, the build order, and the walkthrough copy to match.', 60, 320, 540);

  // Band cards stacked on the right
  const bands = [
    { color: COL.bandNew,       title: 'New to WC3', tag: 'Your first builds — the few things that actually matter.' },
    { color: COL.bandImproving, title: 'Ladder',     tag: 'Solid, copyable builds from real tournament play.' },
    { color: COL.bandPro,       title: 'Pro meta',   tag: 'Current top-level builds, tight execution.' },
  ];
  const cardW = 460, cardH = 130, gap = 18;
  const startX = 660, startY = 170;
  bands.forEach((b, i) => {
    const y = startY + i * (cardH + gap);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = COL.panel;
    roundedRect(ctx, startX, y, cardW, cardH, 14);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = COL.panelBd;
    ctx.lineWidth = 1;
    roundedRect(ctx, startX, y, cardW, cardH, 14);
    ctx.stroke();

    // Color accent dot
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(startX + 32, y + cardH / 2, 14, 0, Math.PI * 2);
    ctx.fill();
    // Glow halo
    ctx.fillStyle = b.color;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(startX + 32, y + cardH / 2, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Title + tagline
    ctx.fillStyle = b.color;
    ctx.font = 'bold 26px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(b.title, startX + 68, y + 24);
    ctx.fillStyle = COL.text;
    ctx.font = '19px sans-serif';
    wrap(ctx, b.tag, startX + 68, y + 60, cardW - 90, 26);
  });

  // Footer
  ctx.fillStyle = COL.dim;
  ctx.font = '18px sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Free · Parsed in your browser · Never uploaded', 60, H - 40);
  return c;
}

// ── Card 2: Guided walkthrough ───────────────────────────────────────
function buildWalkthroughCard() {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  bg(ctx);
  brandStrip(ctx);

  headline(ctx, ['Guide me through', 'any pro replay.'], 60, 170);
  sub(ctx, 'A 12-step coached run-through. Each beat jumps the scrubber, frames the camera, and explains why it mattered.', 60, 320, 540);

  // Mock walkthrough step card on the right
  const px = 640, py = 170, pw = 500, ph = 360;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = COL.panel;
  roundedRect(ctx, px, py, pw, ph, 16);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(232,182,90,0.30)';
  ctx.lineWidth = 1.5;
  roundedRect(ctx, px, py, pw, ph, 16);
  ctx.stroke();

  // Step pill — "Step 3 / 12"
  ctx.fillStyle = 'rgba(78,130,255,0.18)';
  roundedRect(ctx, px + 24, py + 22, 120, 30, 15);
  ctx.fill();
  ctx.fillStyle = COL.accent;
  ctx.font = 'bold 14px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('STEP 3 / 12', px + 38, py + 38);

  // Title
  ctx.fillStyle = COL.xp;
  ctx.font = 'bold 28px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('The level 3 spike', px + 24, py + 72);

  // Hero portrait placeholder
  ctx.fillStyle = '#1a2236';
  roundedRect(ctx, px + 24, py + 124, 64, 64, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(232,182,90,0.55)';
  ctx.lineWidth = 2;
  roundedRect(ctx, px + 24, py + 124, 64, 64, 8);
  ctx.stroke();
  ctx.fillStyle = COL.xp;
  ctx.font = 'bold 32px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('★3', px + 24 + 32, py + 124 + 32);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Action line
  ctx.fillStyle = COL.text;
  ctx.font = '19px sans-serif';
  wrap(ctx, 'We double up Mass Teleport at level 3 — the first time the same skill can take two points.', px + 104, py + 128, pw - 130, 26);

  // Why-it-matters callout
  const wy = py + 220;
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  roundedRect(ctx, px + 24, wy, pw - 48, 110, 10);
  ctx.fill();
  ctx.fillStyle = COL.muted;
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('WHY IT MATTERS', px + 38, wy + 14);
  ctx.fillStyle = COL.text;
  ctx.font = '17px sans-serif';
  wrap(ctx, 'A hero on the field is killing creeps for XP and gold; one parked at home is doing neither.', px + 38, wy + 38, pw - 76, 24);

  // CTA line at bottom
  ctx.fillStyle = COL.dim;
  ctx.font = '18px sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Hit "▸ Guide me" on any replay — wc3v.com', 60, H - 40);
  return c;
}

// ── Card 3: Comparison scoreboard ────────────────────────────────────
function buildCompareCard() {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  bg(ctx);
  brandStrip(ctx);

  headline(ctx, ['Head to head', 'with a pro.'], 60, 170);
  sub(ctx, 'Drop your replay. We auto-match a pro game and show the gaps in seconds: hero XP, supply, tech, army built.', 60, 320, 540);

  // Mock scoreboard panel on the right
  const px = 640, py = 160, pw = 500, ph = 410;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = COL.panel;
  roundedRect(ctx, px, py, pw, ph, 16);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = COL.panelBd;
  ctx.lineWidth = 1;
  roundedRect(ctx, px, py, pw, ph, 16);
  ctx.stroke();

  // Header: You vs Them chips
  ctx.fillStyle = COL.me;
  ctx.beginPath();
  ctx.arc(px + 30, py + 38, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COL.me;
  ctx.font = 'bold 17px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('You', px + 44, py + 38);
  ctx.fillStyle = COL.muted;
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('VS', px + 100, py + 38);
  ctx.fillStyle = COL.them;
  ctx.beginPath();
  ctx.arc(px + 142, py + 38, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COL.them;
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText('Happy', px + 156, py + 38);
  ctx.fillStyle = COL.muted;
  ctx.font = '14px sans-serif';
  ctx.fillText('Undead', px + 220, py + 38);

  // Column headers
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('YOU',  px + 230, py + 78);
  ctx.fillText('THEM', px + 360, py + 78);

  // XP race block (highlighted)
  let ry = py + 110;
  ctx.fillStyle = 'rgba(232,182,90,0.08)';
  roundedRect(ctx, px + 16, ry, pw - 32, 110, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(232,182,90,0.30)';
  ctx.lineWidth = 1;
  roundedRect(ctx, px + 16, ry, pw - 32, 110, 10);
  ctx.stroke();
  ctx.fillStyle = COL.xp;
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('THE XP RACE', px + 28, ry + 12);

  // Two rows of XP data
  drawScoreRow(ctx, px, ry + 38, 'Hero out', '0:38', '0:35', 'them', '−3s');
  drawScoreRow(ctx, px, ry + 68, 'Reached lvl 3', '5:42', '4:58', 'them', '−44s');

  // Economy block — beginner labels
  ry += 130;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('ECONOMY', px + 28, ry);
  drawScoreRow(ctx, px, ry + 24, 'Early army',    '2:19', '2:10', 'them', '−9s',  '20 food');
  drawScoreRow(ctx, px, ry + 54, 'Standing army', '4:05', '4:35', 'me',   '−30s', '30 food');
  drawScoreRow(ctx, px, ry + 84, 'Maxed army',    '7:33', '7:20', 'them', '−12s', '50 food');

  // Footer
  ctx.fillStyle = COL.dim;
  ctx.font = '18px sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Drop a .w3g at wc3v.com — parsed in-browser, nothing uploaded', 60, H - 40);
  return c;
}

function drawScoreRow(ctx, px, y, label, meVal, themVal, winner, delta, sub) {
  ctx.textBaseline = 'middle';
  // Label (with optional sub on next line)
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '14px sans-serif';
  ctx.fillText(label, px + 28, y + (sub ? -4 : 0));
  if (sub) {
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.font = '11px sans-serif';
    ctx.fillText(sub, px + 28, y + 12);
  }
  // Me column
  ctx.font = winner === 'me' ? 'bold 16px sans-serif' : '15px sans-serif';
  ctx.fillStyle = winner === 'me' ? COL.win : COL.text;
  ctx.fillText(meVal, px + 230, y);
  if (winner === 'me') {
    ctx.fillStyle = 'rgba(143,214,166,0.7)';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(delta, px + 280, y);
  }
  // Them column
  ctx.font = winner === 'them' ? 'bold 16px sans-serif' : '15px sans-serif';
  ctx.fillStyle = winner === 'them' ? COL.win : COL.text;
  ctx.fillText(themVal, px + 360, y);
  if (winner === 'them') {
    ctx.fillStyle = 'rgba(143,214,166,0.7)';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(delta, px + 410, y);
  }
}

// ── Card 4: Launch rollup (single-image hero for a Reddit launch thread) ──
function buildLaunchRollup() {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  bg(ctx);

  // Brand strip — bigger, centred-ish
  ctx.fillStyle = COL.text;
  ctx.font = 'bold 44px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('WC3V', 60, 56);
  ctx.fillStyle = COL.accent;
  ctx.fillRect(60, 112, 90, 5);
  ctx.fillStyle = COL.muted;
  ctx.font = '22px sans-serif';
  ctx.fillText('wc3v.com', 1000, 68);

  // Hero headline
  ctx.fillStyle = COL.text;
  ctx.font = 'bold 56px sans-serif';
  ctx.fillText('Three new ways to read a replay.', 60, 160);
  ctx.fillStyle = COL.muted;
  ctx.font = '22px sans-serif';
  ctx.fillText('A Warcraft III replay simulator — built for learning the game.', 60, 232);

  // Three feature panels along the bottom
  const panels = [
    {
      tint: COL.bandNew,
      title: 'Skill bands',
      blurb: 'New / Ladder / Pro — pick the audience the site renders for.',
      draw: drawBandsMini,
    },
    {
      tint: COL.xp,
      title: 'Guide me',
      blurb: '12 coached steps. Camera framing, why-it-matters lines.',
      draw: drawWalkthroughMini,
    },
    {
      tint: COL.win,
      title: 'You vs them',
      blurb: 'Milestone scoreboard. Hero XP, food, tech, army built.',
      draw: drawCompareMini,
    },
  ];
  const pw = 350, ph = 320, gap = 22;
  const totalW = pw * 3 + gap * 2;
  const startX = (W - totalW) / 2;
  const startY = 305;
  panels.forEach((p, i) => {
    const x = startX + i * (pw + gap);
    // Shadow + bg
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = COL.panel;
    roundedRect(ctx, x, startY, pw, ph, 14);
    ctx.fill();
    ctx.restore();
    // Tint border
    ctx.strokeStyle = p.tint;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    roundedRect(ctx, x, startY, pw, ph, 14);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Title
    ctx.fillStyle = p.tint;
    ctx.font = 'bold 24px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(p.title, x + 22, startY + 20);
    // Blurb
    ctx.fillStyle = COL.text;
    ctx.font = '15px sans-serif';
    wrap(ctx, p.blurb, x + 22, startY + 54, pw - 44, 22);

    // Mini mockup
    p.draw(ctx, x + 22, startY + 120, pw - 44, ph - 140);
  });

  // Footer
  ctx.fillStyle = COL.dim;
  ctx.font = '18px sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Free · Open source · Parsed in your browser · Nothing uploaded', 60, H - 30);
  return c;
}

// Mini band chips (3 stacked rows with a dot + label)
function drawBandsMini(ctx, x, y, w, h) {
  const bands = [
    { c: COL.bandNew,       l: 'New to WC3' },
    { c: COL.bandImproving, l: 'Ladder' },
    { c: COL.bandPro,       l: 'Pro meta' },
  ];
  const rowH = (h - 8) / 3;
  bands.forEach((b, i) => {
    const ry = y + i * rowH;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundedRect(ctx, x, ry, w, rowH - 8, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    roundedRect(ctx, x, ry, w, rowH - 8, 8);
    ctx.stroke();
    ctx.fillStyle = b.c;
    ctx.beginPath();
    ctx.arc(x + 22, ry + (rowH - 8) / 2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = b.c;
    ctx.font = 'bold 17px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.l, x + 42, ry + (rowH - 8) / 2);
  });
}

// Mini walkthrough step card (step pill + title + hero portrait)
function drawWalkthroughMini(ctx, x, y, w, h) {
  // Step pill
  ctx.fillStyle = 'rgba(78,130,255,0.20)';
  roundedRect(ctx, x, y, 90, 24, 12);
  ctx.fill();
  ctx.fillStyle = COL.accent;
  ctx.font = 'bold 12px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('STEP 3 / 12', x + 12, y + 13);
  // Title
  ctx.fillStyle = COL.xp;
  ctx.font = 'bold 20px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('The level 3 spike', x, y + 36);
  // Hero portrait + line
  ctx.fillStyle = '#1a2236';
  roundedRect(ctx, x, y + 70, 52, 52, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(232,182,90,0.55)';
  ctx.lineWidth = 2;
  roundedRect(ctx, x, y + 70, 52, 52, 6);
  ctx.stroke();
  ctx.fillStyle = COL.xp;
  ctx.font = 'bold 24px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('★3', x + 26, y + 96);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  // Coaching text
  ctx.fillStyle = COL.text;
  ctx.font = '13px sans-serif';
  wrap(ctx, 'Double up Mass Teleport — the first skill spike of the game.', x + 64, y + 72, w - 64, 19);
  // Why-it-matters strip
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  roundedRect(ctx, x, y + 138, w, 38, 8);
  ctx.fill();
  ctx.fillStyle = COL.muted;
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText('WHY IT MATTERS', x + 10, y + 144);
  ctx.fillStyle = COL.text;
  ctx.font = '12px sans-serif';
  wrap(ctx, 'A hero on the field is killing creeps — one at home isn\'t.', x + 10, y + 158, w - 20, 14);
}

// Mini compare scoreboard (3 rows: hero, food, food)
function drawCompareMini(ctx, x, y, w, h) {
  // Col headers
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = 'bold 10px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('YOU',  x + 130, y);
  ctx.fillText('THEM', x + 215, y);
  // XP block
  ctx.fillStyle = 'rgba(232,182,90,0.10)';
  roundedRect(ctx, x, y + 18, w, 56, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(232,182,90,0.35)';
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y + 18, w, 56, 8);
  ctx.stroke();
  ctx.fillStyle = COL.xp;
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('THE XP RACE', x + 10, y + 25);
  miniRow(ctx, x, y + 46, 'Reached lvl 3', '5:42', '4:58', 'them', '−44s');
  // Economy rows
  miniRow(ctx, x, y + 90,  'Early army',    '2:19', '2:10', 'them', '−9s',  '20 food');
  miniRow(ctx, x, y + 124, 'Standing army', '4:05', '4:35', 'me',   '−30s', '30 food');
  miniRow(ctx, x, y + 158, 'Maxed army',    '7:33', '7:20', 'them', '−12s', '50 food');
}
function miniRow(ctx, x, y, label, me, them, winner, delta, sub) {
  ctx.textBaseline = 'middle';
  // Label + sub
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = '11px sans-serif';
  ctx.fillText(label, x + 4, y + (sub ? -3 : 0));
  if (sub) {
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.font = '9px sans-serif';
    ctx.fillText(sub, x + 4, y + 9);
  }
  // Me
  ctx.font = winner === 'me' ? 'bold 12px sans-serif' : '11px sans-serif';
  ctx.fillStyle = winner === 'me' ? COL.win : COL.text;
  ctx.fillText(me, x + 130, y);
  if (winner === 'me') {
    ctx.fillStyle = 'rgba(143,214,166,0.7)';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText(delta, x + 165, y);
  }
  // Them
  ctx.font = winner === 'them' ? 'bold 12px sans-serif' : '11px sans-serif';
  ctx.fillStyle = winner === 'them' ? COL.win : COL.text;
  ctx.fillText(them, x + 215, y);
  if (winner === 'them') {
    ctx.fillStyle = 'rgba(143,214,166,0.7)';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText(delta, x + 250, y);
  }
}

// ── Run ──────────────────────────────────────────────────────────────
const out = (name, canvas) => {
  const p = path.join(ROOT, 'marketing', name);
  fs.writeFileSync(p, canvas.toBuffer('image/png'));
  console.log('wrote', p, fs.statSync(p).size, 'bytes');
};

out('social-bands.png',        buildBandsCard());
out('social-walkthrough.png',  buildWalkthroughCard());
out('social-compare.png',      buildCompareCard());
out('launch-rollup.png',       buildLaunchRollup());
