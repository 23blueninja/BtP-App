"""Fillable BtP character sheet (AcroForm), in the character builder's design language.

    npm run build-sheets      (python3 scripts/character-sheet/build.py)

Needs Python 3 with reportlab, pypdf and Pillow. Writes three versions of the same
layout to src/assets/sheets/: character-sheet-dark.pdf and character-sheet-light.pdf (on
screen: tracked numbers are dropdowns) and character-sheet-printable.pdf (light, CMYK,
bubbles, AP tracked with a d6), plus fields.json listing every field. The app fills
them in (src/ui/ExportPdf.tsx) with the values from src/engine/sheetExport.ts.
Basic actions and Conditions are printed from src/content/rules.json, so re-run this
after `npm run parse-rules`. Open Sans is under the SIL Open Font License (fonts/OFL.txt).
"""
import json
import math
import sys
import tempfile
from pathlib import Path

from reportlab.lib.colors import CMYKColor, Color, HexColor, rgb2cmyk
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

REPO = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / 'src/assets/sheets'
TMP = Path(tempfile.mkdtemp())
FONTS = Path(__file__).parent / 'fonts'
ICONS = REPO / 'src/assets/icons'

for name, file in [('OS', 'OpenSans_400Regular.ttf'), ('OS-Semi', 'OpenSans_600SemiBold.ttf'), ('OS-Bold', 'OpenSans_700Bold.ttf'), ('OS-XBold', 'OpenSans_800ExtraBold.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(FONTS / file)))

W, H = letter
M = 22  # page margin
GAP = 6
CUT = 6  # bevelled corner

# App palette (src/styles.css). The print variant keeps hues, swaps the ground.
PRISM_TEXT = ['#ff5f6d', '#ffb35c', '#ffe066', '#5fd39a', '#4fd1ff', '#7aa2ff', '#c38bff']
PRISM_FIELD = ['#1fb84a', '#15b3b3', '#1f5bff', '#1a1aa8', '#8a1fd6', '#d61fa3', '#e0262e', '#e88a1a', '#1fb84a']
# Light versions: a bright cyan / magenta / yellow gradient (Arch, 2026-11-01). Titles use
# deeper stops of the same hues so they stay readable on white.
CMY = ['#ffff00', '#00ffff', '#ff00ff']
CMY_TITLE = ['#e0a800', '#00a8e0', '#d600d6']
LIGHT = dict(bg='#ffffff', panel='#ffffff', panel2='#f1f3fa', border='#b9c0dd', text='#141833', muted='#5a6189', accent='#3a66cc', fill='#3a66cc',
             pip='#b000c8', line='#aab2d4', edge_alpha=1.0, title=CMY_TITLE, edge=CMY, top=CMY, grid=False, cmyk=False, ap_d6=False, ruled=True)
THEMES = {
    # On screen, like the app.
    'dark': dict(bg='#000000', panel='#090a0f', panel2='#181a24', border='#2e3658', text='#e8eaf6', muted='#9aa1c4', accent='#7aa2ff', fill='#3a66cc',
                 pip='#c38bff', line='#3a4266', edge_alpha=0.6, title=PRISM_TEXT, edge=PRISM_FIELD, top=PRISM_TEXT, grid=True, cmyk=False, ap_d6=False, ruled=False),
    # On screen, white.
    'light': LIGHT,
    # For printing: CMYK process colours, AP tracked with a d6.
    'printable': {**LIGHT, 'cmyk': True, 'ap_d6': True},
}

# Static reference data from the rules (so the sheet stays in step with rules.json).
rules = json.load(open(REPO / 'src/content/rules.json'))


def walk(ns):
    for n in ns:
        yield n
        yield from walk(n.get('children') or [])


NODES = {n['id']: n for n in walk(rules['sections'])}
BASIC = [(a['title'], (a.get('fields') or {}).get('Cost', ''), (a.get('fields') or {}).get('Categories', '')) for a in NODES['beyond-the-prism/action-list']['children'][0]['children']]
CONDITIONS = [(c['title'].replace(' X', ''), c['title'].endswith(' X')) for c in NODES['beyond-the-prism/conditions/condition-list']['children']]
ATTRS = [('VIG', 'Vigor'), ('AGI', 'Agility'), ('PER', 'Perception'), ('INT', 'Intelligence'), ('PRS', 'Presence')]
LIGHTS = ['Flame', 'Frost', 'Pneuma', 'Soma', 'Mordant', 'Velvet', 'Infernal', 'Lunar', 'Temporal', 'Platinum']
LIGHT_TEXT = {'Flame': '#ff9a52', 'Frost': '#5ff0ff', 'Pneuma': '#ff5cf0', 'Soma': '#5ce6c6', 'Mordant': '#f0dc5a', 'Velvet': '#b48cff', 'Infernal': '#ff5a6e', 'Lunar': '#6f8dff', 'Temporal': '#6fd97a', 'Platinum': '#e3e6ef'}


_TINTS = {}


def tinted(key, prism, theme):
    from PIL import Image
    k = (key, prism, theme)
    if k not in _TINTS:
        mask = Image.open(ICONS / f'{key}.png').convert('RGBA').split()[3]
        n = mask.size[0]
        if prism:
            stops = [HexColor(c) for c in THEMES[theme]['title']]
            img = Image.new('RGB', mask.size)
            px = img.load()
            for yy in range(n):
                for xx in range(n):
                    f = (xx + yy) / (2 * n - 2) * (len(stops) - 1)
                    i = min(int(f), len(stops) - 2)
                    a, b, u = stops[i], stops[i + 1], f - i
                    px[xx, yy] = tuple(int(255 * (getattr(a, ch) * (1 - u) + getattr(b, ch) * u)) for ch in ('red', 'green', 'blue'))
        else:
            img = Image.new('RGB', mask.size, THEMES[theme]['text'])
        img.putalpha(mask)
        out = TMP / f'{key}-{int(prism)}-{theme}.png'
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out)
        _TINTS[k] = str(out)
    return _TINTS[k]


class Sheet:
    def __init__(self, path, theme):
        # The print version is built in CMYK (process colours) for printers.
        self.cmyk = THEMES[theme]['cmyk']
        self.theme = theme
        self.t = {k: (self.col(v) if isinstance(v, str) and v.startswith('#') else v) for k, v in THEMES[theme].items()}
        self.c = canvas.Canvas(str(path), pagesize=letter, invariant=1)
        self.c.setTitle('Beyond the Prism character sheet')
        self.c.setAuthor('23BLUENINJA')
        self.fields = []  # (name, kind, page, tooltip)
        self.center = set()
        self.right = set()
        self.choices = set()
        self.pips = {}
        self.page = 1

    def col(self, hexstr, alpha=1.0):
        h = HexColor(hexstr)
        if self.cmyk:
            return CMYKColor(*rgb2cmyk(h.red, h.green, h.blue), alpha=alpha)
        return Color(h.red, h.green, h.blue, alpha=alpha)

    # ---- primitives (y is measured from the top of the page) ----
    def Y(self, y):
        return H - y

    def bevel(self, x, y, w, h, cut=CUT):
        p = self.c.beginPath()
        b = self.Y(y + h)
        t = self.Y(y)
        p.moveTo(x + cut, b)
        p.lineTo(x + w - cut, b)
        p.lineTo(x + w, b + cut)
        p.lineTo(x + w, t - cut)
        p.lineTo(x + w - cut, t)
        p.lineTo(x + cut, t)
        p.lineTo(x, t - cut)
        p.lineTo(x, b + cut)
        p.close()
        return p

    def gradient(self, x0, y0, x1, y1, stops, alpha=1.0):
        cols = [self.col(s if isinstance(s, str) else s.hexval().replace('0x', '#'), alpha) for s in stops]
        self.c.linearGradient(x0, self.Y(y0), x1, self.Y(y1), cols, extend=True)

    def page_bg(self, title):
        c, t = self.c, self.t
        c.setFillColor(t['bg'])
        c.rect(0, 0, W, H, stroke=0, fill=1)
        if t['grid']:
            # The app's prism lattice, faint and static.
            c.saveState()
            c.setLineWidth(0.5)
            s = 70
            hgt = s * math.sqrt(3) / 2
            c.setStrokeColor(self.col('#5966e6', 0.10))
            for i in range(-12, 30):
                x0 = i * s
                c.line(x0, 0, x0 + H / math.sqrt(3), H)
                c.line(x0, 0, x0 - H / math.sqrt(3), H)
            for j in range(0, int(H / hgt) + 2):
                c.line(0, j * hgt, W, j * hgt)
            c.restoreState()
        # Prism rule across the top, like the app bar.
        c.saveState()
        p = c.beginPath()
        p.rect(0, H - 3, W, 3)
        c.clipPath(p, stroke=0, fill=0)
        self.gradient(0, 0, W, 0, self.t['top'])
        c.restoreState()
        # Footer
        c.setFont('OS', 6.5)
        c.setFillColor(t['muted'])
        c.drawString(M, 12, 'Beyond the Prism · Character sheet')
        c.drawRightString(W - M, 12, f'{title} · page {self.page}')

    def gtext(self, x, y, s, font='OS-Bold', size=8, space=0.9, stops=None, width=None):
        """Prism-gradient text (the app's box titles): text as a clip, then a gradient."""
        c = self.c
        stops = stops or self.t['title']
        w = width or (pdfmetrics.stringWidth(s, font, size) + space * len(s))
        c.saveState()
        to = c.beginText(x, self.Y(y))
        to.setFont(font, size)
        to.setCharSpace(space)
        to.setTextRenderMode(7)
        to.textOut(s)
        c.drawText(to)
        self.gradient(x, y, x + max(w, 40), y - size, stops)
        c.restoreState()
        return w

    def text(self, x, y, s, font='OS', size=7, color=None, align='left', space=0):
        c = self.c
        c.setFillColor(color or self.t['text'])
        to = c.beginText()
        to.setFont(font, size)
        to.setCharSpace(space)
        wid = pdfmetrics.stringWidth(s, font, size) + space * len(s)
        xx = x - wid if align == 'right' else x - wid / 2 if align == 'center' else x
        to.setTextOrigin(xx, self.Y(y))
        to.textOut(s)
        c.drawText(to)

    def label(self, x, y, s, align='left', size=5.6):
        self.text(x, y, s.upper(), 'OS-Semi', size, self.t['muted'], align, space=0.5)

    def panel(self, x, y, w, h, title=None, fill=None):
        """A box: dark glass fill, prismatic bevelled edge, gradient title."""
        c, t = self.c, self.t
        c.saveState()
        c.setFillColor(fill or t['panel'])
        c.setStrokeColor(t['panel'])
        c.drawPath(self.bevel(x, y, w, h), stroke=0, fill=1)
        c.restoreState()
        self._ring(x, y, w, h)
        if title:
            self.gtext(x + 8, y + 12, title.upper())
        return (x + 8, y + (18 if title else 8), w - 16)

    def _ring(self, x, y, w, h):
        c, t = self.c, self.t
        c.saveState()
        p = c.beginPath()
        for (xx, yy, ww, hh, cut) in [(x, y, w, h, CUT), (x + 1.1, y + 1.1, w - 2.2, h - 2.2, CUT - 0.45)]:
            b, tp = self.Y(yy + hh), self.Y(yy)
            p.moveTo(xx + cut, b)
            p.lineTo(xx + ww - cut, b)
            p.lineTo(xx + ww, b + cut)
            p.lineTo(xx + ww, tp - cut)
            p.lineTo(xx + ww - cut, tp)
            p.lineTo(xx + cut, tp)
            p.lineTo(xx, tp - cut)
            p.lineTo(xx, b + cut)
            p.close()
        c.clipPath(p, stroke=0, fill=0, fillMode=0)  # even-odd: just the ring
        # The prism field is pinned to the page, so each edge takes the colour behind it.
        self.gradient(0, 0, W, H, t['edge'], alpha=t['edge_alpha'])
        c.restoreState()

    def icon(self, key, x, y, size, prism=False):
        """The app's symbols are masks: filled with the heading gradient (attributes) or the text colour."""
        self.c.drawImage(tinted(key, prism, self.theme), x, self.Y(y + size), size, size, mask='auto')

    # ---- form fields ----
    def field(self, name, x, y, w, h, size=8, tip='', multiline=False, center=False, line=True, font='Helvetica', box=False, right=False):
        c, t = self.c, self.t
        if line and not box:
            c.setStrokeColor(t['line'])
            c.setLineWidth(0.5)
            c.line(x, self.Y(y + h), x + w, self.Y(y + h))
        if box:
            c.setFillColor(t['panel2'])
            c.setStrokeColor(t['line'])
            c.setLineWidth(0.5)
            c.drawPath(self.bevel(x, y, w, h, 3), stroke=1, fill=1)
        flags = 'multiline' if multiline else ''
        c.acroForm.textfield(name=name, tooltip=tip or name, x=x + 1, y=self.Y(y + h) + (0 if multiline else 0.5), width=w - 2, height=h - 1,
                             fontName=font, fontSize=7.5 if multiline and size == 0 else size, borderWidth=0, borderColor=None, fillColor=None,
                             textColor=t['text'], fieldFlags=flags, maxlen=None if multiline else 400)
        self.fields.append((name, 'text', self.page, tip))
        if center:
            self.center.add(name)
        if right:
            self.right.add(name)

    def pyramid(self, prefix, x, y, w, title, row_h=13, bonus=False):
        """A Bulk pyramid like the app's: row r (Bulk rank r) has r slots."""
        c, t = self.c, self.t
        tw = pdfmetrics.stringWidth(title, 'OS-Semi', 7)
        self.text(x + w / 2, y + 7, title, 'OS-Semi', 7, t['text'], 'center')
        if bonus:
            self.icon('VIG', x + w / 2 - tw / 2 - 10, y, 8, prism=True)
        y += 11
        for r in range(1, 6):
            self.text(x + 3, y + row_h - 4, str(r), 'OS', 6, t['muted'], 'center')
            sx = x + 10
            sw = (w - 10 - (r - 1) * 3) / r
            for i in range(1, r + 1):
                c.setFillColor(t['panel2'])
                c.setStrokeColor(t['line'])
                c.setLineWidth(0.5)
                c.drawPath(self.bevel(sx, y, sw, row_h - 2, 2.5), stroke=1, fill=1)
                self.field(f'{prefix}_{r}_{i}', sx + 1, y, sw - 2, row_h - 2, 6.5, f'{title}: Bulk {r} slot {i}', line=False, center=True)
                sx += sw + 3
            y += row_h
        return y

    def lines(self, prefix, x, y, w, h, step=15, size=8.5, tip='', ruled=True):
        """One field per ruled line, so typed text always sits on the printed lines."""
        n = int(h // step)
        for i in range(1, n + 1):
            self.field(f'{prefix}_{i}', x, y + (i - 1) * step, w, step, size, f'{tip} line {i}', line=ruled)
        return n

    def pip(self, name, x, y, d=9, tip=''):
        """A bubble like the app's pips: circle outline, fills when ticked."""
        c, t = self.c, self.t
        c.setStrokeColor(t['pip'])
        c.setLineWidth(0.8)
        c.circle(x + d / 2, self.Y(y + d / 2), d / 2, stroke=1, fill=0)
        c.acroForm.checkbox(name=name, tooltip=tip or name, x=x, y=self.Y(y + d), size=d, buttonStyle='circle', shape='circle', borderWidth=0,
                            borderColor=None, fillColor=None, textColor=t['pip'], fieldFlags='')
        self.fields.append((name, 'check', self.page, tip))
        self.pips[name] = (d, t['pip'])

    def counter(self, name, x, y, w, h, top, size=8, tip='', max_field=None, max_w=20):
        """On screen, a tracked number is a dropdown (one click to set, and you can type too),
        optionally followed by "of <max>"."""
        c, t = self.c, self.t
        c.setFillColor(t['panel2'])
        c.setStrokeColor(t['line'])
        c.setLineWidth(0.5)
        c.drawPath(self.bevel(x, y, w, h, 2.5), stroke=1, fill=1)
        c.acroForm.choice(name=name, tooltip=tip or name, value=' ', options=[' '] + [str(i) for i in range(top + 1)], x=x + 1, y=self.Y(y + h) + 0.5,
                          width=w - 2, height=h - 1, fontName='Helvetica-Bold', fontSize=size, borderWidth=0, borderColor=None, fillColor=None,
                          textColor=t['text'], fieldFlags='combo edit')
        self.fields.append((name, 'choice', self.page, tip))
        self.choices.add(name)
        self.center.add(name)
        if max_field:
            self.text(x + w + 3, y + h - (h - 6) / 2 - 1, 'of', 'OS', 6.5, t['muted'])
            self.field(max_field, x + w + 12, y, max_w, h, size, f'{tip} maximum', center=True)

    def check(self, name, x, y, d=7, tip=''):
        c, t = self.c, self.t
        c.setStrokeColor(t['line'])
        c.setLineWidth(0.6)
        c.drawPath(self.bevel(x, y, d, d, 1.5), stroke=1, fill=0)
        c.acroForm.checkbox(name=name, tooltip=tip or name, x=x, y=self.Y(y + d), size=d, buttonStyle='check', borderWidth=0,
                            borderColor=None, fillColor=None, textColor=t['accent'], fieldFlags='')
        self.fields.append((name, 'check', self.page, tip))

    def table(self, x, y, w, cols, rows, prefix, row_h=13, size=7.5, header=True):
        """cols: [(key, label, width_fraction, center)]; fields are <prefix>_<n>_<key>."""
        cy = y
        if header:
            cx = x
            for key, lab, frac, cen in cols:
                cw = w * frac
                self.label(cx + (cw / 2 if cen else 1), cy + 6, lab, 'center' if cen else 'left')
                cx += cw
            cy += 8
        for r in range(1, rows + 1):
            cx = x
            for key, lab, frac, cen in cols:
                cw = w * frac
                self.field(f'{prefix}_{r}_{key}', cx + 1, cy, cw - 3, row_h, size, f'{prefix.title()} {r}: {lab}', center=cen)
                cx += cw
            cy += row_h
        return cy

    def new_page(self, title):
        self.page_bg(title)

    def finish_page(self):
        self.c.showPage()
        self.page += 1


def build(theme, path):
    s = Sheet(path, theme)
    t = s.t
    c = s.c
    cw = W - 2 * M
    bottom = H - 22

    def name_line(y):
        s.label(M, y + 6, 'Character')
        s.field(f'p{s.page}_name', M + 44, y, 200, 10, 8, 'Character name (repeated)')
        return y + 16

    # ================= Page 1: Sheet =================
    s.new_page('Sheet')
    y = M
    s.label(M, y + 6, 'Character name')
    s.field('name', M, y + 8, 160, 22, 15, 'Character name', font='Helvetica-Bold')
    for i, (key, lab) in enumerate([('age', 'Age'), ('devotion', 'Devotion')]):
        s.label(M + 170, y + 6 + i * 23, lab)
        s.field(key, M + 170, y + 8 + i * 23, 84, 13, 8, lab)
    bx = M + 262
    for key, lab, wd in [('player', 'Player', 110), ('level', 'Level', 34), ('background', 'Background', 160)]:
        s.label(bx, y + 6, lab)
        s.field(key, bx, y + 8, wd - 6, 13, 8, lab, center=key == 'level')
        bx += wd
    bx = M + 262
    for key, lab, wd in [('ancestry', 'Ancestry', 110), ('class', 'Class', 98), ('subclass', 'Subclass', 96)]:
        s.label(bx, y + 29, lab)
        s.field(key, bx, y + 31, wd - 6, 13, 8, lab)
        bx += wd
    y += 50

    # Stat strip: Class Bonus / Class Die, five Attributes, AP.
    sh = 86
    s.panel(M, y, 92, sh)
    c.setStrokeColor(t['border'])
    c.setLineWidth(0.8)
    c.line(M + 4, s.Y(y + sh * 0.62), M + 88, s.Y(y + sh * 0.38))
    s.gtext(M + 7, y + 12, 'CLASS BONUS', size=6.2, space=0.6)
    s.text(M + 8, y + 32, '+', 'OS-Bold', 15)
    s.field('class_bonus', M + 18, y + 17, 34, 20, 15, 'Class Bonus', font='Helvetica-Bold', line=False)
    s.field('class_die', M + 40, y + 48, 46, 20, 15, 'Class Die (e.g. d6)', font='Helvetica-Bold', line=False, center=True)
    # The Class Die's name, e.g. "Arcana" + the printed "Die".
    s.field('class_die_name', M + 8, y + 69, 58, 11, 7, 'Class Die name (e.g. Arcana)', right=True)
    s.text(M + 67, y + 78, 'Die', 'OS-Semi', 7)
    ax = M + 92 + GAP
    aw = (cw - 92 - 74 - GAP * 6) / 5
    for key, nm in ATTRS:
        s.panel(ax, y, aw, sh)
        s.gtext(ax + aw / 2 - (pdfmetrics.stringWidth(nm.upper(), 'OS-Bold', 7) + 0.8 * len(nm)) / 2, y + 13, nm.upper(), size=7, space=0.8)
        s.icon(key, ax + 8, y + 24, 26, prism=True)
        s.field(f'{key}_die', ax + 36, y + 22, aw - 44, 30, 20, f'{nm} Mod Die', font='Helvetica-Bold', line=False)
        s.label(ax + 8, y + 66, 'Points')
        s.field(f'{key}_points', ax + 8, y + 68, aw - 16, 12, 8, f'{nm} points', center=True)
        ax += aw + GAP
    # AP: bubbles on screen; on paper, tracked with a d6 at the table.
    s.panel(ax, y, 74, sh)
    s.icon('AP', ax + 8, y + 6, 10, prism=True)
    s.gtext(ax + 21, y + 14, 'AP', size=7)
    if t['ap_d6']:
        s.text(ax + 37, y + 36, 'Track with', 'OS', 7, t['muted'], 'center')
        s.text(ax + 37, y + 46, 'a d6', 'OS-Semi', 8, t['text'], 'center')
    else:
        s.counter('ap', ax + 8, y + 26, 30, 22, 5, 14, 'AP')
        s.text(ax + 42, y + 41, 'of 5', 'OS', 7, t['muted'])
    s.label(ax + 8, y + 66, 'Temp AP')
    s.field('ap_temp', ax + 8, y + 68, 58, 12, 8, 'Temporary AP', center=True)
    y += sh + GAP

    # Top row: Initiative/AC/Movement/Radius square, Endurance, Radiance + I respond to, Save Checks.
    th = 128
    sq = 52
    for i, (key, lab) in enumerate([('initiative', 'Initiative'), ('ac', 'AC'), ('movement', 'Movement'), ('perception_radius', 'PER Radius')]):
        bx = M + (i % 2) * (sq + GAP)
        bh = (th - GAP) / 2
        by = y + (i // 2) * (bh + GAP)
        s.panel(bx, by, sq, bh)
        if key == 'perception_radius':
            s.icon('PER', bx + 7, by + 5, 8, prism=True)
            s.gtext(bx + 17, by + 12, 'RADIUS', size=6.2, space=0.6)
        else:
            s.gtext(bx + sq / 2 - (pdfmetrics.stringWidth(lab.upper(), 'OS-Bold', 6.2) + 0.6 * len(lab)) / 2, by + 12, lab.upper(), size=6.2, space=0.6)
        s.field(key, bx + 5, by + 19, sq - 10, 24, 16, lab, font='Helvetica-Bold', line=False, center=True)
        if key == 'ac':
            s.field('ac_armor', bx + 5, by + 46, sq - 10, 9, 5.5, 'Armor (e.g. Basic Light)', center=True)
    ex = M + 2 * sq + 2 * GAP
    ew = 128
    s.panel(ex, y, ew, th, 'Endurance')
    s.label(ex + ew - 34, y + 12, 'Temp', 'right')
    s.field('endurance_temp', ex + ew - 32, y + 4, 24, 11, 8, 'Temporary Endurance', center=True, box=True)
    s.field('endurance', ex + 8, y + 20, 62, 34, 26, 'Current Endurance', font='Helvetica-Bold', line=False, center=True)
    c.setStrokeColor(t['line'])
    c.line(ex + 74, s.Y(y + 56), ex + 86, s.Y(y + 20))
    s.label(ex + 104, y + 26, 'Max', 'center')
    s.field('endurance_max', ex + 88, y + 30, 32, 18, 13, 'Maximum Endurance', center=True, line=False)
    yy = y + 76
    s.text(ex + 8, yy + 7, 'Vitality', 'OS-Semi', 7)
    if t['ap_d6']:
        for i in range(8):
            s.pip(f'vitality_{i + 1}', ex + 46 + i * 9.6, yy, 8, f'Vitality {i + 1}')
    else:
        s.counter('vitality', ex + 50, yy - 1, 26, 11, 10, 8, 'Vitality', 'vitality_max', 24)
    yy += 22
    s.text(ex + 8, yy + 8, 'Dying', 'OS-Semi', 7, t['accent'])
    s.field('dying', ex + 86, yy, 34, 11, 8, 'Dying level', center=True)

    rx = ex + ew + GAP
    rw = 128
    s.panel(rx, y, rw, 34, 'Radiance')
    if t['ap_d6']:
        for i in range(8):
            s.pip(f'radiance_{i + 1}', rx + 10 + i * 13.5, y + 18, 10, f'Radiance {i + 1}')
    else:
        s.counter('radiance', rx + 62, y + 4, 26, 12, 10, 8, 'Radiance', 'radiance_max', 24)
    s.panel(rx, y + 34 + GAP, rw, th - 34 - GAP, 'I respond to new…')
    for i, (key, lab, opts) in enumerate([('situations', 'Situations with', 'Action / Patience'), ('problems', 'Problems with', 'Reason / Instinct'), ('people', 'People with', 'Apathy / Empathy')]):
        ry = y + 34 + GAP + 24 + i * 25
        s.text(rx + 8, ry, lab, 'OS', 7)
        s.field(f'respond_{key}', rx + 8, ry + 2, rw - 16, 12, 8, f'I respond to new {lab.lower()} ({opts})')
        s.text(rx + rw - 8, ry, opts, 'OS', 7, t['muted'], 'right')

    sx = rx + rw + GAP
    sw = W - M - sx
    s.panel(sx, y, sw, th, 'Save Checks')
    for i, (key, nm) in enumerate(ATTRS):
        ry = y + 20 + i * 21
        s.icon(key, sx + 8, ry + 1, 11, prism=True)
        s.field(f'{key}_save', sx + 22, ry, 44, 13, 9, f'{nm} Save Check dice', font='Helvetica-Bold')
        s.field(f'{key}_save_notes', sx + 70, ry, sw - 78, 13, 6.5, f'{nm} Save Check notes')
    y += th + GAP

    # Weapons, full width.
    wh = 18 + 8 + 5 * 13 + 6
    bx, by, bw = s.panel(M, y, cw, wh, 'Weapons')
    s.table(bx, by, bw, [('name', 'Weapon', 0.24, False), ('mod', 'Mod Die', 0.09, True), ('dv', 'DV / Deadly DV', 0.15, True), ('damage', 'Damage', 0.19, False), ('properties', 'Properties', 0.33, False)], 5, 'weapon')
    y += wh + GAP

    colw = (cw - 2 * GAP) / 3
    x1, x2, x3 = M, M + colw + GAP, M + 2 * (colw + GAP)
    ytop = y
    skill_cols = [('name', 'Name', 0.56, False), ('die', 'Mod Die', 0.18, True), ('rank', 'Rank', 0.26, False)]

    # Column 1: Professions (6), Hobbies (fill), Rest.
    ph = 18 + 8 + 6 * 12 + 6
    bx, by, bw = s.panel(x1, y, colw, ph, 'Professions')
    s.table(bx, by, bw, skill_cols, 6, 'profession', 12, 7)
    y += ph + GAP
    rest_h = 46
    hh = bottom - rest_h - GAP - y
    n_hobby = int((hh - 18 - 8 - 6) // 12)
    bx, by, bw = s.panel(x1, y, colw, hh, 'Hobbies')
    s.table(bx, by, bw, skill_cols, n_hobby, 'hobby', 12, 7)
    y += hh + GAP
    bx, by, bw = s.panel(x1, y, colw, rest_h, 'Rest')
    s.text(bx, by + 8, 'Rest Charges', 'OS', 7)
    if t['ap_d6']:
        for i in range(8):
            s.pip(f'rest_charge_{i + 1}', bx + 54 + i * 11.5, by, 9, f'Rest Charge {i + 1}')
    else:
        s.counter('rest_charges', bx + 58, by - 1, 26, 11, 10, 8, 'Rest Charges', 'rest_charges_max', 24)
    s.label(bx, by + 22, 'Short Rests since Long Rest')
    s.check('short_rest_1', bx + bw - 20, by + 16, 7, 'Short Rest 1')
    s.check('short_rest_2', bx + bw - 10, by + 16, 7, 'Short Rest 2')

    # Column 2: Experiences (3), then the Conditions checklist (from the rules' condition list).
    y = ytop
    eh = 18 + 3 * 27 + 2
    bx, by, bw = s.panel(x2, y, colw, eh, 'Experiences')
    for r in range(1, 4):
        ry = by + (r - 1) * 27
        s.field(f'experience_{r}_name', bx, ry, bw * 0.72, 12, 7.5, f'Experience {r}: name', font='Helvetica-Bold')
        s.label(bx + bw * 0.76, ry + 9, 'Uses')
        s.field(f'experience_{r}_uses', bx + bw * 0.88, ry, bw * 0.12, 12, 7.5, f'Experience {r}: uses', center=True)
        s.field(f'experience_{r}_effect', bx, ry + 13, bw, 11, 6.5, f'Experience {r}: effect')
    y += eh + GAP
    bx, by, bw = s.panel(x2, y, colw, bottom - y, 'Conditions')
    s.text(bx, by + 4, 'Tick a condition; write its level beside it.', 'OS', 5.6, t['muted'])
    half = math.ceil(len(CONDITIONS) / 2)
    rowh = min(17, (bottom - by - 16) / half)
    for i, (nm, leveled) in enumerate(CONDITIONS):
        col, row = divmod(i, half)
        cx = bx + col * (bw / 2)
        cy = by + 9 + row * rowh
        key = 'cond_' + nm.lower().replace(' ', '_')
        s.check(key, cx, cy + 1, 7, nm)
        s.text(cx + 10, cy + 7, nm, 'OS', 6.8)
        if leveled:
            s.field(key + '_level', cx + bw / 2 - 22, cy, 16, 9, 7, f'{nm} level', center=True)

    # Column 3: Defenses, Movement & Senses, Alignments (fills the rest).
    y = ytop
    dh = 112
    bx, by, bw = s.panel(x3, y, colw, dh, 'Defenses')
    for i, (key, lab) in enumerate([('resistances', 'Resistances'), ('immunities', 'Immunities'), ('vulnerabilities', 'Vulnerabilities')]):
        s.label(bx, by + 4 + i * 30, lab)
        s.field(key, bx, by + 6 + i * 30, bw, 22, 0, f'{lab} (e.g. Psychic 2)', multiline=True, box=True)
    y += dh + GAP
    mh = 18 + 3 * 13 + 10 + 34 + 8
    bx, by, bw = s.panel(x3, y, colw, mh, 'Movement & Senses')
    for i, (key, lab) in enumerate([('movement_other', 'Other Movement'), ('jump_long', 'Max Long Jump'), ('jump_high', 'Max High Jump')]):
        s.text(bx, by + 8 + i * 13, lab, 'OS', 6.8)
        s.field(key, bx + 62, by + i * 13, bw - 62, 11, 7.5, lab)
    s.label(bx, by + 46, 'Senses')
    s.field('senses', bx, by + 48, bw, 34, 0, 'Senses', multiline=True, box=True)
    y += mh + GAP
    bx, by, bw = s.panel(x3, y, colw, bottom - y, 'Alignments')
    s.label(bx + 1, by + 6, 'Light')
    s.label(bx + bw * 0.62 + 1, by + 6, 'Level')
    by += 8
    n_align = int((bottom - by - 8) // 13)
    for i in range(n_align):
        ry = by + i * 13
        s.field(f'alignment_{i + 1}_light', bx, ry, bw * 0.6, 12, 7.5, f'Alignment {i + 1}: Light ({", ".join(LIGHTS)})')
        s.field(f'alignment_{i + 1}_level', bx + bw * 0.62, ry, bw * 0.38, 12, 7.5, f'Alignment {i + 1}: level (Weak, Firm, Strong)')
    s.finish_page()

    # ================= Page 2: Facets & Actions =================
    s.new_page('Facets & Actions')
    y = name_line(M)
    trh = 18 + 4 * 13.5 + 4
    bx, by, bw = s.panel(M, y, cw, trh, 'Training')
    half = (bw - 12) / 2
    for col, rows in enumerate([[('training_armor', 'Armor'), ('training_weapons', 'Weapons'), ('training_saves', 'Save Checks'), ('languages', 'Languages')],
                                [('maneuver_attr', 'Maneuver Mod Die'), ('spell_attr', 'Spell Mod Die'), ('action_categories', 'Action categories')]]):
        fx = bx + col * (half + 12)
        for row, (key, lab) in enumerate(rows):
            s.text(fx, by + 8 + row * 13.5, lab, 'OS-Semi', 6.8)
            s.field(key, fx + 70, by + row * 13.5, half - 70, 12, 7.5, lab)
    y += trh + GAP

    lw = cw * 0.58
    ah = 300
    bx, by, bw = s.panel(M, y, lw, ah, 'Actions')
    s.text(bx, by + 2, 'From your facets and class (Arcane, Combat, Supernatural…)', 'OS', 5.8, t['muted'])
    s.table(bx, by + 6, bw, [('name', 'Name', 0.27, False), ('cost', 'Cost', 0.2, False), ('categories', 'Categories', 0.2, False), ('notes', 'Notes', 0.33, False)], 18, 'action', 14, 7)
    rx = M + lw + GAP
    rw = cw - lw - GAP
    bx, by, bw = s.panel(rx, y, rw, ah, 'Basic actions')
    s.label(bx, by + 6, 'Action')
    s.icon('AP', bx + bw * 0.42, by, 6, prism=True)
    s.label(bx + bw * 0.42 + 8, by + 6, 'Cost')
    ry = by + 10
    rh = (ah - 34) / len(BASIC)
    for nm, cost, cats in BASIC:
        s.text(bx, ry + 8, nm, 'OS-Semi', 6.8, t['accent'])
        short = cost.replace('{AP}', 'AP').replace('Reaction, ', 'Reaction ')
        fs = 6.2
        while pdfmetrics.stringWidth(short, 'OS', fs) > bw * 0.58 and fs > 4.6:
            fs -= 0.2
        s.text(bx + bw * 0.42, ry + 8, short, 'OS', fs)
        c.setStrokeColor(t['border'])
        c.setLineWidth(0.3)
        c.line(bx, s.Y(ry + rh - 0.5), bx + bw, s.Y(ry + rh - 0.5))
        ry += rh
    y += ah + GAP
    fh = bottom - y
    bx, by, bw = s.panel(M, y, cw, fh, 'Facets & Active Effects')
    s.text(bx, by + 2, 'Ancestry, background, class and subclass facets; Check Modifiers, temporary effects, and items and effects from your PM', 'OS', 5.8, t['muted'])
    s.field('facets', bx, by + 6, bw, fh - 30, 0, 'Facets and active effects', multiline=True, box=True)
    s.finish_page()

    # ================= Page 3: Spells & Maneuvers =================
    s.new_page('Spells & Maneuvers')
    y = name_line(M)
    rh_ = 58
    bwid = (cw - 4 * GAP) / 5
    bx = M
    for key, lab in [('spell_mod_die', 'Spell Mod Die'), ('maneuver_mod_die', 'Maneuver Mod Die')]:
        s.panel(bx, y, bwid, rh_, lab)
        s.field(key, bx + 8, y + 20, bwid - 16, 28, 18, lab, font='Helvetica-Bold', line=False, center=True)
        bx += bwid + GAP
    for i in range(3):
        s.panel(bx, y, bwid, rh_)
        s.field(f'resource_{i + 1}_name', bx + 8, y + 4, bwid - 16, 12, 7.5, f'Class resource {i + 1} name (e.g. Prisma, Prismaburn)', font='Helvetica-Bold')
        s.field(f'resource_{i + 1}_value', bx + 8, y + 22, (bwid - 16) * 0.45, 26, 17, f'Resource {i + 1}: current / applied', font='Helvetica-Bold', line=False, center=True)
        s.text(bx + bwid / 2, y + 41, '/', 'OS', 14, t['muted'], 'center')
        s.field(f'resource_{i + 1}_max', bx + bwid / 2 + 4, y + 22, (bwid - 16) * 0.45, 26, 17, f'Resource {i + 1}: limit / max', line=False, center=True)
        bx += bwid + GAP
    y += rh_ + GAP
    sp_rows = 30
    sph = bottom - y
    bx, by, bw = s.panel(M, y, cw, sph, 'Spells & maneuvers')
    s.text(bx, by + 2, 'Tick Prepared. Known spells, cantrips and maneuvers.', 'OS', 5.8, t['muted'])
    cols = [('prepared', 'Prep', 0.05, True), ('name', 'Name', 0.2, False), ('level', 'Level', 0.06, True), ('cast_time', 'Cast / Exec. time', 0.12, False),
            ('range', 'Range', 0.1, False), ('duration', 'Duration', 0.12, False), ('components', 'Components', 0.12, False), ('notes', 'Notes', 0.23, False)]
    cy = by + 8
    cx = bx
    for key, lab, frac, cen in cols:
        cwid = bw * frac
        s.label(cx + (cwid / 2 if cen else 1), cy + 6, lab, 'center' if cen else 'left')
        cx += cwid
    cy += 9
    rowh = (sph - 26 - 17) / sp_rows
    for r in range(1, sp_rows + 1):
        cx = bx
        for key, lab, frac, cen in cols:
            cwid = bw * frac
            if key == 'prepared':
                s.check(f'spell_{r}_prepared', cx + cwid / 2 - 3.5, cy + 3, 7, f'Spell {r}: Prepared')
            else:
                s.field(f'spell_{r}_{key}', cx + 1, cy, cwid - 3, rowh, 7, f'Spell {r}: {lab}', center=cen)
            cx += cwid
        cy += rowh
    s.finish_page()

    item_cols = [('name', 'Item', 0.34, False), ('bulk', 'Bulk', 0.08, True), ('qty', '#', 0.07, True), ('stored', 'Stored in', 0.17, False), ('notes', 'Notes', 0.34, False)]

    # ================= Page 4: Equipment =================
    s.new_page('Equipment')
    y = name_line(M)
    pyr_h = 18 + 11 + 5 * 14 + 14
    bx, by, bw = s.panel(M, y, cw, pyr_h, 'Inventory pyramid')
    s.text(bx + bw, by - 6, 'Rows are Bulk ranks 1–5. A Bonus row needs that many VIG points.', 'OS', 5.6, t['muted'], 'right')
    pw = (bw - 24) / 2
    s.pyramid('inv', bx, by, pw, 'Inventory', 14)
    s.pyramid('bonus_inv', bx + pw + 24, by, pw, 'Bonus Inventory (VIG)', 14, bonus=True)
    y += pyr_h + GAP
    lw = cw * 0.62
    rw = cw - lw - GAP
    rx = M + lw + GAP
    ih = bottom - y
    bx, by, bw = s.panel(M, y, lw, ih, 'Inventory')
    s.text(bx, by + 2, 'Stored in: the backpack or container holding the item.', 'OS', 5.8, t['muted'])
    n_items = int((ih - 18 - 6 - 8 - 8) // 14)
    s.table(bx, by + 6, bw, item_cols, n_items, 'item', 14, 7)
    arh = 98
    bx, by, bw = s.panel(rx, y, rw, arh, 'Armor')
    for i, (key, lab) in enumerate([('armor_type', 'Type'), ('armor_quality', 'Quality'), ('armor_ac', 'AC from armor')]):
        s.text(bx, by + 8 + i * 15, lab, 'OS-Semi', 6.8)
        s.field(key, bx + 58, by + i * 15, bw - 58, 12, 8, f'Armor {lab}')
    s.label(bx, by + 58, 'Armor notes')
    s.field('armor_notes', bx, by + 60, bw, 12, 7, 'Armor notes')
    # Appearance and Backstory share the rest of the column, 1/3 and 2/3.
    rest = ih - arh - 2 * GAP
    ap_h = rest / 3
    bx, by, bw = s.panel(rx, y + arh + GAP, rw, ap_h, 'Appearance')
    s.field('appearance', bx, by, bw, ap_h - 26, 0, 'Appearance', multiline=True, box=True)
    by0 = y + arh + GAP + ap_h + GAP
    bx, by, bw = s.panel(rx, by0, rw, rest - ap_h, 'Backstory')
    s.field('backstory', bx, by, bw, rest - ap_h - 26, 0, 'Backstory', multiline=True, box=True)
    s.finish_page()

    # ================= Page 5: Session notes =================
    s.new_page('Session notes')
    y = name_line(M)
    bx, by, bw = s.panel(M, y, cw, bottom - y, 'Session notes')
    s.lines('session_notes', bx, by, bw, bottom - by - 8, 15, 8.5, 'Session notes', ruled=t['ruled'])
    s.finish_page()

    # ================= Page 6: Bonus sheet (a backpack or other container) =================
    s.new_page('Bonus: container')
    y = name_line(M)
    nh = 40
    bx, by, bw = s.panel(M, y, cw, nh, 'Backpack or container')
    for key, lab, fx, fw in [('container_name', 'Name', 0, 0.45), ('container_bulk', 'Its Bulk', 0.48, 0.12), ('container_notes', 'Notes', 0.63, 0.37)]:
        s.label(bx + bw * fx, by + 4, lab)
        s.field(key, bx + bw * fx, by + 6, bw * fw - 4, 12, 8, f'Container {lab.lower()}', center=key == 'container_bulk')
    y += nh + GAP
    pyr_h = 18 + 11 + 5 * 16 + 6
    bx, by, bw = s.panel(M, y, cw, pyr_h, 'Container pyramid')
    s.text(bx + bw, by - 6, 'Rows are Bulk ranks 1–5. Containers have no Bonus rows.', 'OS', 5.6, t['muted'], 'right')
    s.pyramid('container_inv', bx + bw * 0.15, by, bw * 0.7, 'Container', 16)
    y += pyr_h + GAP
    ih = bottom - y
    bx, by, bw = s.panel(M, y, cw, ih, 'Contents')
    n_items = int((ih - 18 - 8 - 8) // 14)
    s.table(bx, by, bw, [('name', 'Item', 0.4, False), ('bulk', 'Bulk', 0.08, True), ('qty', '#', 0.07, True), ('notes', 'Notes', 0.45, False)], n_items, 'container_item', 14, 7)
    s.finish_page()
    s.c.save()
    return s


def post(path, s):
    """Centre the fields that should be centred, and ask viewers to draw values."""
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import NameObject, NumberObject, BooleanObject, DictionaryObject, DecodedStreamObject, ArrayObject, FloatObject
    r = PdfReader(str(path))
    w = PdfWriter(clone_from=r)
    for page in w.pages:
        for a in page.get('/Annots') or []:
            o = a.get_object()
            name = o.get('/T')
            if name in s.center:
                o[NameObject('/Q')] = NumberObject(1)
            if name in s.choices:
                # reportlab needs a starting value; drop the placeholder so the dropdown starts empty.
                o[NameObject('/Opt')] = ArrayObject([x for x in o['/Opt'] if str(x[0] if isinstance(x, list) else x).strip()])
                for k in ('/V', '/I', '/AP'):
                    if k in o:
                        del o[k]
            if name in s.right:
                o[NameObject('/Q')] = NumberObject(2)
            if name in s.pips:
                # Pips fill solid when ticked, like the app's bubbles.
                d, col = s.pips[name]
                k = 0.5523 * d / 2
                r_ = d / 2 - 0.9
                k = 0.5523 * r_
                cx = cy = d / 2
                paint = (f'{col.cyan:.3f} {col.magenta:.3f} {col.yellow:.3f} {col.black:.3f} k' if isinstance(col, CMYKColor)
                         else f'{col.red:.3f} {col.green:.3f} {col.blue:.3f} rg')
                disc = (f'q {paint} {cx + r_:.2f} {cy:.2f} m '
                        f'{cx + r_:.2f} {cy + k:.2f} {cx + k:.2f} {cy + r_:.2f} {cx:.2f} {cy + r_:.2f} c '
                        f'{cx - k:.2f} {cy + r_:.2f} {cx - r_:.2f} {cy + k:.2f} {cx - r_:.2f} {cy:.2f} c '
                        f'{cx - r_:.2f} {cy - k:.2f} {cx - k:.2f} {cy - r_:.2f} {cx:.2f} {cy - r_:.2f} c '
                        f'{cx + k:.2f} {cy - r_:.2f} {cx + r_:.2f} {cy - k:.2f} {cx + r_:.2f} {cy:.2f} c f Q')
                on = [x for x in o['/AP']['/N'].keys() if x != '/Off'][0]
                def stream(data):
                    st = DecodedStreamObject()
                    st.set_data(data.encode())
                    st.update({NameObject('/Type'): NameObject('/XObject'), NameObject('/Subtype'): NameObject('/Form'),
                               NameObject('/BBox'): ArrayObject([FloatObject(0), FloatObject(0), FloatObject(d), FloatObject(d)])})
                    return w._add_object(st)
                ap = DictionaryObject({NameObject(on): stream(disc), NameObject('/Off'): stream('')})
                o[NameObject('/AP')] = DictionaryObject({NameObject('/N'): ap, NameObject('/D'): ap})
                if '/MK' in o:
                    del o['/MK']
    form = w._root_object['/AcroForm']
    form[NameObject('/NeedAppearances')] = BooleanObject(True)
    # Field text is Helvetica: name it in the form's default resources so every viewer finds it.
    def std(base):
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject(base)})
        if base != '/ZapfDingbats':  # a symbol font keeps its own encoding
            font[NameObject('/Encoding')] = NameObject('/WinAnsiEncoding')
        return w._add_object(font)
    fonts = DictionaryObject({NameObject('/Helv'): std('/Helvetica'), NameObject('/HeBo'): std('/Helvetica-Bold'), NameObject('/ZaDb'): std('/ZapfDingbats')})
    form[NameObject('/DR')] = DictionaryObject({NameObject('/Font'): fonts})
    w.write(str(path))


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    sheets = {}
    for theme, fname in [('dark', 'character-sheet-dark.pdf'), ('light', 'character-sheet-light.pdf'), ('printable', 'character-sheet-printable.pdf')]:
        p = OUT / fname
        sheets[theme] = build(theme, p)
        post(p, sheets[theme])
    # Screen versions track AP, Vitality, Radiance and Rest Charges with dropdowns; the printable one with bubbles.
    out = {}
    for theme in ('dark', 'printable'):
        names = [n for n, *_ in sheets[theme].fields]
        dup = {n for n in names if names.count(n) > 1}
        assert not dup, dup
        for n, k, pg, tip in sheets[theme].fields:
            out.setdefault(n, {'name': n, 'type': k, 'page': pg, 'label': tip, 'versions': []})['versions'].append('screen' if theme == 'dark' else 'printable')
    with open(OUT / 'fields.json', 'w') as f:
        json.dump(list(out.values()), f, indent=1)
        f.write('\n')
    names = list(out)
    print(len(names), 'fields')
