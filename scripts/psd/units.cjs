// Turn a PSD's layer tree into "units" (a layer or group together with whatever is clipped
// to it), decide what each unit becomes on the web page, and work out which static pieces
// have to float above the interactive ones.
'use strict'
const C = require('./compositor.cjs')
const F = require('./fonts.cjs')
const { PAGE_W, PAGE_H, isStar } = require('./config.cjs')

const FX_KEYS = ['dropShadow', 'outerGlow', 'stroke', 'solidFill', 'bevel']
const area = (r) => (r ? r.w * r.h : 0)
const pxv = (v) => (v && typeof v === 'object' ? v.value : v) || 0

function leavesOf(node, out = []) {
  if (!node.visible) return out
  if (node.isGroup) node.children.forEach((c) => leavesOf(c, out))
  else out.push(node)
  return out
}

/** Where a node can leave marks: its pixels plus the reach of its effects. */
function footprint(node) {
  if (!node.visible) return null
  let b = null
  if (node.isGroup) { for (const c of node.children) if (!c.l.clipping) b = C.union(b, footprint(c)) } else if (node.bounds.w > 0 && node.bounds.h > 0 && node.kind !== 'ADJ') b = node.bounds
  if (!b) return null
  const m = C.fxReach(node)
  return m ? C.expand(b, m) : b
}

/** Can this group be opened up without changing how it looks? */
function containerMode(doc, node, cfg) {
  if (cfg.closed && cfg.closed.includes(node.name)) return 'closed'
  if (!C.isPassThrough(node)) return 'closed'
  if ((node.l.opacity == null ? 1 : node.l.opacity) < 1) return 'closed'
  if (C.maskPixels(doc, node)) return 'closed'
  const fx = FX_KEYS.filter((k) => C.enabledFx(node, k).length)
  if (!fx.length) return 'open'
  // a stroke on a group of separate text layers is the same as a stroke on each of them
  if (fx.length === 1 && fx[0] === 'stroke' && node.children.every((c) => !c.visible || c.kind === 'TEXT')) return 'stroke-text'
  return 'closed'
}

function textFonts(node) {
  const t = node.l.text
  const names = new Set()
  if (t.style && t.style.font) names.add(t.style.font.name)
  for (const r of t.styleRuns || []) if (r.style && r.style.font) names.add(r.style.font.name)
  return [...names]
}
/** Live text: set in fonts we can serve; a stray fallback run is tolerated if most of it is live. */
function isLiveText(node) {
  const names = textFonts(node)
  if (!names.length) return false
  const live = names.filter(F.isLive)
  if (!live.length) return false
  if (live.length === names.length) return true
  const t = node.l.text
  let liveChars = 0, total = 0
  for (const r of t.styleRuns || []) { total += r.length; if (F.isLive((r.style.font || t.style.font || {}).name)) liveChars += r.length }
  return total > 0 && liveChars / total > 0.9
}

function buildUnits(doc, cfg, frame) {
  const units = []
  const walk = (siblings, inherit) => {
    for (let i = 0; i < siblings.length;) {
      const node = siblings[i]
      const clips = []
      let j = i + 1
      while (j < siblings.length && siblings[j].l.clipping) { clips.push(siblings[j]); j++ }
      i = j
      if (!node.visible || node.l.clipping) continue
      const vclips = clips.filter((c) => c.visible)
      if (node.isGroup && !vclips.length) {
        const mode = containerMode(doc, node, cfg)
        if (mode === 'open') { walk(node.children, inherit); continue }
        if (mode === 'stroke-text') { walk(node.children, { stroke: C.enabledFx(node, 'stroke')[0] }); continue }
      }
      const leaves = leavesOf(node)
      for (const c of vclips) leavesOf(c, leaves)
      let fp = footprint(node)
      const extra = inherit && inherit.stroke ? Math.ceil(pxv(inherit.stroke.size) + 1) : 0
      if (fp && extra) fp = C.expand(fp, extra)
      const bbox = fp ? C.intersect(fp, frame) : null
      let core = null
      for (const n of leavesOf(node)) if (n.kind !== 'ADJ' && n.bounds.w > 0 && n.bounds.h > 0) core = C.union(core, n.bounds)
      const whole = core
      core = core ? C.intersect(core, frame) : bbox
      // how much of the piece is on the page (a photo on a film strip may run off the edge)
      const shown = whole && core ? (core.w * core.h) / Math.max(1, whole.w * whole.h) : 1
      units.push({
        node, clips: vclips, inherit, name: node.name, path: node.path, rawKind: node.kind,
        leafIds: new Set(leaves.map((n) => n.id)), bbox, core, shown, kind: 'static', attach: [], texts: [],
      })
    }
  }
  walk(doc.root, null)
  units.forEach((u, i) => { u.z = i })
  return units
}

function classify(doc, units, cfg) {
  const pageArea = PAGE_W * PAGE_H
  for (const u of units) {
    if (!u.bbox) { u.kind = 'none'; continue }
    const rule = (cfg.rules || []).find((r) => r.test(u))
    if (rule) { u.kind = rule.kind; u.rule = rule; continue }
    const n = u.node
    if (n.kind === 'TEXT') {
      if (isLiveText(n)) u.kind = 'text'
      else { u.kind = 'sprite'; u.alt = n.l.text.text.replace(/[\r\n\u0003]+/g, ' ').replace(/\s+/g, ' ').trim() }
      continue
    }
    const raster = u.clips.some((c) => c.kind === 'SMART' || c.kind === 'PIXEL')
    if (raster && (n.kind === 'VECTOR' || n.kind === 'PIXEL') && Math.min(n.bounds.w, n.bounds.h) >= 150 && area(n.bounds) < pageArea * 0.6) { u.kind = 'photo'; continue }
    u.kind = 'static'
  }
  // a shape with live text sitting on it is a label / chip / button
  for (const t of units) {
    if (t.kind !== 'text') continue
    const b = t.node.bounds, cx = b.x + b.w / 2, cy = b.y + b.h / 2
    for (let z = t.z - 1; z >= 0 && z >= t.z - 12; z--) {
      const s = units[z]
      if (s.kind === 'photo' || s.kind === 'title') break
      if (s.kind === 'label' || (s.kind === 'static' && s.rawKind === 'VECTOR' && !s.rule)) {
        const sb = s.node.bounds
        if (cx > sb.x && cx < sb.x + sb.w && cy > sb.y && cy < sb.y + sb.h && area(sb) < pageArea * 0.2 && area(sb) < area(b) * 14) {
          s.kind = 'label'; s.texts.push(t); t.parentUnit = s
          break
        }
      }
    }
  }
}

const EXTRACTED = new Set(['text', 'photo', 'label', 'title', 'sprite', 'deco'])
const isExtracted = (u) => EXTRACTED.has(u.kind)

/** Alpha of a unit inside r (cached per call site by the caller if needed). */
function alphaIn(doc, u, r) {
  const buf = C.render(doc, r, (n) => u.leafIds.has(n.id), null)
  const a = new Float32Array(r.w * r.h)
  for (let i = 0; i < a.length; i++) a[i] = buf.d[i * 4 + 3]
  return a
}
function overlaps(doc, s, e, cache) {
  const r = C.intersect(s.bbox, e.bbox)
  if (!r || r.w < 3 || r.h < 3) return false
  const key = s.z + '|' + e.z
  if (cache.has(key)) return cache.get(key)
  const a = alphaIn(doc, s, r), b = alphaIn(doc, e, r)
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] > 0.1 && b[i] > 0.03) n++
  const v = n >= 12
  cache.set(key, v)
  return v
}
const insideRatio = (s, e) => area(C.intersect(s.bbox, e.bbox)) / Math.max(1, area(s.bbox))

function absorb(host, s) {
  host.attach.push(s)
  s.kind = 'attached'; s.host = host
  for (const id of s.leafIds) host.leafIds.add(id)
  host.bbox = C.union(host.bbox, s.bbox)
}

/**
 * Static pieces normally sink into the page background. One that sits ON TOP of an extracted
 * piece cannot: it either becomes part of that piece (a strip of tape on a photo, the icon on
 * a contact chip) or a separate overlay of its own.
 */
function resolveLayers(doc, units) {
  const cache = new Map()
  // shapes just underneath a label that belong to it (the offset shadow of a button)
  for (const L of units) {
    if (L.kind !== 'label') continue
    for (let z = L.z - 1; z >= 0 && z >= L.z - 3; z--) {
      const s = units[z]
      if (s.kind !== 'static' || s.rule || !s.bbox || isStar(s)) continue
      if (insideRatio(s, L) < 0.7 || area(s.bbox) > area(L.bbox) * 2.5) continue
      const between = units.slice(z + 1, L.z).some((x) => isExtracted(x) && C.intersect(x.bbox, s.bbox))
      if (!between) absorb(L, s)
    }
  }
  for (const s of units) {
    if (s.kind !== 'static' || !s.bbox) continue
    if (s.node.kind === 'ADJ') continue
    const below = []
    for (let z = s.z - 1; z >= 0; z--) {
      const e = units[z]
      if (!isExtracted(e) || !e.bbox) continue
      if (overlaps(doc, s, e, cache)) below.push(e)
    }
    if (!below.length) continue
    const top = below[0]
    const host = top.kind === 'text' && top.parentUnit ? top.parentUnit : top
    const blocked = units.slice(host.z + 1, s.z).some((x) => isExtracted(x) && x !== top && x.parentUnit !== host && C.intersect(x.bbox, s.bbox) && overlaps(doc, s, x, cache))
    if (host.kind !== 'text' && host.kind !== 'title' && !blocked && insideRatio(s, host) >= 0.7 && !(s.rule && s.rule.kind === 'static')) absorb(host, s)
    else s.kind = 'deco'
  }
}

module.exports = { buildUnits, classify, resolveLayers, isExtracted, isLiveText, leavesOf, footprint, textFonts, area, pxv }
