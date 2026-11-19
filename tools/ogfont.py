"""Fonts for the OGP images: Noto Sans CJK JP at two fixed weights (300, 500), cut down to
what Japanese titles use (JIS X 0208: kana and the two kanji levels; ASCII, Latin-1,
general punctuation, full-width forms), so the server can hold them in memory, and with
TrueType outlines (resvg does not draw the CFF2 an instanced variable CJK font keeps).
    python3 tools/ogfont.py NotoSansCJK-VF.otf.ttc OUT_DIR   ->  og-300.ttf, og-500.ttf
"""
import sys
from fontTools.ttLib import TTCollection
from fontTools.varLib import instancer
from fontTools import subset
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import newTable


def to_ttf(f, weight: int) -> None:
    gs = f.getGlyphSet()
    glyf = newTable('glyf')
    glyf.glyphOrder = f.getGlyphOrder()
    glyf.glyphs = {}
    for name in glyf.glyphOrder:
        pen = TTGlyphPen(gs)
        gs[name].draw(Cu2QuPen(pen, 1.0, reverse_direction=True))
        glyf.glyphs[name] = pen.glyph()
    f['loca'] = newTable('loca')
    f['glyf'] = glyf
    for t in ('CFF2', 'CFF ', 'VORG', 'STAT'):
        if t in f:
            del f[t]
    f.sfntVersion = '\x00\x01\x00\x00'
    f['head'].glyphDataFormat = 0
    f['post'].formatType = 3.0
    m = f['maxp']
    m.tableVersion = 0x00010000
    m.maxZones, m.maxTwilightPoints, m.maxStorage = 1, 0, 0
    m.maxFunctionDefs = m.maxInstructionDefs = m.maxStackElements = m.maxSizeOfInstructions = 0
    m.maxComponentElements = 0
    f['OS/2'].usWeightClass = weight
    style = {300: 'Light', 500: 'Medium'}[weight]
    for rec in f['name'].names:
        if rec.nameID in (2, 17):
            rec.string = style
        if rec.nameID == 6:
            rec.string = f'NotoSansCJKjp-{style}'


src, out = sys.argv[1], sys.argv[2]
coll = TTCollection(src)
jp = next(f for f in coll.fonts if 'JP' in f['name'].getDebugName(1))

chars = set(range(0x20, 0x7F)) | set(range(0xA0, 0x100)) | set(range(0x2000, 0x2070)) | set(range(0x3000, 0x3100)) | set(range(0xFF00, 0xFFF0))
chars |= {0x2190, 0x2192, 0x2191, 0x2193, 0x2026, 0x2160, 0x2161, 0x2162, 0x2460, 0x2461, 0x2462}
for hi in range(0xA1, 0xFF):  # every JIS X 0208 character, through EUC-JP
    for lo in range(0xA1, 0xFF):
        try:
            chars.add(ord(bytes([hi, lo]).decode('euc_jp')))
        except UnicodeDecodeError:
            pass

for weight in (300, 500):
    f = instancer.instantiateVariableFont(TTCollection(src).fonts[coll.fonts.index(jp)], {'wght': weight})
    opts = subset.Options()
    opts.layout_features = ['kern', 'palt', 'liga', 'vert']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    s = subset.Subsetter(opts)
    s.populate(unicodes=chars)
    s.subset(f)
    to_ttf(f, weight)
    f.save(f'{out}/og-{weight}.ttf')
    print(weight, len(chars), 'characters')
