// Fills a character sheet template (src/assets/sheets) with sheetValues(). No DOM, so the
// tests can run it too. pdf-lib is only loaded by the export (src/ui/ExportPdf.tsx).
import { cmyk, PDFBool, PDFCheckBox, PDFDocument, PDFDropdown, PDFName, PDFTextField, StandardFonts } from 'pdf-lib';
import { unfilled, type SheetValues } from './sheetExport';

export interface FilledSheet {
  bytes: Uint8Array;
  /** What didn't fit on the sheet, e.g. "3 items". */
  unfilled: string[];
}

/** Stand-ins for characters the sheet's Helvetica (WinAnsi) can't draw. */
const SUBSTITUTES: Record<string, string> = { '\u2212': '-', '\u2010': '-', '\u2011': '-', '\u2192': '->', '\u2190': '<-', '\u2194': '<->', '\u2264': '<=', '\u2265': '>=', '\u2248': '~', '\u00d7': 'x', '\u2153': '1/3', '\u2154': '2/3', '\u2715': 'x', '\u2713': 'v', '\u00a0': ' ', '\u2009': ' ', '\u202f': ' ' };

/** Text the font can draw: known stand-ins swapped in, anything else left out. */
export function printable(text: string, canDraw: (code: number) => boolean): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if (ch === '\n' || canDraw(code)) out += ch;
    else if (SUBSTITUTES[ch]) out += SUBSTITUTES[ch];
    else {
      // Accented letters the font lacks keep their base letter (ā → a).
      const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (base && [...base].every((c) => canDraw(c.codePointAt(0)!))) out += base;
    }
  }
  return out;
}

/** Printed bubble rows and the field that holds their maximum. */
const BUBBLE_MAX: Record<string, string> = { vitality: 'vitality_max', radiance: 'radiance_max', rest_charge: 'rest_charges_max' };

/** The default appearance with its font size lowered, if needed, so `text` fits `width`. */
export function fitSize(da: string, text: string, width: number, font: { widthOfTextAtSize(t: string, s: number): number }): string {
  const m = /([\d.]+) Tf/.exec(da);
  const size = m ? Number(m[1]) : 0;
  if (!size || !width || !text) return da;
  // pdf-lib keeps about 2pt of padding each side.
  const room = width - 4;
  const wide = font.widthOfTextAtSize(text, size);
  if (wide <= room) return da;
  const fit = Math.max(4, Math.floor(((size * room) / wide) * 2) / 2);
  return da.replace(/[\d.]+ Tf/, `${fit} Tf`);
}

export async function fillSheet(template: ArrayBuffer | Uint8Array, values: SheetValues, title?: string): Promise<FilledSheet> {
  const doc = await PDFDocument.load(template);
  const form = doc.getForm();
  const fields = new Map(form.getFields().map((f) => [f.getName(), f]));
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // Helvetica and Helvetica-Bold share WinAnsi's character set.
  const charset = new Set(regular.getCharacterSet());
  const canDraw = (code: number) => charset.has(code);
  for (const [name, raw] of Object.entries(values)) {
    const f = fields.get(name);
    const value = typeof raw === 'string' ? printable(raw, canDraw) : raw;
    if (f instanceof PDFCheckBox) {
      if (value === true) f.check();
      else f.uncheck();
      continue;
    }
    if (!(f instanceof PDFTextField || f instanceof PDFDropdown) || typeof value !== 'string') continue;
    // The templates write the default appearance (font, size, text colour) with octal escapes
    // ("\\057Helv"), which pdf-lib reads as is: decode it so filled text keeps the sheet's colour.
    let da = (f.acroField.getDefaultAppearance() ?? '').replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));
    f.acroField.setDefaultAppearance(da);
    if (f instanceof PDFTextField) {
      f.setText(value);
      // Shrink one-line text that's wider than its box (e.g. a Tandem Initiative "d4 / d6").
      if (!f.isMultiline()) {
        da = fitSize(da, value, f.acroField.getWidgets()[0]?.getRectangle().width ?? 0, /HeBo/.test(da) ? bold : regular);
        f.acroField.setDefaultAppearance(da);
      }
    } else {
      // The dropdowns are editable, so a number past the list is kept too.
      if (!f.getOptions().includes(value)) f.addOptions(value);
      f.select(value);
    }
    // Big numbers and headings are bold (/HeBo in the default appearance).
    f.updateAppearances(/HeBo/.test(da) ? bold : regular);
    // pdf-lib points the default appearance at its embedded font; restore the sheet's, so
    // viewers that redraw fields as you edit them keep the same font and colour.
    f.acroField.setDefaultAppearance(da);
  }
  // Printed bubbles past the character's maximum are removed, so only the ones they have show:
  // the field goes, and its printed ring is painted over in the panel's white.
  for (const [bubble, max] of Object.entries(BUBBLE_MAX)) {
    const raw = values[max];
    const n = typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
    if (!Number.isInteger(n)) continue;
    for (let i = Math.max(0, n) + 1; fields.has(`${bubble}_${i}`); i++) {
      const f = fields.get(`${bubble}_${i}`)!;
      for (const w of f.acroField.getWidgets()) {
        const page = doc.findPageForAnnotationRef(doc.context.getObjectRef(w.dict)!);
        const r = w.getRectangle();
        page?.drawRectangle({ x: r.x - 1, y: r.y - 1, width: r.width + 2, height: r.height + 2, color: cmyk(0, 0, 0, 0) });
      }
      form.removeField(f);
    }
  }
  // Every filled field now has its own appearance, so viewers can show them as they are
  // (some redraw ticked boxes empty when asked to regenerate them).
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.False);
  if (title) doc.setTitle(title);
  return { bytes: await doc.save({ updateFieldAppearances: false }), unfilled: unfilled(values, (n) => fields.has(n)) };
}
