// One-shot composer for client/assets/og-preview.png (1200×630).
// Run: node marketing/build-og.js
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

const W = 1200;
const H = 630;
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background — dark vertical gradient matching site palette
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0a0e1a');
  bg.addColorStop(0.5, '#0d1424');
  bg.addColorStop(1, '#070a14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle radial accent top-left
  const radial = ctx.createRadialGradient(280, 240, 0, 280, 240, 600);
  radial.addColorStop(0, 'rgba(78, 130, 255, 0.18)');
  radial.addColorStop(1, 'rgba(78, 130, 255, 0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, W, H);

  // Right-side screenshot collage — compare-grades + viewer-3d stacked at angles
  const compareImg = await loadImage(path.join(ROOT, 'marketing', 'compare-grades.png'));
  const viewerImg = await loadImage(path.join(ROOT, 'marketing', 'viewer-3d.png'));

  // Helper: draw an image in a rounded rect with shadow
  function drawCard(img, x, y, w, h, rotateDeg = 0) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((rotateDeg * Math.PI) / 180);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 12;
    const r = 12;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + r, -h / 2);
    ctx.lineTo(w / 2 - r, -h / 2);
    ctx.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    ctx.lineTo(w / 2, h / 2 - r);
    ctx.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    ctx.lineTo(-w / 2 + r, h / 2);
    ctx.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    ctx.lineTo(-w / 2, -h / 2 + r);
    ctx.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // Viewer-3d card behind, slight rotation
  drawCard(viewerImg, 700, 130, 480, 270, -3);
  // Compare-grades card front, opposite rotation
  drawCard(compareImg, 760, 320, 460, 258, 3);

  // Left side: brand + tagline
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 88px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('WC3V', 70, 110);

  // Accent underscore
  ctx.fillStyle = '#4e82ff';
  ctx.fillRect(70, 215, 110, 6);

  // Tagline — main
  ctx.fillStyle = '#e8eef9';
  ctx.font = 'bold 38px sans-serif';
  const taglineLines = [
    'Pro build orders.',
    'Replay analysis.',
    'Compare to a pro.',
  ];
  taglineLines.forEach((line, i) => {
    ctx.fillText(line, 70, 260 + i * 50);
  });

  // Subline — supporting copy
  ctx.fillStyle = '#8b9bbf';
  ctx.font = '22px sans-serif';
  ctx.fillText('Free · Open source · Parsed in your browser', 70, 460);

  // URL pill bottom-left
  ctx.fillStyle = 'rgba(78, 130, 255, 0.15)';
  ctx.strokeStyle = 'rgba(78, 130, 255, 0.6)';
  ctx.lineWidth = 1.5;
  const pillX = 70;
  const pillY = 520;
  const pillW = 180;
  const pillH = 44;
  const pillR = 22;
  ctx.beginPath();
  ctx.moveTo(pillX + pillR, pillY);
  ctx.lineTo(pillX + pillW - pillR, pillY);
  ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + pillR);
  ctx.lineTo(pillX + pillW, pillY + pillH - pillR);
  ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - pillR, pillY + pillH);
  ctx.lineTo(pillX + pillR, pillY + pillH);
  ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - pillR);
  ctx.lineTo(pillX, pillY + pillR);
  ctx.quadraticCurveTo(pillX, pillY, pillX + pillR, pillY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#a8baf0';
  ctx.font = 'bold 20px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('wc3v.com', pillX + 28, pillY + pillH / 2 + 1);

  const out = path.join(ROOT, 'client', 'assets', 'og-preview.png');
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
