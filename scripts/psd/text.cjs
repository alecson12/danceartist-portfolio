// Photoshop text layer -> the data the site needs to set the same text with real fonts.
'use strict'
const C = require('./compositor.cjs')
const F = require('./fonts.cjs')

const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
const BREAK = new Set(['\r', '\n', '\u0003'])
const r2 = (v) => Math.round(v * 100) / 100
const r4 = (v) => Math.round(v * 10000) / 10000
const pt = (v) => (v && typeof v === 'object' ? v.value : v) || 0
const sameRun = (a, b) => a.f === b.f && a.w === b.w && a.i === b.i && a.s === b.s && a.c === b.c && a.ls === b.ls && a.up === b.up

/** Width of one character of a run, in the text's own (unscaled) pixels. */
const charWidth = (r, ch) => (F.advance(r.f === 'sans' ? 'scp' : r.f, r.up ? ch.toUpperCase() : ch) + r.ls) * r.s

/**
 * Break a paragraph the way Photoshop's single-line composer does: fill each line with as many
 * words as fit, allowing the word spaces to shrink to the paragraph's minimum (80 % by default)
 * when the text is justified. A browser never shrinks spaces, so the breaks are fixed here and
 * each line carries the exact word spacing that makes it span the box.
 */
function wrapBox(paras, boxW, justified, minSpace) {
  const out = []
  for (const para of paras) {
    const chars = []
    for (const r of para.runs) for (const ch of r.t) chars.push({ ch, r })
    const tokens = []
    for (const c of chars) {
      const sp = c.ch === ' '
      const last = tokens[tokens.length - 1]
      if (last && last.space === sp) last.chars.push(c)
      else tokens.push({ space: sp, chars: [c] })
    }
    const strip = (arr) => { let n = arr.length; while (n && arr[n - 1].ch === ' ') n--; return arr.slice(0, n) }
    const width = (arr, k) => arr.reduce((w, c) => w + charWidth(c.r, c.ch) * (c.ch === ' ' ? k : 1), 0)
    let line = []
    const lines = []
    for (const tk of tokens) {
      if (tk.space) { if (line.length) line.push(...tk.chars); continue }
      const trial = [...line, ...tk.chars]
      if (line.length && width(trial, justified ? minSpace : 1) > boxW + 0.5) { lines.push(strip(line)); line = [...tk.chars] } else line = trial
    }
    lines.push(strip(line))
    lines.forEach((arr, i) => {
      const runs = []
      for (const c of arr) { const last = runs[runs.length - 1]; if (last && sameRun(last, c.r)) last.t += c.ch; else runs.push({ ...c.r, t: c.ch }) }
      const spaces = arr.filter((c) => c.ch === ' ').length
      const isLast = i === lines.length - 1
      const ws = justified && !isLast && spaces ? (boxW - width(arr, 1)) / spaces : 0
      out.push({ runs, lead: para.lead, size: Math.max(...runs.map((r) => r.s), 0) || para.size, ws })
    })
  }
  return out
}

/** Area and first moments of a glyph outline (flattened), for centre-of-mass calculations. */
function outlineMoments(path) {
  let A = 0, Mx = 0, My = 0
  let sx = 0, sy = 0, px = 0, py = 0
  const seg = (x1, y1) => { const c = px * y1 - x1 * py; A += c / 2; Mx += ((px + x1) * c) / 6; My += ((py + y1) * c) / 6; px = x1; py = y1 }
  for (const c of path.commands) {
    if (c.type === 'M') { sx = px = c.x; sy = py = c.y } else if (c.type === 'L') seg(c.x, c.y)
    else if (c.type === 'Q') { const x0 = px, y0 = py; for (let i = 1; i <= 8; i++) { const t = i / 8, u = 1 - t; seg(u * u * x0 + 2 * u * t * c.x1 + t * t * c.x, u * u * y0 + 2 * u * t * c.y1 + t * t * c.y) } }
    else if (c.type === 'C') { const x0 = px, y0 = py; for (let i = 1; i <= 10; i++) { const t = i / 10, u = 1 - t; seg(u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x, u * u * u * y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y) } }
    else if (c.type === 'Z') seg(sx, sy)
  }
  return A < 0 ? [-A, -Mx, -My] : [A, Mx, My]
}

/** Centre of mass of the ink our fonts would lay down for these lines, in the text's own space. */
function inkCentre(lines, align, sx) {
  let A = 0, Mx = 0, My = 0
  for (const ln of lines) {
    const parts = []
    let pen = 0
    for (const r of ln.runs) {
      const info = F.font(r.f === 'sans' ? 'scp' : r.f, r.w, r.i)
      const str = r.up ? r.t.toUpperCase() : r.t
      const gs = info.font.stringToGlyphs(str)
      for (let i = 0; i < gs.length; i++) {
        const g = gs[i]
        if (r.f !== 'sans' && g.path && g.path.commands.length) parts.push([pen, outlineMoments(g.getPath(0, 0, r.s))])
        const kern = i + 1 < gs.length ? info.font.getKerningValue(g, gs[i + 1]) || 0 : 0
        pen += ((g.advanceWidth + kern) / info.upm + r.ls) * r.s
        if (str[i] === ' ' && ln.ws) pen += ln.ws
      }
    }
    const shift = align === 'center' ? -pen / 2 : align === 'right' ? -pen : 0
    for (const [x, [a, mx, my]] of parts) { A += a; Mx += mx + a * (x + shift); My += my + a * ln.y }
  }
  return A > 0 ? [(Mx / A) * sx, My / A] : null
}

/**
 * A text layer's own pixels, measured: centre of mass (document space) and how far the ink
 * extends along the direction the text runs in (ux, uy), which holds for tilted text too.
 */
function measureLayer(node, ux, uy) {
  const img = C.ag.getLayerImageData(node.l)
  if (!img || !img.width) return null
  let A = 0, Mx = 0, My = 0, lo = Infinity, hi = -Infinity
  const { width, height, data } = img
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = data[(y * width + x) * 4 + 3]
    if (!a) continue
    A += a; Mx += a * (x + 0.5); My += a * (y + 0.5)
    if (a > 96) { const p = (x + 0.5) * ux + (y + 0.5) * uy; if (p < lo) lo = p; if (p > hi) hi = p }
  }
  return A > 0 ? { centre: [node.bounds.x + Mx / A, node.bounds.y + My / A], extent: hi > lo ? hi - lo + 1 : 0 } : null
}

/** Extent of the ink our own fonts would produce for these lines, in the text's own space. */
function inkBox(lines, align) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const ln of lines) {
    const glyphs = []
    let pen = 0
    for (const r of ln.runs) {
      if (r.f === 'sans') return null
      const info = F.font(r.f, r.w, r.i)
      const str = r.up ? r.t.toUpperCase() : r.t
      const gs = info.font.stringToGlyphs(str)
      for (let i = 0; i < gs.length; i++) {
        const g = gs[i], mt = g.getMetrics()
        if (g.path && g.path.commands.length) glyphs.push([pen + (mt.xMin / info.upm) * r.s, pen + (mt.xMax / info.upm) * r.s, ln.y - (mt.yMax / info.upm) * r.s, ln.y - (mt.yMin / info.upm) * r.s])
        const kern = i + 1 < gs.length ? info.font.getKerningValue(g, gs[i + 1]) || 0 : 0
        pen += ((g.advanceWidth + kern) / info.upm + r.ls) * r.s
        if (str[i] === ' ' && ln.ws) pen += ln.ws
      }
    }
    const shift = align === 'center' ? -pen / 2 : align === 'right' ? -pen : 0
    for (const g of glyphs) { x0 = Math.min(x0, g[0] + shift); x1 = Math.max(x1, g[1] + shift); y0 = Math.min(y0, g[2]); y1 = Math.max(y1, g[3]) }
  }
  return x1 > x0 ? { x0, x1, y0, y1 } : null
}

/**
 * @param node   a TEXT node
 * @param org    {x, y}: document position that becomes (0, 0) on the page
 * @param extra  optional {stroke} inherited from a parent group
 * @returns {object} see src/components/LiveText.jsx for how each field is used
 */
function textItem(node, org, extra, warn) {
  const l = node.l, t = l.text
  const base = t.style || {}
  const str = t.text
  const styles = new Array(str.length)
  let pos = 0
  for (const r of t.styleRuns && t.styleRuns.length ? t.styleRuns : [{ length: str.length, style: {} }]) {
    const st = { ...base, ...r.style }
    for (let k = 0; k < r.length && pos < str.length; k++) styles[pos++] = st
  }
  while (pos < str.length) styles[pos++] = base
  const overlay = C.enabledFx(node, 'solidFill')[0]
  const strokeFx = C.enabledFx(node, 'stroke')[0] || (extra && extra.stroke) || null
  const autoLead = (t.paragraphStyle && t.paragraphStyle.autoLeading) || 1.2

  let lines = []
  let cur = { runs: [], lead: 0, size: 0 }
  const leadOf = (st) => (st.autoLeading === false && st.leading ? st.leading : (st.fontSize || 12) * autoLead)
  for (let i = 0; i < str.length; i++) {
    const ch = str[i], st = styles[i]
    cur.lead = Math.max(cur.lead, leadOf(st))
    if (BREAK.has(ch)) { lines.push(cur); cur = { runs: [], lead: 0, size: 0 }; continue }
    const psFont = st.font && st.font.name
    let f = F.mapFont(psFont)
    if (!f) { f = { fam: 'sans', w: 400 }; if (warn && ch.trim()) warn(`"${ch}" set in ${psFont}: falls back to a system font`) }
    const run = {
      t: ch, f: f.fam, w: f.w, i: f.i || (st.fauxItalic ? 1 : 0), s: r2(st.fontSize || 12),
      c: hex(overlay ? overlay.color : st.fillColor || { r: 0, g: 0, b: 0 }), ls: r4((st.tracking || 0) / 1000), up: st.fontCaps === 2 ? 1 : 0,
    }
    cur.size = Math.max(cur.size, run.s)
    const last = cur.runs[cur.runs.length - 1]
    if (last && sameRun(last, run)) last.t += ch
    else cur.runs.push(run)
  }
  lines.push(cur)
  while (lines.length && !lines[lines.length - 1].runs.length) lines.pop()

  const m = t.transform || [1, 0, 0, 1, 0, 0]
  const just = (t.paragraphStyle && t.paragraphStyle.justification) || 'left'
  const box = t.shapeType === 'box'
  const align = just === 'center' ? 'center' : just === 'right' ? 'right' : 'left'
  let y = 0
  let boxInfo = null

  if (box) {
    const bb = t.boxBounds || [0, 0, node.bounds.w, node.bounds.h]
    const boxW = bb[2] - bb[0]
    const ws = t.paragraphStyle && t.paragraphStyle.wordSpacing
    lines = wrapBox(lines, boxW, just.startsWith('justify'), (ws && ws[0]) || 0.8)
    // Photoshop puts the first baseline one "d"-height of the font below the top of the box
    const first = lines[0]
    const fam = (first && first.runs[0] && first.runs[0].f) || 'scp'
    y = (fam === 'sans' ? 0.72 : F.font(fam).dHeight) * (first ? first.size : 12)
    boxInfo = { w: r2(boxW), h: r2(bb[3] - bb[1]) }
  }
  lines.forEach((ln, i) => { if (i) y += ln.lead; ln.y = r2(y) })

  // The web font may be a little wider or narrower than the one Photoshop used (old "Bebas" vs
  // Bebas Neue). Measure the ink our font would lay down and match it to the ink in the layer.
  let sx = 1
  const along = Math.hypot(m[0], m[1]) || 1
  const measured = node.bounds.w > 2 && node.bounds.h > 2 ? measureLayer(node, m[0] / along, m[1] / along) : null
  if (!box && measured && measured.extent > 90) {
    const ink = inkBox(lines, align)
    if (ink) {
      const k = measured.extent / (along * (ink.x1 - ink.x0))
      if (Number.isFinite(k) && Math.abs(k - 1) > 0.025 && k > 0.6 && k < 1.6) sx = r4(k)
    }
  }

  // Where the text sits. Photoshop's stored origin depends on the kind of text, its alignment
  // and its first-baseline rule, and is sometimes stale. The pixels of the layer are not: lay the
  // lines out with our fonts, and put the centre of mass of their ink on that of the layer's ink
  // (a centre of mass turns and scales with the text, so this holds for tilted text too).
  let tx = m[4], ty = m[5]
  const mine = inkCentre(lines, align, sx), theirs = measured && measured.centre
  if (mine && theirs) {
    tx = theirs[0] - (m[0] * mine[0] + m[2] * mine[1])
    ty = theirs[1] - (m[1] * mine[0] + m[3] * mine[1])
  }

  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1
  const item = {
    t: 'text',
    m: [r4(m[0]), r4(m[1]), r4(m[2]), r4(m[3]), r2(tx - org.x), r2(ty - org.y)],
    align,
    lines: lines.map((ln) => {
      const o = { y: ln.y, s: ln.size, runs: ln.runs.map((r) => { const q = { t: r.t, f: r.f, w: r.w, s: r.s, c: r.c }; if (r.i) q.i = 1; if (r.ls) q.ls = r.ls; if (r.up) q.up = 1; return q }) }
      if (ln.ws) o.ws = r2(ln.ws)
      return o
    }),
    plain: lines.map((ln) => ln.runs.map((r) => (r.up ? r.t.toUpperCase() : r.t)).join('')).join(box ? ' ' : '\n'),
    b: [node.bounds.x - org.x, node.bounds.y - org.y, node.bounds.w, node.bounds.h],
  }
  if (sx !== 1) item.sx = sx
  if (boxInfo) item.box = boxInfo
  if (strokeFx && strokeFx.position !== 'inside') {
    // w = how far the outline reaches beyond the letter shapes, in the text's own units.
    // (Photoshop's anti-aliasing carries a stroke about 0.4 px further than its nominal size.)
    const reach = (strokeFx.position === 'center' ? pt(strokeFx.size) / 2 : pt(strokeFx.size)) + 0.4
    item.stroke = { w: r2(reach / scale), c: hex(strokeFx.color || { r: 0, g: 0, b: 0 }) }
  }
  if (l.opacity != null && l.opacity < 1) item.op = r2(l.opacity)
  return item
}

module.exports = { textItem, hex }
