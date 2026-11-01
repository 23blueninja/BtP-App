import { useState } from 'react';
import type { Character } from '../engine/character';
import type { Derived } from '../engine/derive';
import { sheetValues } from '../engine/sheetExport';
import { Modal } from './common';
import darkUrl from '../assets/sheets/character-sheet-dark.pdf?url';
import lightUrl from '../assets/sheets/character-sheet-light.pdf?url';
import printableUrl from '../assets/sheets/character-sheet-printable.pdf?url';

const VERSIONS = [
  { id: 'dark', label: 'Dark', url: darkUrl, note: 'Like the app. For filling in on a screen.' },
  { id: 'light', label: 'Light', url: lightUrl, note: 'White, for filling in on a screen.' },
  { id: 'printable', label: 'Printable', url: printableUrl, note: 'For printing: print colours, bubbles to fill by hand, AP tracked with a d6.' },
] as const;

/** Header button: downloads the character as a fillable PDF character sheet. */
export function ExportPdfButton({ c, d }: { c: Character; d: Derived }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<{ error?: string; unfilled?: string[] } | null>(null);
  const close = () => (setOpen(false), setResult(null));
  const run = async (v: (typeof VERSIONS)[number]) => {
    setBusy(v.id);
    setResult(null);
    try {
      // pdf-lib and the template are only loaded when you export.
      const [{ fillSheet }, template] = await Promise.all([
        import('../engine/sheetPdf'),
        fetch(v.url).then((r) => {
          if (!r.ok) throw new Error(`The sheet template didn't load (${r.status}).`);
          return r.arrayBuffer();
        }),
      ]);
      const name = c.name.trim() || 'Character';
      const out = await fillSheet(template, sheetValues(c, d), `${name} – Beyond the Prism character sheet`);
      const url = URL.createObjectURL(new Blob([out.bytes as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/[^\w-]+/g, '_')}-${v.id}.pdf`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setResult({ unfilled: out.unfilled });
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy('');
    }
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Download a fillable PDF character sheet">
        ⇩ PDF
      </button>
      {open && (
        <Modal title="Export PDF character sheet" onClose={close}>
          <p className="small muted">A fillable PDF with this character filled in. Pick a version:</p>
          <ul className="plain export-pdf">
            {VERSIONS.map((v) => (
              <li key={v.id}>
                <button type="button" className={v.id === 'dark' ? 'primary' : ''} disabled={!!busy} onClick={() => run(v)}>
                  {busy === v.id ? 'Exporting…' : v.label}
                </button>
                <span className="small muted">{v.note}</span>
              </li>
            ))}
          </ul>
          {result?.error && <p className="warn small">Couldn't export: {result.error}</p>}
          {result?.unfilled && (
            <p className="small" role="status">
              Downloaded.
              {result.unfilled.length > 0 && <> Not everything fit on the sheet: {result.unfilled.join(', ')} left out.</>}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
