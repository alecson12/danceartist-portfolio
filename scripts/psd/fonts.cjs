// Font knowledge for the build: which Photoshop fonts become live web text, and their metrics.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const opentype = require('opentype.js')

const ROOT = path.join(__dirname, '..', '..')
const FILES = {
  scp: path.join(ROOT, 'node_modules/@fontsource/source-code-pro/files/source-code-pro-latin-500-normal.woff'),
  bebas: path.join(ROOT, 'node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff'),
  hand: path.join(ROOT, 'src/assets/fonts/Handwritten.ttf'),
}

// Photoshop font name -> web family (see src/index.css for the @font-face side)
const MAP = [
  [/^SourceCodePro-Regular$/, { fam: 'scp', w: 400 }],
  [/^SourceCodePro-Medium$/, { fam: 'scp', w: 500 }],
  [/^SourceCodePro-Semibold$/, { fam: 'scp', w: 600 }],
  [/^SourceCodePro-Bold$/, { fam: 'scp', w: 700 }],
  [/^SourceCodePro-Black$/, { fam: 'scp', w: 900 }],
  [/^SourceCodePro-It$/, { fam: 'scp', w: 400, i: 1 }],
  [/^SourceCodePro-MediumIt$/, { fam: 'scp', w: 500, i: 1 }],
  [/^SourceCodePro-SemiboldIt$/, { fam: 'scp', w: 600, i: 1 }],
  [/^SourceCodePro-BoldIt$/, { fam: 'scp', w: 700, i: 1 }],
  [/^Bebas(Neue)?-Regular$/, { fam: 'bebas', w: 400 }],
  [/^Handwritten$/, { fam: 'hand', w: 400 }],
]
/** A stray run in another font inside live text (one curly apostrophe) falls back to this. */
const FALLBACK = { fam: 'hand', w: 400, fallback: true }

const mapFont = (psName) => { for (const [re, f] of MAP) if (re.test(psName || '')) return f; return null }
const isLive = (psName) => !!mapFont(psName)

/** The font file for a family at a given weight (the outlines differ per weight, the widths do not). */
function fileFor(fam, w, i) {
  if (fam !== 'scp') return FILES[fam]
  const weight = [400, 500, 600, 700, 900].reduce((best, x) => (Math.abs(x - (w || 500)) < Math.abs(best - (w || 500)) ? x : best), 500)
  return path.join(ROOT, `node_modules/@fontsource/source-code-pro/files/source-code-pro-latin-${weight}-${i ? 'italic' : 'normal'}.woff`)
}

const cache = {}
function font(fam, w, i) {
  const file = fileFor(fam, w, i)
  if (cache[file]) return cache[file]
  const b = fs.readFileSync(file)
  const f = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
  const upm = f.unitsPerEm
  const hhea = f.tables.hhea, os2 = f.tables.os2
  // what browsers use for the line box: typo metrics when USE_TYPO_METRICS is set, else hhea
  const useTypo = os2 && (os2.fsSelection & 0x80)
  const asc = (useTypo ? os2.sTypoAscender : hhea.ascender) / upm
  const desc = Math.abs(useTypo ? os2.sTypoDescender : hhea.descender) / upm
  const d = f.charToGlyph('d')
  const info = {
    fam, upm, asc, desc,
    // with line-height:0 the baseline sits this far (in em) below the line's own position
    baseline: (asc - desc) / 2,
    // Photoshop puts the first baseline of box text one "d"-height below the top of the box
    dHeight: d && d.getMetrics().yMax / upm,
    font: f,
  }
  cache[file] = info
  return info
}

/** Advance width of a string in em (kerning included, tracking not). */
function advance(fam, text) {
  const f = font(fam).font
  let w = 0
  const glyphs = f.stringToGlyphs(text)
  for (let i = 0; i < glyphs.length; i++) {
    w += glyphs[i].advanceWidth || 0
    if (i + 1 < glyphs.length) w += f.getKerningValue(glyphs[i], glyphs[i + 1]) || 0
  }
  return w / f.unitsPerEm
}
const hasGlyph = (fam, ch) => { const g = font(fam).font.charToGlyph(ch); return !!g && g.index !== 0 }

module.exports = { mapFont, isLive, font, advance, hasGlyph, FALLBACK, FILES }
