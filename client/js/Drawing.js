
const Drawing = class {
  static drawCenteredText (ctx, drawX, drawY, textStr, fontSize = 12) {
      const drawTextX = (drawX - (textStr.length * fontSize) * 0.25);

      ctx.fillStyle = "#FFF";
      ctx.font = `${Math.ceil(fontSize)}px Arial`;
      ctx.fillText(textStr, drawTextX, drawY);
      ctx.font = `12px Arial`;
      ctx.fillStyle = "#000";
  }

  static drawImageCircle (ctx, icon, drawX, drawY, iconSize) {
    const halfIconSize = (iconSize / 2);

    ctx.save();
    ctx.beginPath();
    ctx.arc(drawX, drawY, halfIconSize, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();

    // draw the icons
    ctx.drawImage(
      icon, 
      (drawX - halfIconSize), 
      (drawY - halfIconSize), 
      iconSize, 
      iconSize
    );

    // draw the icon ring
    ctx.beginPath();
    ctx.arc(drawX, drawY, halfIconSize, 0, Math.PI * 2, true);
    ctx.stroke();
    ctx.closePath();

    ctx.restore();
  }

  static rescaleX (x, transform) {
    const range = x.range().map(transform.invertX, transform),
        domain = range.map(x.invert, x);
    return x.copy().domain(domain);
  }

  static rescaleY (y, transform) {
    const range = y.range().map(transform.invertY, transform),
        domain = range.map(y.invert, y);
    return y.copy().domain(domain);
  }
};

window.Drawing = Drawing;
