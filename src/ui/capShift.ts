// Centring button and field labels whatever font the device falls back to.
//
// The app bundles no text font, so each device draws labels in its own. Browsers
// centre the font's whole line, not its capitals, and fonts such as Windows'
// Segoe UI have a tall ascent and a short descent, so their capitals sit a
// pixel or two low. This measures how far, for the font actually in use, and
// hands it to the styles as `--cap-shift` (in em): controls take it off their
// top padding and add it to the bottom.
//
// A set line height (the page's 1.45) adds a pixel of error of its own, as the
// gap above the letters is rounded down, so controls use the font's own line
// height, and `--line-fix` (em, per side) pads them back to the size they had.

export interface LabelFix {
  /** How far below the line's middle the capitals' middle sits, in em (negative: above). */
  capShift: number;
  /** Half the difference between the page's line height and the font's own, in em. */
  lineFix: number;
}

// Measured at a size where layout's whole-pixel rounding is negligible.
const SIZE = 200;

/**
 * Lays out one line of the font at its own line height, as a control would,
 * and finds where the browser put the baseline in it (some fonts add their
 * line gap unevenly); the capitals' height comes from the canvas.
 */
export function measureLabelFix(family: string, weight = '400', root: HTMLElement = document.documentElement): LabelFix {
  const none = { capShift: 0, lineFix: 0 };
  const body = document.body;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!body || !ctx) return none;
  ctx.font = `${weight} ${SIZE}px ${family}`;
  const cap = ctx.measureText('H').actualBoundingBoxAscent;

  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;margin:0;padding:0;border:0;white-space:nowrap;line-height:normal;font-size:${SIZE}px;font-weight:${weight}`;
  probe.style.fontFamily = family;
  probe.append('H');
  const mark = document.createElement('span');
  mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  probe.append(mark);
  body.append(probe);
  const box = probe.getBoundingClientRect();
  const baseline = mark.getBoundingClientRect().top - box.top;
  probe.remove();

  if (!(cap > 0) || !(box.height > 0)) return none;
  const capShift = (baseline - cap / 2 - box.height / 2) / SIZE;

  const style = getComputedStyle(root);
  const size = parseFloat(style.fontSize);
  const set = parseFloat(style.lineHeight);
  const lineFix = size > 0 && Number.isFinite(set) ? (set / size - box.height / SIZE) / 2 : 0;
  // A sane font is off by a fraction of its size; anything bigger is a bad reading.
  return {
    capShift: Math.abs(capShift) < 0.2 ? capShift : 0,
    lineFix: Math.abs(lineFix) < 0.5 ? lineFix : 0,
  };
}

/** Sets `--cap-shift` and `--line-fix` for the page's text font, now and whenever a font finishes loading. */
export function applyCapShift(root: HTMLElement = document.documentElement): void {
  const update = () => {
    const style = getComputedStyle(document.body ?? root);
    const fix = measureLabelFix(style.fontFamily, style.fontWeight, root);
    root.style.setProperty('--cap-shift', `${Number(fix.capShift.toFixed(4))}em`);
    root.style.setProperty('--line-fix', `${Number(fix.lineFix.toFixed(4))}em`);
  };
  update();
  document.fonts?.addEventListener?.('loadingdone', update);
  document.fonts?.ready.then(update).catch(() => {});
}
