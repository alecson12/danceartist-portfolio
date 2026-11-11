// Takes the Photoshop design apart into what the website is built from.
//
//   npm run extract            all pages
//   npm run extract -- about   one document (intro | about | highlights | works | thanks)
//
// For every page it writes, under public/art/<page>/:
//   plate-*.webp    the page background: the designer's own flattened pixels, with everything
//                   that became a separate piece removed (the layers underneath are re-rendered there)
//   photo/label/title/deco/sprite-*.webp   each separate piece, transparent, at design and half size
//   full-*.webp     the picture inside a photo frame, upright, for the viewer
// and src/content/generated/<doc>.json describing where each piece and each line of live text goes.
//
// The design folder is only read, never written.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const C = require('./compositor.cjs')
const U = require('./units.cjs')
const F = require('./fonts.cjs')
const { DESIGN_DIR, DOCS, PAGE_W, PAGE_H } = require('./config.cjs')
const { extractPage } = require('./page.cjs')

const ROOT = path.join(__dirname, '..', '..')
const ART = path.join(ROOT, 'public', 'art')
const GEN = path.join(ROOT, 'src', 'content', 'generated')
const QA_DIR = process.env.QA_DIR || ''
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))

/** The reference a page is checked against and its background is taken from. */
async function loadTruth(doc, cfg, frame) {
  if (cfg.truth) {
    const { data, info } = await sharp(path.join(DESIGN_DIR, cfg.truth)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (info.width !== PAGE_W) throw new Error(`${cfg.truth} is ${info.width}px wide, expected ${PAGE_W}`)
    return { w: info.width, h: info.height, data, ox: frame.x }
  }
  const c = C.compositeImage(doc)
  if (!c) throw new Error(`${cfg.file} has no flattened composite (save it with "Maximize Compatibility" on)`)
  return { w: c.width, h: c.height, data: c.data, ox: 0 }
}

/** A small smart object that holds live text (a contact chip): open it and treat it as a label. */
function expandNested(doc, units) {
  for (const u of units) {
    if (u.kind !== 'static' || u.rawKind !== 'SMART' || u.rule || !u.bbox) continue
    const b = u.node.bounds
    if (b.w > 1100 || b.h > 240) continue
    const pl = u.node.l.placedLayer
    const lf = pl && (doc.psd.linkedFiles || []).find((f) => f.id === pl.id)
    if (!lf || !lf.data || !/\.psb?$/i.test(lf.name || '') || lf.data.length > 8e6) continue
    const q = pl.transform
    const straight = Math.abs(q[1] - q[3]) < 0.5 && Math.abs(q[0] - q[6]) < 0.5 && Math.abs(q[2] - q[0] - pl.width) < 1.5 && Math.abs(q[7] - q[1] - pl.height) < 1.5
    if (!straight) continue
    let nested
    try { nested = C.openPsdBuffer(lf.data, lf.name) } catch { continue }
    const texts = nested.nodes.filter((n) => n.visible && n.kind === 'TEXT' && U.isLiveText(n))
    if (!texts.length) continue
    u.kind = 'label'
    u.nested = { doc: nested, ox: Math.round(q[0]), oy: Math.round(q[1]), texts }
  }
}

/** Live text written on a photo (a caption on a polaroid) travels with that photo. */
function adoptTexts(doc, units) {
  const covers = (p, x, y) => {
    const r = C.rect(Math.round(x) - 1, Math.round(y) - 1, 3, 3)
    const a = C.render(doc, r, (n) => p.leafIds.has(n.id), null, { noFx: true })
    return a.d[4 * 4 + 3] > 0.5
  }
  for (const t of units) {
    if (t.kind !== 'text' || t.parentUnit) continue
    const b = t.node.bounds, cx = b.x + b.w / 2, cy = b.y + b.h / 2
    for (let z = t.z - 1; z >= 0; z--) {
      const p = units[z]
      if (p.kind !== 'photo') continue
      const pb = p.core || p.bbox
      if (cx > pb.x && cx < pb.x + pb.w && cy > pb.y && cy < pb.y + pb.h && covers(p, cx, cy)) { t.parentUnit = p; p.texts.push(t); break }
    }
  }
}

/**
 * The paper every cream page is printed on, as a repeating tile for the phone layout:
 * the document's own fill and grain layers, mirrored 2 x 2 so its edges meet without a seam.
 */
async function writePaper(doc, cfg) {
  if (!cfg.paper) return
  const names = new Set(cfg.paper.layers)
  const S = 600
  const r = C.rect(cfg.paper.at[0], cfg.paper.at[1], S, S)
  const buf = C.toRGBA8(C.render(doc, r, (n) => names.has(n.name), [1, 1, 1, 1]))
  const tile = () => sharp(Buffer.from(buf.data.buffer), { raw: { width: S, height: S, channels: 4 } })
  const [a, b, c, d] = await Promise.all([tile().png().toBuffer(), tile().flop().png().toBuffer(), tile().flip().png().toBuffer(), tile().flip().flop().png().toBuffer()])
  const dir = path.join(ART, 'common')
  fs.mkdirSync(dir, { recursive: true })
  await sharp({ create: { width: S * 2, height: S * 2, channels: 3, background: '#fbf1e4' } })
    .composite([{ input: a, left: 0, top: 0 }, { input: b, left: S, top: 0 }, { input: c, left: 0, top: S }, { input: d, left: S, top: S }])
    .webp({ quality: 78, effort: 5 })
    .toFile(path.join(dir, 'paper.webp'))
}

async function extractDoc(cfg) {
  const doc = C.openPsd(path.join(DESIGN_DIR, cfg.file))
  await writePaper(doc, cfg)
  const frame = C.rect(cfg.offsetX || 0, 0, PAGE_W, cfg.pages.length * PAGE_H)
  const units = U.buildUnits(doc, cfg, frame)
  U.classify(doc, units, cfg)
  expandNested(doc, units)
  adoptTexts(doc, units)
  U.resolveLayers(doc, units)
  const truth = await loadTruth(doc, cfg, frame)
  const extractedLeaf = new Set()
  for (const u of units) if (U.isExtracted(u)) for (const id of u.leafIds) extractedLeaf.add(id)
  const ctx = { doc, cfg, frame, units, truth, extractedLeaf, ART, QA_DIR }
  const pages = []
  for (let p = 0; p < cfg.pages.length; p++) {
    if (process.env.PAGE && cfg.pages[p] !== process.env.PAGE) continue
    pages.push(await extractPage(ctx, p))
  }
  return pages
}

;(async () => {
  fs.mkdirSync(GEN, { recursive: true })
  const fonts = {}
  for (const fam of ['scp', 'bebas', 'hand']) { const f = F.font(fam); fonts[fam] = { baseline: Math.round(f.baseline * 1e4) / 1e4, asc: f.asc, desc: f.desc } }
  fs.writeFileSync(path.join(GEN, 'fonts.json'), JSON.stringify(fonts, null, 1) + '\n')
  for (const cfg of DOCS) {
    if (args.length && !args.includes(cfg.key)) continue
    const pages = await extractDoc(cfg)
    if (!process.env.PAGE) fs.writeFileSync(path.join(GEN, cfg.key + '.json'), JSON.stringify(pages) + '\n')
  }
})().catch((e) => { console.error(e); process.exit(1) })
