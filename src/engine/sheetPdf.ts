// Fills a character sheet template (src/assets/sheets) with sheetValues(). No DOM, so the
// tests can run it too. pdf-lib is only loaded by the export (src/ui/ExportPdf.tsx).
import { PDFBool, PDFCheckBox, PDFDocument, PDFDropdown, PDFName, PDFTextField, StandardFonts } from 'pdf-lib';
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
    const da = (f.acroField.getDefaultAppearance() ?? '').replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));
    f.acroField.setDefaultAppearance(da);
    if (f instanceof PDFTextField) f.setText(value);
    else {
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
  // Every filled field now has its own appearance, so viewers can show them as they are
  // (some redraw ticked boxes empty when asked to regenerate them).
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.False);
  if (title) doc.setTitle(title);
  return { bytes: await doc.save({ updateFieldAppearances: false }), unfilled: unfilled(values, (n) => fields.has(n)) };
}
