
const Drawing = class {

  static drawBoxedLevel (ctx, textStr, boxX, boxY, boxWidth, boxHeight, size = 10, fontSize = 10) {
    const padding = 4;
    const drawX = (boxX + boxWidth) - size - padding;
    const drawY = (boxY + boxHeight) - size - padding;

    ctx.fillStyle = "#FFF";
    ctx.strokeStyle = "#000";
    ctx.fillRect(drawX, drawY, size, size);
    ctx.strokeRect(drawX, drawY, size, size);

    ctx.fillStyle = "#000";
    ctx.font = `${fontSize}px Arial`;
    ctx.fillText(textStr, drawX + 3, drawY + size - 1.5);

    ctx.strokeStyle = "#FFF";
  }

  static drawCenteredText (ctx, drawX, drawY, textStr, fontSize = 12, fontColor) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#FFF";
      ctx.font = `${Math.ceil(fontSize)}px Arial`;
      ctx.fillText(textStr, drawX, drawY);
      ctx.font = `12px Arial`;
      ctx.fillStyle = "#000";
      ctx.textAlign = "left";
  }

  static drawImageCircle (ctx, icon, drawX, drawY, iconSize) {
    const halfIconSize = (iconSize / 2);

    if (!icon) {
      return;
    }

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
