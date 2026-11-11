// A small Photoshop-compatible compositor.
//
// Reads a PSD with ag-psd (structure first, pixels decoded on demand) and can render ANY subset
// of its layers into a float RGBA buffer: blend modes, opacity, raster masks, clipping groups,
// isolated / pass-through groups, the layer effects this design uses (drop shadow, outer glow,
// outside stroke, colour overlay, inner bevel) and its adjustment layers.
//
// It exists so the build can take the design apart: a background plate without the live text,
// each photo / sticker / label as its own transparent sprite, and a full re-composite to check
// the result against the designer's own flattened export.
'use strict'
const fs = require('node:fs')
const ag = require('ag-psd')

// ag-psd only needs a canvas factory for decoding; raw pixel buffers are enough for us.
ag.initializeCanvas(
  () => { throw new Error('canvas is not available in this build script') },
  (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
)

// ---------------------------------------------------------------- rects / buffers

const rect = (x, y, w, h) => ({ x, y, w, h })
const intersect = (a, b) => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h)
  return x1 > x && y1 > y ? rect(x, y, x1 - x, y1 - y) : null
}
const expand = (r, m) => rect(r.x - m, r.y - m, r.w + 2 * m, r.h + 2 * m)
const union = (a, b) => {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return rect(x, y, Math.max(a.x + a.w, b.x + b.w) - x, Math.max(a.y + a.h, b.y + b.h) - y)
}

/** Straight-alpha float RGBA buffer positioned in document space. */
function newBuf(r, fill) {
  const d = new Float32Array(r.w * r.h * 4)
  if (fill) for (let i = 0; i < d.length; i += 4) { d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = fill[3] }
  return { x: r.x, y: r.y, w: r.w, h: r.h, d }
}
const cloneBuf = (b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, d: new Float32Array(b.d) })

function hash01(x, y, s) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// ---------------------------------------------------------------- document

const kindOf = (l) => l.children ? 'GROUP' : l.text ? 'TEXT' : l.placedLayer ? 'SMART' : l.adjustment ? 'ADJ' : (l.vectorMask || l.vectorFill || l.vectorStroke) ? 'VECTOR' : 'PIXEL'

function openPsd(file) {
  return openPsdBuffer(fs.readFileSync(file), file)
}
/** Open a PSD/PSB from memory (the document embedded in a smart object, for instance). */
function openPsdBuffer(data, file) {
  const psd = ag.readPsd(data, { useRawData: true, useRawThumbnail: true })
  let seq = 0
  const nodes = []
  const build = (layers, parent, parentVisible) => (layers || []).map((l, index) => {
    const node = {
      l, parent, index, id: seq++, name: l.name || '', kind: kindOf(l), isGroup: !!l.children,
      visible: parentVisible && !l.hidden,
      path: (parent ? parent.path + ' / ' : '') + (l.name || ''),
      bounds: rect(l.left || 0, l.top || 0, (l.right || 0) - (l.left || 0), (l.bottom || 0) - (l.top || 0)),
    }
    nodes.push(node)
    if (l.children) node.children = build(l.children, node, node.visible)
    return node
  })
  const root = build(psd.children, null, true)
  const globalAngle = psd.imageResources && typeof psd.imageResources.globalAngle === 'number' ? psd.imageResources.globalAngle : 90
  return { psd, root, nodes, width: psd.width, height: psd.height, file, globalAngle, _px: new Map(), _mask: new Map() }
}

function layerPixels(doc, node) {
  if (doc._px.has(node.id)) return doc._px.get(node.id)
  const d = node.kind === 'ADJ' || node.isGroup ? null : ag.getLayerImageData(node.l)
  const v = d && d.width && d.height ? d : null
  doc._px.set(node.id, v)
  return v
}
function maskPixels(doc, node) {
  if (doc._mask.has(node.id)) return doc._mask.get(node.id)
  const m = node.l.mask
  let v = null
  if (m && !m.disabled) {
    const w = (m.right || 0) - (m.left || 0), h = (m.bottom || 0) - (m.top || 0)
    const d = w > 0 && h > 0 ? ag.getLayerMaskImageData(node.l) : null
    v = { x: m.left || 0, y: m.top || 0, w: d ? d.width : 0, h: d ? d.height : 0, data: d ? d.data : null, def: (m.defaultColor == null ? 255 : m.defaultColor) / 255 }
    if (!d && v.def >= 1) v = null // empty mask that reveals everything
  }
  doc._mask.set(node.id, v)
  return v
}
function dropPixelCache(doc) { doc._px.clear(); doc._mask.clear() }
function compositeImage(doc) { return ag.getCompositeImageData(doc.psd) }

const maskAt = (m, x, y) => {
  const mx = x - m.x, my = y - m.y
  if (!m.data || mx < 0 || my < 0 || mx >= m.w || my >= m.h) return m.def
  return m.data[(my * m.w + mx) * 4] / 255
}

/** Coverage (0..1) of closed bezier paths inside r, even-odd, 4x supersampled vertically. */
function rasterPaths(paths, r) {
  const SS = 4
  const edges = []
  for (const p of paths) {
    const k = p.knots || []
    const n = k.length
    if (n < 2) continue
    for (let i = 0; i < n; i++) {
      if (i === n - 1 && p.open) break
      const a = k[i].points, b = k[(i + 1) % n].points
      const x0 = a[2], y0 = a[3], x1 = a[4], y1 = a[5], x2 = b[0], y2 = b[1], x3 = b[2], y3 = b[3]
      let px0 = x0, py0 = y0
      for (let st = 1; st <= 14; st++) {
        const t = st / 14, u = 1 - t
        const qx = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3
        const qy = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
        edges.push(px0, py0, qx, qy)
        px0 = qx; py0 = qy
      }
    }
  }
  const cov = new Float32Array(r.w * r.h)
  const xs = []
  for (let y = 0; y < r.h; y++) for (let sy = 0; sy < SS; sy++) {
    const yy = r.y + y + (sy + 0.5) / SS
    xs.length = 0
    for (let e = 0; e < edges.length; e += 4) {
      const y0 = edges[e + 1], y1 = edges[e + 3]
      if ((y0 <= yy && y1 > yy) || (y1 <= yy && y0 > yy)) xs.push(edges[e] + ((yy - y0) * (edges[e + 2] - edges[e])) / (y1 - y0))
    }
    xs.sort((p, q) => p - q)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      let a = xs[i] - r.x, b = xs[i + 1] - r.x
      if (b <= 0 || a >= r.w) continue
      if (a < 0) a = 0
      if (b > r.w) b = r.w
      const ia = Math.floor(a), ib = Math.floor(b)
      if (ia === ib) { cov[y * r.w + ia] += (b - a) / SS; continue }
      cov[y * r.w + ia] += (ia + 1 - a) / SS
      for (let x = ia + 1; x < ib; x++) cov[y * r.w + x] += 1 / SS
      if (ib < r.w) cov[y * r.w + ib] += (b - ib) / SS
    }
  }
  return cov
}
function vectorContent(doc, node, clip) {
  const l = node.l
  if (!l.vectorMask || !l.vectorFill || l.vectorFill.type !== 'color' || !l.vectorMask.paths) return null
  const paths = l.vectorMask.paths.filter((p) => p.knots && p.knots.length >= 2)
  if (!paths.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of paths) for (const k of p.knots) for (let i = 0; i < 6; i += 2) { x0 = Math.min(x0, k.points[i]); x1 = Math.max(x1, k.points[i]); y0 = Math.min(y0, k.points[i + 1]); y1 = Math.max(y1, k.points[i + 1]) }
  const r = intersect(rect(Math.floor(x0) - 1, Math.floor(y0) - 1, Math.ceil(x1 - x0) + 3, Math.ceil(y1 - y0) + 3), clip)
  if (!r) return null
  // each sub-path on its own, then combined the way the shape says (two copies of one outline
  // must not cancel each other out)
  let cov = null
  for (const p of paths) {
    const one = rasterPaths([p], r)
    if (!cov) { cov = one; continue }
    const op = p.operation
    for (let i = 0; i < cov.length; i++) {
      const a = Math.min(1, cov[i]), b = Math.min(1, one[i])
      cov[i] = op === 'subtract' ? a * (1 - b) : op === 'intersect' ? Math.min(a, b) : op === 'exclude' ? Math.abs(a - b) : Math.max(a, b)
    }
  }
  const c = col(l.vectorFill.color)
  const fill = l.fillOpacity == null ? 1 : l.fillOpacity
  const m = maskPixels(doc, node)
  const buf = newBuf(r)
  for (let i = 0, o = 0; i < cov.length; i++, o += 4) {
    let a = Math.min(1, cov[i]) * fill
    if (a <= 0) continue
    if (m) a *= maskAt(m, r.x + (i % r.w), r.y + ((i / r.w) | 0))
    buf.d[o] = c[0]; buf.d[o + 1] = c[1]; buf.d[o + 2] = c[2]; buf.d[o + 3] = a
  }
  return buf
}

/** Pixels of a leaf layer (with its raster mask applied) inside `clip`, or null. */
function leafContent(doc, node, clip) {
  const px = layerPixels(doc, node)
  if (!px) return vectorContent(doc, node, clip)
  const r = intersect(rect(node.bounds.x, node.bounds.y, px.width, px.height), clip)
  if (!r) return null
  const buf = newBuf(r)
  const m = maskPixels(doc, node)
  const fill = node.l.fillOpacity == null ? 1 : node.l.fillOpacity
  const src = px.data, sw = px.width, ox = node.bounds.x, oy = node.bounds.y
  for (let y = 0; y < r.h; y++) {
    let si = ((r.y + y - oy) * sw + (r.x - ox)) * 4, di = y * r.w * 4
    for (let x = 0; x < r.w; x++, si += 4, di += 4) {
      let a = src[si + 3] / 255
      if (a <= 0) continue
      if (m) a *= maskAt(m, r.x + x, r.y + y)
      buf.d[di] = src[si] / 255; buf.d[di + 1] = src[si + 1] / 255; buf.d[di + 2] = src[si + 2] / 255; buf.d[di + 3] = a * fill
    }
  }
  return buf
}

// ---------------------------------------------------------------- blending

function blendCh(mode, b, s) {
  switch (mode) {
    case 'multiply': return b * s
    case 'screen': return b + s - b * s
    case 'overlay': return b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)
    case 'hard light': return s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)
    case 'soft light': return s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b)
    case 'darken': return b < s ? b : s
    case 'lighten': return b > s ? b : s
    case 'linear burn': return b + s - 1 > 0 ? b + s - 1 : 0
    case 'linear dodge': return b + s < 1 ? b + s : 1
    case 'color dodge': return s >= 1 ? 1 : Math.min(1, b / (1 - s))
    case 'color burn': return s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)
    case 'difference': return Math.abs(b - s)
    default: return s
  }
}

/** Composite src onto dst (both straight alpha) with a Photoshop blend mode. */
function compose(dst, src, mode, opacity, seed) {
  const r = intersect(dst, src)
  if (!r || opacity <= 0) return
  const dissolve = mode === 'dissolve'
  const plain = dissolve || mode === 'normal' || mode === 'pass through' || !mode
  const sd = src.d, dd = dst.d
  for (let y = r.y; y < r.y + r.h; y++) {
    let si = ((y - src.y) * src.w + (r.x - src.x)) * 4, di = ((y - dst.y) * dst.w + (r.x - dst.x)) * 4
    for (let x = r.x; x < r.x + r.w; x++, si += 4, di += 4) {
      let as = sd[si + 3] * opacity
      if (as <= 0) continue
      if (dissolve) { if (hash01(x, y, seed) >= as) continue; as = 1 }
      const ab = dd[di + 3]
      const ao = as + ab - as * ab
      if (ab <= 0) { dd[di] = sd[si]; dd[di + 1] = sd[si + 1]; dd[di + 2] = sd[si + 2]; dd[di + 3] = as; continue }
      for (let c = 0; c < 3; c++) {
        const cs = sd[si + c], cb = dd[di + c]
        const bl = plain ? cs : blendCh(mode, cb, cs)
        dd[di + c] = (as * (1 - ab) * cs + as * ab * bl + (1 - as) * ab * cb) / ao
      }
      dd[di + 3] = ao
    }
  }
}

/** Blend a clipped layer onto its base: colour changes, the base's alpha stays. */
function composeClipped(base, src, mode, opacity) {
  const r = intersect(base, src)
  if (!r || opacity <= 0) return
  const plain = mode === 'normal' || mode === 'pass through' || mode === 'dissolve' || !mode
  const sd = src.d, bd = base.d
  for (let y = r.y; y < r.y + r.h; y++) {
    let si = ((y - src.y) * src.w + (r.x - src.x)) * 4, bi = ((y - base.y) * base.w + (r.x - base.x)) * 4
    for (let x = r.x; x < r.x + r.w; x++, si += 4, bi += 4) {
      const as = sd[si + 3] * opacity
      if (as <= 0 || bd[bi + 3] <= 0) continue
      for (let c = 0; c < 3; c++) {
        const cb = bd[bi + c], cs = sd[si + c]
        bd[bi + c] = cb + ((plain ? cs : blendCh(mode, cb, cs)) - cb) * as
      }
    }
  }
}

// ---------------------------------------------------------------- alpha planes: blur, dilate

function alphaPlane(buf, pad) {
  const w = buf.w + 2 * pad, h = buf.h + 2 * pad
  const a = new Float32Array(w * h)
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) a[(y + pad) * w + x + pad] = buf.d[(y * buf.w + x) * 4 + 3]
  return { x: buf.x - pad, y: buf.y - pad, w, h, a }
}

function boxBlurH(src, dst, w, h, r) {
  const iarr = 1 / (r + r + 1)
  for (let y = 0; y < h; y++) {
    let ti = y * w, li = ti, ri = ti + r
    const fv = src[ti], lv = src[ti + w - 1]
    let val = (r + 1) * fv
    for (let j = 0; j < r; j++) val += src[ti + Math.min(j, w - 1)]
    for (let j = 0; j <= r; j++) { val += src[Math.min(ri, y * w + w - 1)] - fv; ri++; dst[ti++] = val * iarr }
    for (let j = r + 1; j < w - r; j++) { val += src[ri++] - src[li++]; dst[ti++] = val * iarr }
    for (let j = Math.max(w - r, r + 1); j < w; j++) { val += lv - src[li++]; dst[ti++] = val * iarr }
  }
}
function boxBlurV(src, dst, w, h, r) {
  const iarr = 1 / (r + r + 1)
  for (let x = 0; x < w; x++) {
    let ti = x, li = ti, ri = ti + r * w
    const fv = src[ti], lv = src[ti + w * (h - 1)]
    let val = (r + 1) * fv
    for (let j = 0; j < r; j++) val += src[ti + Math.min(j, h - 1) * w]
    for (let j = 0; j <= r; j++) { val += src[Math.min(ri, x + w * (h - 1))] - fv; ri += w; dst[ti] = val * iarr; ti += w }
    for (let j = r + 1; j < h - r; j++) { val += src[ri] - src[li]; ri += w; li += w; dst[ti] = val * iarr; ti += w }
    for (let j = Math.max(h - r, r + 1); j < h; j++) { val += lv - src[li]; li += w; dst[ti] = val * iarr; ti += w }
  }
}
/** Gaussian blur of a single-channel plane (three box passes). */
function gaussBlur(plane, sigma) {
  if (sigma < 0.3) return plane
  const { w, h } = plane
  const n = 3
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1)
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--
  const wu = wl + 2
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4))
  let a = plane.a, b = new Float32Array(a.length)
  for (let i = 0; i < n; i++) {
    const r = Math.min(((i < m ? wl : wu) - 1) / 2, Math.floor((Math.min(w, h) - 1) / 2))
    if (r < 1) continue
    boxBlurH(a, b, w, h, r); boxBlurV(b, a, w, h, r)
  }
  return { ...plane, a }
}

const INF = 1e20
function edt1d(f, n, d, v, z) {
  let k = 0
  v[0] = 0; z[0] = -INF; z[1] = INF
  for (let q = 1; q < n; q++) {
    let s
    do { const p = v[k]; s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p) } while (s <= z[k] && --k >= 0)
    k++; v[k] = q; z[k] = s; z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[p] }
}
/** Grow the shape by `radius` px (anti-aliased), via an exact distance transform. */
function dilate(plane, radius) {
  if (radius <= 0) return plane
  const { w, h, a } = plane
  if (radius <= 4) {
    // grey-scale dilation with a soft disc: keeps thin, anti-aliased strokes intact
    const R = Math.ceil(radius + 1)
    const ker = []
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const wgt = Math.min(1, Math.max(0, radius + 1 - Math.hypot(dx, dy)))
      if (wgt > 0) ker.push(dx, dy, wgt)
    }
    const out = new Float32Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 0
      for (let k = 0; k < ker.length; k += 3) {
        const xx = x + ker[k], yy = y + ker[k + 1]
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const v = a[yy * w + xx] * ker[k + 2]
        if (v > m) m = v
      }
      out[y * w + x] = m
    }
    return { ...plane, a: out }
  }
  const g = new Float64Array(w * h)
  for (let i = 0; i < g.length; i++) g[i] = a[i] >= 0.5 ? 0 : INF
  const n = Math.max(w, h)
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x]
    edt1d(f, h, d, v, z)
    for (let y = 0; y < h; y++) g[y * w + x] = d[y]
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x]
    edt1d(f, w, d, v, z)
    for (let x = 0; x < w; x++) {
      const dist = Math.sqrt(d[x])
      const val = radius + 1 - dist
      const o = val >= 1 ? 1 : val <= 0 ? 0 : val
      out[y * w + x] = Math.max(o, a[y * w + x])
    }
  }
  return { ...plane, a: out }
}

// ---------------------------------------------------------------- layer effects

const px = (v) => (v && typeof v === 'object' ? v.value : v) || 0
const col = (c) => (c && 'r' in c ? [c.r / 255, c.g / 255, c.b / 255] : [0, 0, 0])
const enabledFx = (node, key) => {
  const e = node.l.effects
  if (!e || e.disabled) return []
  const v = e[key]
  // (effects.scale is the document's resolution ratio, 300/72; the sizes are already in pixels)
  return (Array.isArray(v) ? v : v ? [v] : []).filter((f) => f && f.enabled)
}
/** How far a node's effects can reach outside its own pixels. */
function fxReach(node) {
  let m = 0
  for (const s of enabledFx(node, 'dropShadow')) m = Math.max(m, px(s.distance) + px(s.size) * 1.6 + 2)
  for (const s of enabledFx(node, 'outerGlow')) m = Math.max(m, px(s.size) * 1.8 + 2)
  for (const s of enabledFx(node, 'stroke')) m = Math.max(m, px(s.size) + 2)
  return Math.ceil(m)
}

// Calibrated against the designer's exports (see calibrate notes in extract.cjs).
const TUNE = { shadowSigma: 0.5, glowSigma: 0.45 }

/** Paint a flat colour through an alpha plane onto dst. */
function paintPlane(dst, plane, dx, dy, color, mode, opacity, noise, seed, knock) {
  const r = intersect(dst, rect(plane.x + dx, plane.y + dy, plane.w, plane.h))
  if (!r) return
  const plain = mode === 'normal' || !mode
  const dd = dst.d
  for (let y = r.y; y < r.y + r.h; y++) {
    let pi = (y - plane.y - dy) * plane.w + (r.x - plane.x - dx), di = ((y - dst.y) * dst.w + (r.x - dst.x)) * 4
    for (let x = r.x; x < r.x + r.w; x++, pi++, di += 4) {
      let a = plane.a[pi]
      if (a <= 0.002) continue
      // Photoshop's shadow/glow "noise": uniform additive grain, clipped (measured on the export)
      if (noise > 0) {
        if (a < 0.03) continue // Photoshop's blur has finite support; a gaussian tail would speckle forever
        a += noise * Math.min(1, 0.4 + 1.5 * a) * (2 * hash01(x, y, seed) - 1)
        if (a <= 0) continue
        if (a > 1) a = 1
      }
      if (knock) {
        const kx = x - knock.x, ky = y - knock.y
        if (kx >= 0 && ky >= 0 && kx < knock.w && ky < knock.h) a *= 1 - knock.d[(ky * knock.w + kx) * 4 + 3]
      }
      const as = a * opacity
      if (as <= 0) continue
      const ab = dd[di + 3]
      const ao = as + ab - as * ab
      for (let c = 0; c < 3; c++) {
        const cs = color[c], cb = dd[di + c]
        const bl = plain || ab <= 0 ? cs : blendCh(mode, cb, cs)
        dd[di + c] = ab <= 0 ? cs : (as * (1 - ab) * cs + as * ab * bl + (1 - as) * ab * cb) / ao
      }
      dd[di + 3] = ao
    }
  }
}

function drawShadow(doc, dst, content, fx, opacity, seed) {
  const size = px(fx.size), dist = px(fx.distance)
  const spread = Math.min(1, px(fx.choke) / 100) * size
  const angle = ((fx.useGlobalLight ? doc.globalAngle : fx.angle) * Math.PI) / 180
  const dx = Math.round(-Math.cos(angle) * dist), dy = Math.round(Math.sin(angle) * dist)
  const pad = Math.ceil(size * 1.6 + 2)
  let plane = alphaPlane(content, pad)
  if (spread > 0.5) plane = dilate(plane, spread)
  plane = gaussBlur(plane, Math.max(0, size - spread) * TUNE.shadowSigma)
  paintPlane(dst, plane, dx, dy, col(fx.color), fx.blendMode, (fx.opacity == null ? 1 : fx.opacity) * opacity, fx.noise || 0, seed + 101, fx.layerConceals === false ? null : content)
}
function drawGlow(doc, dst, content, fx, opacity, seed) {
  const size = px(fx.size)
  const spread = Math.min(1, px(fx.choke) / 100) * size
  const pad = Math.ceil(size * 1.8 + 2)
  let plane = alphaPlane(content, pad)
  if (spread > 0.5) plane = dilate(plane, spread)
  plane = gaussBlur(plane, Math.max(0, size - spread) * TUNE.glowSigma)
  const range = fx.range == null ? 0.5 : Math.max(0.05, fx.range)
  for (let i = 0; i < plane.a.length; i++) { const v = plane.a[i] / range; plane.a[i] = v > 1 ? 1 : v }
  paintPlane(dst, plane, 0, 0, col(fx.color), fx.blendMode, (fx.opacity == null ? 1 : fx.opacity) * opacity, fx.noise || 0, seed + 202, content)
}
function drawStroke(doc, dst, content, fx, opacity, seed) {
  // how far the stroke reaches outside the shape: all of it, or half when it is centred on the edge
  const size = fx.position === 'center' ? px(fx.size) / 2 : fx.position === 'inside' ? 0 : px(fx.size)
  if (size <= 0) return
  const plane = dilate(alphaPlane(content, Math.ceil(size + 2)), size)
  paintPlane(dst, plane, 0, 0, col(fx.color), fx.blendMode, (fx.opacity == null ? 1 : fx.opacity) * opacity, 0, seed + 303, null)
}
function applyColorOverlay(content, fx) {
  const c = col(fx.color), o = fx.opacity == null ? 1 : fx.opacity, mode = fx.blendMode
  const plain = mode === 'normal' || !mode
  const d = content.d
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= 0) continue
    for (let k = 0; k < 3; k++) d[i + k] += ((plain ? c[k] : blendCh(mode, d[i + k], c[k])) - d[i + k]) * o
  }
}
/** Inner bevel, approximated: light along the bevel's angle on a blurred height map. */
function applyBevel(doc, content, fx) {
  const size = Math.max(1, px(fx.size))
  const angle = ((fx.useGlobalLight ? doc.globalAngle : fx.angle) * Math.PI) / 180
  const lx = Math.cos(angle), ly = -Math.sin(angle) // direction towards the light, y down
  const pad = Math.ceil(size + 2)
  const hmap = gaussBlur(alphaPlane(content, pad), size / 2.2)
  const up = fx.direction !== 'down' ? 1 : -1
  const gain = (fx.strength == null ? 1 : fx.strength) * size * 0.9
  const hc = col(fx.highlightColor || { r: 255, g: 255, b: 255 }), sc = col(fx.shadowColor || { r: 0, g: 0, b: 0 })
  const ho = fx.highlightOpacity == null ? 0.5 : fx.highlightOpacity, so = fx.shadowOpacity == null ? 0.5 : fx.shadowOpacity
  const d = content.d, w = hmap.w
  const sx = Math.round(lx * 1.5), sy = Math.round(ly * 1.5)
  for (let y = 0; y < content.h; y++) for (let x = 0; x < content.w; x++) {
    const i = (y * content.w + x) * 4
    if (d[i + 3] <= 0) continue
    const hx = x + pad, hy = y + pad
    const g = (hmap.a[(hy - sy) * w + hx - sx] - hmap.a[(hy + sy) * w + hx + sx]) * up * gain
    if (g > 0.002) { const a = Math.min(1, g) * ho; for (let k = 0; k < 3; k++) d[i + k] = d[i + k] + (blendCh(fx.highlightBlendMode || 'screen', d[i + k], hc[k]) - d[i + k]) * a }
    else if (g < -0.002) { const a = Math.min(1, -g) * so; for (let k = 0; k < 3; k++) d[i + k] = d[i + k] + (blendCh(fx.shadowBlendMode || 'multiply', d[i + k], sc[k]) - d[i + k]) * a }
  }
}

// ---------------------------------------------------------------- adjustment layers

function rgb2hsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2
  if (mx === mn) return [0, 0, l]
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
function hue2rgb(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p }
function hsl2rgb(h, s, l) {
  if (s <= 0) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, hh = (((h % 360) + 360) % 360) / 360
  return [hue2rgb(p, q, hh + 1 / 3), hue2rgb(p, q, hh), hue2rgb(p, q, hh - 1 / 3)]
}
const HUE_RANGES = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas']
function hueWeight(h, rg) {
  // trapezoid a..b ramp up, b..c full, c..d ramp down (degrees, wrapping)
  const rel = (v) => (((v - rg.a) % 360) + 360) % 360
  const x = rel(h), b = rel(rg.b), c = rel(rg.c), d = rel(rg.d)
  if (x <= b) return b > 0 ? x / b : 1
  if (x <= c) return 1
  if (x <= d) return d > c ? (d - x) / (d - c) : 1
  return 0
}
function hslShift(rgb, hue, sat, light) {
  let [r, g, b] = rgb
  if (hue || sat) {
    let [h, s, l] = rgb2hsl(r, g, b)
    h += hue
    if (sat < 0) s *= 1 + sat / 100
    else if (sat > 0) s = Math.min(1, s * (1 + (sat / 100) * 1.6))
    ;[r, g, b] = hsl2rgb(h, s, l)
  }
  if (light < 0) { const k = 1 + light / 100; r *= k; g *= k; b *= k } else if (light > 0) { const k = light / 100; r += (1 - r) * k; g += (1 - g) * k; b += (1 - b) * k }
  return [r, g, b]
}
function adjustColor(adj, r, g, b) {
  switch (adj.type) {
    case 'hue/saturation': {
      if (adj.colorize) {
        const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2
        return hslShift(hsl2rgb(adj.colorization.hue, adj.colorization.saturation / 100, l), 0, 0, adj.colorization.lightness || 0)
      }
      let out = [r, g, b]
      const m = adj.master || {}
      if (m.hue || m.saturation || m.lightness) out = hslShift(out, m.hue || 0, m.saturation || 0, m.lightness || 0)
      for (const k of HUE_RANGES) {
        const rg = adj[k]
        if (!rg || !(rg.hue || rg.saturation || rg.lightness)) continue
        const [h, s] = rgb2hsl(out[0], out[1], out[2])
        if (s <= 0.01) continue
        const w = hueWeight(h, rg)
        if (w <= 0) continue
        const t = hslShift(out, rg.hue || 0, rg.saturation || 0, rg.lightness || 0)
        out = [out[0] + (t[0] - out[0]) * w, out[1] + (t[1] - out[1]) * w, out[2] + (t[2] - out[2]) * w]
      }
      return out
    }
    case 'brightness/contrast': {
      const br = (adj.brightness || 0) / (adj.useLegacy ? 255 : 255 * 1.9), ct = (adj.contrast || 0) / 100
      const f = (v) => {
        let o = br >= 0 ? v + (1 - v) * br * (0.6 + 0.8 * v) : v * (1 + br * (1.4 - 0.8 * v))
        const k = ct >= 0 ? 1 + ct * 0.9 : 1 + ct * 0.55
        o = (o - 0.5) * k + 0.5
        return o < 0 ? 0 : o > 1 ? 1 : o
      }
      return [f(r), f(g), f(b)]
    }
    case 'black & white': {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), md = r + g + b - mx - mn
      const prim = mx === r ? adj.reds : mx === g ? adj.greens : adj.blues
      const sec = mn === b ? adj.yellows : mn === r ? adj.cyans : adj.magentas
      const v = mn + (md - mn) * ((sec == null ? 60 : sec) / 100) + (mx - md) * ((prim == null ? 40 : prim) / 100)
      const o = v < 0 ? 0 : v > 1 ? 1 : v
      return [o, o, o]
    }
    default: return [r, g, b]
  }
}
function applyAdjustment(doc, buf, node, keepAlphaOnly) {
  const adj = node.l.adjustment
  if (!adj) return
  const m = maskPixels(doc, node)
  const o = node.l.opacity == null ? 1 : node.l.opacity
  const d = buf.d
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
    const i = (y * buf.w + x) * 4
    if (d[i + 3] <= 0) continue
    const w = o * (m ? maskAt(m, buf.x + x, buf.y + y) : 1)
    if (w <= 0) continue
    const t = adjustColor(adj, d[i], d[i + 1], d[i + 2])
    d[i] += (t[0] - d[i]) * w; d[i + 1] += (t[1] - d[i + 1]) * w; d[i + 2] += (t[2] - d[i + 2]) * w
  }
}

// ---------------------------------------------------------------- tree rendering

const hasFx = (node) => ['dropShadow', 'outerGlow', 'stroke', 'solidFill', 'bevel'].some((k) => enabledFx(node, k).length)
const isPassThrough = (node) => node.isGroup && (!node.l.blendMode || node.l.blendMode === 'pass through')
/** A group that Photoshop merges before blending (so it has to be rendered on its own first). */
const isIsolated = (node) => node.isGroup && (!isPassThrough(node) || hasFx(node))

function anyIncluded(node, ctx) {
  if (!node.visible) return false
  if (!node.isGroup) return ctx.include(node)
  if (ctx._any.has(node.id)) return ctx._any.get(node.id)
  const v = node.children.some((c) => anyIncluded(c, ctx))
  ctx._any.set(node.id, v)
  return v
}

/** Render sibling layers (bottom to top) onto dst. ctx.include(node) picks the leaves that take part. */
function renderList(doc, dst, siblings, ctx) {
  for (let i = 0; i < siblings.length;) {
    const node = siblings[i]
    const clips = []
    let j = i + 1
    while (j < siblings.length && siblings[j].l.clipping) { clips.push(siblings[j]); j++ }
    i = j
    if (!node.visible || node.l.clipping) continue
    if (!anyIncluded(node, ctx)) continue
    drawNode(doc, dst, node, clips.filter((c) => c.visible), ctx)
  }
}

function drawNode(doc, dst, node, clips, ctx) {
  const l = node.l
  const opacity = l.opacity == null ? 1 : l.opacity
  if (node.kind === 'ADJ') { applyAdjustment(doc, dst, node); return }

  let content
  if (node.isGroup && !isIsolated(node) && !clips.length) {
    const m = maskPixels(doc, node)
    if (opacity >= 1 && !m) { renderList(doc, dst, node.children, ctx); return }
    const before = cloneBuf(dst)
    renderList(doc, dst, node.children, ctx)
    const a = dst.d, b = before.d
    for (let y = 0; y < dst.h; y++) for (let x = 0; x < dst.w; x++) {
      const i = (y * dst.w + x) * 4
      const w = opacity * (m ? maskAt(m, dst.x + x, dst.y + y) : 1)
      if (w >= 1) continue
      for (let c = 0; c < 4; c++) a[i + c] = b[i + c] + (a[i + c] - b[i + c]) * w
    }
    return
  }

  const reach = fxReach(node)
  const work = expand(dst, reach)
  if (node.isGroup) {
    content = newBuf(work)
    renderList(doc, content, node.children, ctx)
    const m = maskPixels(doc, node)
    if (m) for (let y = 0; y < content.h; y++) for (let x = 0; x < content.w; x++) content.d[(y * content.w + x) * 4 + 3] *= maskAt(m, content.x + x, content.y + y)
  } else {
    content = leafContent(doc, node, work)
  }
  if (!content) return

  // A shape layer's own stroke is drawn above whatever is clipped to the shape (a photo in a
  // white-bordered frame). Its stored pixels mix fill and stroke colour, so split them by colour.
  let strokeCov = null, strokeCol = null
  const vs = l.vectorStroke
  if (clips.length && vs && vs.strokeEnabled && vs.content && vs.content.color && l.vectorFill && l.vectorFill.color) {
    const F = col(l.vectorFill.color), S = col(vs.content.color)
    const dx = S[0] - F[0], dy = S[1] - F[1], dz = S[2] - F[2], len = dx * dx + dy * dy + dz * dz
    if (len > 0.01) {
      strokeCol = S
      strokeCov = new Float32Array(content.w * content.h)
      const d = content.d
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        if (d[i + 3] <= 0) continue
        const t = vs.fillEnabled === false ? 1 : ((d[i] - F[0]) * dx + (d[i + 1] - F[1]) * dy + (d[i + 2] - F[2]) * dz) / len
        strokeCov[p] = t <= 0 ? 0 : t >= 1 ? 1 : t
      }
    }
  }

  for (const c of clips) {
    if (c.kind === 'ADJ') { applyAdjustment(doc, content, c); continue }
    let cc
    if (c.isGroup) { cc = newBuf(rect(content.x, content.y, content.w, content.h)); renderList(doc, cc, c.children, { ...ctx, include: () => true, _any: new Map() }) } else cc = leafContent(doc, c, content)
    if (cc) composeClipped(content, cc, c.l.blendMode, c.l.opacity == null ? 1 : c.l.opacity)
  }

  if (strokeCov) {
    const d = content.d
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const t = strokeCov[p]
      if (t <= 0) continue
      d[i] += (strokeCol[0] - d[i]) * t; d[i + 1] += (strokeCol[1] - d[i + 1]) * t; d[i + 2] += (strokeCol[2] - d[i + 2]) * t
    }
  }

  if (!ctx.noFx) {
    for (const fx of enabledFx(node, 'dropShadow')) drawShadow(doc, dst, content, fx, opacity, node.id)
    for (const fx of enabledFx(node, 'outerGlow')) drawGlow(doc, dst, content, fx, opacity, node.id)
    for (const fx of enabledFx(node, 'stroke').slice().reverse()) drawStroke(doc, dst, content, fx, opacity, node.id)
    for (const fx of enabledFx(node, 'solidFill')) applyColorOverlay(content, fx)
    for (const fx of enabledFx(node, 'bevel')) applyBevel(doc, content, fx)
  }
  compose(dst, content, node.isGroup && isPassThrough(node) ? 'normal' : l.blendMode, opacity, node.id)
}

/** Render the layers chosen by `include` over a backdrop into region `r`. Returns a float buffer. */
function render(doc, r, include, backdrop, opts) {
  const dst = newBuf(r, backdrop || null)
  renderList(doc, dst, doc.root, { include, _any: new Map(), ...(opts || {}) })
  return dst
}

/**
 * Render a set of layers as a transparent sprite. The layers are composited over black and
 * over white; the difference gives the alpha, so multiply shadows, screen highlights and
 * clipped adjustments all end up baked into one ordinary RGBA image.
 */
function renderSprite(doc, r, include, opts) {
  const k = render(doc, r, include, [0, 0, 0, 1], opts).d
  const w = render(doc, r, include, [1, 1, 1, 1], opts).d
  const out = new Uint8ClampedArray(r.w * r.h * 4)
  for (let i = 0; i < out.length; i += 4) {
    const a = 1 - ((w[i] - k[i]) + (w[i + 1] - k[i + 1]) + (w[i + 2] - k[i + 2])) / 3
    if (a <= 0.004) continue
    const inv = 1 / a
    out[i] = k[i] * inv * 255 + 0.5; out[i + 1] = k[i + 1] * inv * 255 + 0.5; out[i + 2] = k[i + 2] * inv * 255 + 0.5; out[i + 3] = a * 255 + 0.5
  }
  return { x: r.x, y: r.y, w: r.w, h: r.h, data: out }
}

function toRGBA8(buf) {
  const out = new Uint8ClampedArray(buf.w * buf.h * 4)
  const d = buf.d
  for (let i = 0; i < out.length; i++) out[i] = d[i] * 255 + 0.5
  return { x: buf.x, y: buf.y, w: buf.w, h: buf.h, data: out }
}

module.exports = {
  ag, rect, intersect, expand, union, newBuf, openPsd, openPsdBuffer, adjustColor, maskAt, layerPixels, maskPixels, dropPixelCache, compositeImage,
  render, renderSprite, toRGBA8, enabledFx, fxReach, hasFx, isIsolated, isPassThrough, hash01, TUNE,
}
