# Builds lopsided.ttf, a test font for the e2e "button labels are centred" check.
#
# Devices fall back to their own fonts (the app bundles none for text), and some,
# like Windows' Segoe UI, sit their capitals lower in the line than others. This
# font exaggerates that: Latin letters from DejaVu Sans (Bitstream Vera licence,
# which asks that changed fonts are renamed) with a very tall ascent and a short
# descent, so its capitals sit about 2.4 px low at 16 px if nothing corrects them.
#
#   pip install fonttools
#   python3 tests/e2e/fonts/make-lopsided.py /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.subset import Options, Subsetter

src = sys.argv[1]
font = TTFont(src)
opts = Options()
opts.layout_features = []
opts.name_IDs = []
sub = Subsetter(opts)
sub.populate(unicodes=range(0x20, 0x7F))
sub.subset(font)

ASCENT, DESCENT = 2400, 300  # of 2048 units; DejaVu's own are 1901 and 483
font['hhea'].ascent = ASCENT
font['hhea'].descent = -DESCENT
font['hhea'].lineGap = 0
os2 = font['OS/2']
os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = ASCENT, -DESCENT, 0
os2.usWinAscent, os2.usWinDescent = ASCENT, DESCENT
name = font['name']
name.names = []
for nid, text in [(1, 'Lopsided Test'), (2, 'Regular'), (4, 'Lopsided Test'), (6, 'LopsidedTest-Regular')]:
    name.setName(text, nid, 3, 1, 0x409)
out = Path(__file__).with_name('lopsided.ttf')
font.save(out)
print(out, out.stat().st_size, 'bytes')
