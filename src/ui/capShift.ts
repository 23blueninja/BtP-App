// Centring button and field labels whatever font the device falls back to.
//
// The app bundles no text font, so each device draws labels in its own. Browsers
// centre the font's whole line (ascent + descent), not its capitals, and fonts
// such as Windows' Segoe UI have a tall ascent and a short descent, so their
// capitals sit a pixel or two low. This measures how far, for the font actually
// in use, and hands it to the styles as `--cap-shift` (in em): controls take it
// off their top padding and add it to the bottom.
//
// A set line height (the page's 1.45) adds a pixel of error of its own, as the
// gap above the letters is rounded down, so controls use the font's own line
// height, and `--line-fix` (em, per side) pads them back to the size they had.

/** How far below the line's middle the capitals' middle sits, in em (negative: above). */
export function measureCapShift(family: string, weight = '400'): number {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  // Measured at a size where layout's whole-pixel rounding of the ascent and descent is negligible.
  const size = 200;
  ctx.font = `${weight} ${size}px ${family}`;
  const m = ctx.measureText('H');
  const ascent = m.fontBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent;
  const cap = m.actualBoundingBoxAscent;
  if (![ascent, descent, cap].every((v) => Number.isFinite(v)) || cap <= 0) return 0;
  const shift = (ascent - descent - cap) / 2 / size;
  // A sane font is off by a fraction of its size; anything bigger is a bad reading.
  return Math.abs(shift) < 0.2 ? shift : 0;
}

/** Half the difference between the page's line height and the font's own, in em. */
export function measureLineFix(root: HTMLElement = document.documentElement): number {
  if (!document.body) return 0;
  const style = getComputedStyle(root);
  const size = parseFloat(style.fontSize);
  const set = parseFloat(style.lineHeight);
  if (!(size > 0) || !Number.isFinite(set)) return 0;
  const probe = document.createElement('div');
  probe.textContent = 'H';
  probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;line-height:normal;font-size:200px;white-space:nowrap';
  document.body.append(probe);
  const own = probe.getBoundingClientRect().height / 200;
  probe.remove();
  const fix = (set / size - own) / 2;
  return own > 0 && Math.abs(fix) < 0.5 ? fix : 0;
}

/** Sets `--cap-shift` and `--line-fix` for the page's text font, now and whenever a font finishes loading. */
export function applyCapShift(root: HTMLElement = document.documentElement): void {
  const update = () => {
    const style = getComputedStyle(document.body ?? root);
    const shift = measureCapShift(style.fontFamily, style.fontWeight);
    root.style.setProperty('--cap-shift', `${Number(shift.toFixed(4))}em`);
    root.style.setProperty('--line-fix', `${Number(measureLineFix(root).toFixed(4))}em`);
  };
  update();
  document.fonts?.addEventListener?.('loadingdone', update);
  document.fonts?.ready.then(update).catch(() => {});
}
