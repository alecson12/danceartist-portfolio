// The phone layout. The same pieces as the full-screen pages (same artwork, same live text),
// re-stacked into one readable column instead of being shrunk as a whole page.
//
// Nothing is redrawn here: a photo group is a patch of the design scaled to the column width,
// a label or a chip is the design's own label scaled so its text is comfortable to read.
import { memo } from 'react'
import { ASSET, DESIGN } from '../content/pages.js'
import { useStage } from '../lib/stage.js'
import LiveText from './LiveText.jsx'
import Stage, { Piece, arrival, enterClass, linkProps, useReveal } from './Stage.jsx'

const PAD = 16
const MAX_W = 720

// ---------------------------------------------------------------- geometry

const rectOf = (it) => (it.t === 'text' ? it.b : [it.x, it.y, it.w, it.h])
const coreOf = (it) => (it.t === 'text' ? it.b : it.core || [it.x, it.y, it.w, it.h])
const unite = (rects) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const r of rects) { x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[0] + r[2]); y1 = Math.max(y1, r[1] + r[3]) }
  return [x0, y0, x1 - x0, y1 - y0]
}
const near = (a, b, g) => a[0] - g < b[0] + b[2] && b[0] - g < a[0] + a[2] && a[1] - g < b[1] + b[3] && b[1] - g < a[1] + a[3]
/** How much two rectangles overlap, as a share of the smaller one (photos piled on each other). */
const overlap = (a, b) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])
  return w > 0 && h > 0 ? (w * h) / Math.max(1, Math.min(a[2] * a[3], b[2] * b[3])) : 0
}
const gapOf = (a, b) => Math.hypot(Math.max(0, Math.max(a[0], b[0]) - Math.min(a[0] + a[2], b[0] + b[2])), Math.max(0, Math.max(a[1], b[1]) - Math.min(a[1] + a[3], b[1] + b[3])))

/** Size of a label's main lettering in design pixels. */
function textSize(item) {
  const sizes = []
  for (const t of item.t === 'text' ? [item] : item.texts || []) {
    const k = Math.hypot(t.m[2], t.m[3])
    for (const ln of t.lines) for (const r of ln.runs) sizes.push([r.s * k, r.t.length])
  }
  if (!sizes.length) return 0
  sizes.sort((a, b) => a[0] - b[0])
  const total = sizes.reduce((s, x) => s + x[1], 0)
  let acc = 0
  for (const [s, n] of sizes) { acc += n; if (acc >= total / 2) return s }
  return sizes[0][0]
}
/** Scale at which a piece's lettering is about `target` px tall, without outgrowing the column. */
const readable = (item, colW, target = 13.5) => {
  const px = textSize(item) || 30
  return Math.min(Math.max(target / px, 0.24), 0.8, colW / item.w)
}

// ---------------------------------------------------------------- building blocks

/** A patch of the design (rect, in design pixels) shown at `scale`, holding some of its pieces. */
function Patch({ rect, scale, items, onOpen, className = '', style, order }) {
  return (
    <div className={`patch ${className}`} style={{ width: rect[2] * scale, height: rect[3] * scale, ...style }}>
      <div className="patch-inner design" style={{ width: rect[2], height: rect[3], transform: `scale(${scale})` }}>
        {items.map((it) =>
          it.t === 'text' ? (
            <LiveText key={it.id} item={it} ox={rect[0]} oy={rect[1]} className={enterClass(it)} style={{ '--i': order ? order.get(it.id) : 0 }} {...(linkProps(it.link) || {})} />
          ) : (
            <Piece key={it.id} item={it} ox={rect[0]} oy={rect[1]} scale={scale} order={order ? order.get(it.id) : 0} onOpen={onOpen} />
          ),
        )}
      </div>
    </div>
  )
}

/** One label / chip / heading of the design on its own, at a readable size. */
function Solo({ item, scale, onOpen, className = '', style }) {
  const r = rectOf(item)
  return <Patch rect={r} scale={scale} items={[item]} onOpen={onOpen} className={className} style={style} />
}

/** Title lettering: as wide as the column allows, never larger than it was drawn at half size. */
function Heading({ item, colW, max = 0.92, className = '' }) {
  const s = Math.min((colW * max) / item.w, 0.6)
  return <Solo item={item} scale={s} className={`mx-auto ${className}`} />
}

/** Live text set as ordinary flowing copy (for paragraphs that must re-wrap on a phone). */
function Copy({ item, size = 14.5, className = '', as: Tag = 'p', join = ' ' }) {
  const runs = item.lines.flatMap((ln, i) => (i ? [{ t: join, same: 1 }, ...ln.runs] : ln.runs))
  const base = Math.max(...item.lines.map((l) => l.s))
  return (
    <Tag className={className} style={{ fontSize: size }}>
      {runs.map((r, i) =>
        r.same ? r.t : (
          <span key={i} style={{ fontFamily: `var(--f-${r.f})`, fontWeight: r.w, fontStyle: r.i ? 'italic' : undefined, color: r.c, fontSize: `${(r.s / base).toFixed(3)}em`, textTransform: r.up ? 'uppercase' : undefined }}>
            {r.t}
          </span>
        ),
      )}
    </Tag>
  )
}

function Section({ page, children, className = '', style, plate }) {
  const p = page.plate
  const bg = plate ? { backgroundImage: `url(${ASSET(p.srcs[plate === 'big' ? 1 : 2].src)})`, backgroundColor: p.color } : { backgroundColor: p.color }
  return (
    <div className={`flow ${className}`} style={{ ...bg, ...style }}>
      {children}
    </div>
  )
}

const EDGE_H = 340
/** The top or bottom band of a page exactly as designed (background and stars), at full width. */
function Edge({ page, at }) {
  const { vw } = useStage()
  const s = vw / DESIGN.w
  const y0 = at === 'top' ? 0 : DESIGN.h - EDGE_H
  const stars = page.items.filter((i) => i.role === 'star' && i.y < y0 + EDGE_H && i.y + i.h > y0)
  const p = page.plate
  return (
    <div className={`edge edge-${at}`} style={{ height: Math.floor(EDGE_H * s) }} aria-hidden="true">
      <div className="edge-inner" style={{ height: EDGE_H, transform: `scale(${s})` }}>
        <img className="edge-plate" style={{ top: -y0 }} src={ASSET(p.srcs[3].src)} srcSet={p.srcs.map((x) => `${ASSET(x.src)} ${x.w}w`).join(', ')} sizes={`${Math.ceil(vw)}px`} alt="" loading="lazy" decoding="async" draggable={false} />
        {stars.map((it) => (
          <Piece key={it.id} item={it} oy={y0} scale={s} still />
        ))}
      </div>
    </div>
  )
}

function Reveal({ children, className = '', style, as: Tag = 'div' }) {
  const [ref, seen] = useReveal(0.12)
  return (
    <Tag ref={ref} data-in={seen} className={className} style={style}>
      {children}
    </Tag>
  )
}

// ---------------------------------------------------------------- collage pages

/**
 * Group a page's pieces the way the designer arranged them: photos piled on each other form a group,
 * a label belongs to the group it sits on or next to, a sticker stays with a group only if it
 * sits on it. What is left over (a logo between two groups) stands on its own.
 */
function clusters(page) {
  const all = page.items.filter((it) => it.kind !== 'title' && it.role !== 'star')
  // a photo that runs off the edge of the page is only a sliver of film here: leave it to the viewer
  const photos = all.filter((i) => i.kind === 'photo' && !(i.shown < 0.6)).sort((p, q) => coreOf(p)[0] - coreOf(q)[0])
  const parent = photos.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < photos.length; i++) for (let j = i + 1; j < photos.length; j++) if (overlap(coreOf(photos[i]), coreOf(photos[j])) >= 0.06) parent[find(i)] = find(j)
  const byRoot = new Map()
  photos.forEach((p, i) => { const k = find(i); if (!byRoot.has(k)) byRoot.set(k, []); byRoot.get(k).push(p) })

  // a long strip of photos is cut into runs that fit a narrow column
  const groups = []
  for (const list of byRoot.values()) {
    let run = []
    for (const p of list) {
      if (run.length && unite([...run.map(coreOf), coreOf(p)])[2] > 1250) { groups.push({ photos: run, extra: [], labels: [] }); run = [] }
      run.push(p)
    }
    if (run.length) groups.push({ photos: run, extra: [], labels: [] })
  }
  for (const g of groups) g.rect = unite(g.photos.map(coreOf))

  const loose = []
  for (const it of all) {
    if (it.kind === 'photo') continue
    const c = coreOf(it)
    let best = null, bd = Infinity
    for (const g of groups) { const d = Math.min(...g.photos.map((p) => gapOf(coreOf(p), c))); if (d < bd) { bd = d; best = g } }
    if (it.kind === 'label' || it.t === 'text') {
      // a label lying on a photo names that photo: the one its centre is on, drawn just before it
      const mid = [c[0] + c[2] / 2, c[1] + c[3] / 2, 0, 0]
      let own = null
      for (const g of groups) for (const p of g.photos) if (gapOf(coreOf(p), mid) === 0 && p.z < it.z && (!own || p.z > own.p.z)) own = { g, p }
      if (own) own.g.labels.push(it)
      else if (best && bd < 320) best.labels.push(it)
      else loose.push(it)
      continue
    }
    // a sticker: keep it with the photos only if it does not stretch the group
    const grown = best ? unite([best.rect, c]) : null
    if (best && bd < 60 && grown[2] <= best.rect[2] * 1.22 && grown[3] <= best.rect[3] * 1.3) best.extra.push(it)
    else loose.push(it)
  }

  const out = groups.map((g) => ({ photo: true, items: [...g.photos, ...g.extra].sort((p, q) => p.z - q.z), labels: g.labels.sort((p, q) => coreOf(p)[1] - coreOf(q)[1] || coreOf(p)[0] - coreOf(q)[0]), rect: unite([...g.photos, ...g.labels].map(coreOf)) }))
  for (const it of loose) out.push(it.kind === 'label' || it.t === 'text' ? { items: [], labels: [it], rect: coreOf(it) } : { items: [it], labels: [], rect: coreOf(it) })
  return out.sort((p, q) => Math.round(p.rect[1] / 240) - Math.round(q.rect[1] / 240) || p.rect[0] - q.rect[0])
}

function Cluster({ cluster, colW, onOpen, index }) {
  const { items, labels } = cluster
  const rect = items.length ? unite(items.map(rectOf)) : null
  // photo groups fill the column; a lone sticker stays sticker-sized
  const scale = rect ? (cluster.photo ? Math.min(colW / rect[2], 0.62) : Math.min((colW * 0.44) / rect[2], 0.4, 150 / rect[3])) : 0
  const order = arrival(items)
  return (
    <Reveal as="figure" className={`cluster ${cluster.photo ? '' : index % 2 ? 'cluster-right' : 'cluster-left'}`}>
      {rect && <Patch rect={rect} scale={scale} items={items} onOpen={onOpen} order={order} className="mx-auto" />}
      {labels.length > 0 && (
        <figcaption className="cluster-labels">
          {labels.map((l, i) =>
            l.t === 'text' ? (
              <Copy key={l.id} item={l} size={15} className="cluster-note" join={'\n'} />
            ) : (
              <Solo key={l.id} item={l} scale={readable(l, colW)} onOpen={onOpen} style={{ '--tilt': `${i % 2 ? 1.2 : -1.2}deg` }} className="cluster-label" />
            ),
          )}
        </figcaption>
      )}
    </Reveal>
  )
}

function FlowCollage({ page, colW, onOpen }) {
  const titles = page.items.filter((i) => i.kind === 'title')
  const groups = clusters(page)
  return (
    <Section page={page} className="flow-paper">
      <Edge page={page} at="top" />
      {titles.length > 0 && (
        <Reveal className="flow-titles">
          {titles.map((t) => (
            <Heading key={t.id} item={t} colW={colW} max={t.w > 900 ? 0.94 : 0.6} />
          ))}
        </Reveal>
      )}
      {groups.map((g, i) => (
        <Cluster key={(g.items[0] || g.labels[0]).id} cluster={g} colW={colW} onOpen={onOpen} index={i} />
      ))}
      <Edge page={page} at="bottom" />
    </Section>
  )
}

// ---------------------------------------------------------------- cover pages

function FlowIntro({ page, colW, onOpen }) {
  const title = page.items.find((i) => i.role === 'title')
  const portrait = page.items.find((i) => i.role === 'portrait')
  const name = page.items.find((i) => i.role === 'name')
  const pills = page.items.filter((i) => i.kind === 'label').sort((a, b) => a.x - b.x)
  const welcome = page.items.find((i) => i.t === 'text')
  const figure = [portrait, name].filter(Boolean)
  const rect = figure.length ? unite(figure.map(rectOf)) : null
  const fs = rect ? Math.min((colW * 1.08) / rect[2], 0.5) : 0
  return (
    <Section page={page} plate="big" className="flow-intro">
      <Reveal className="flow-intro-top">
        {title && <Solo item={title} scale={Math.min((colW * 0.86) / title.w, 0.5)} />}
        <nav className="flow-pills" aria-label="Sections">
          {pills.map((p) => (
            <Solo key={p.id} item={p} scale={Math.min(22 / (textSize(p) || 80), (colW * 0.9) / p.w)} onOpen={onOpen} />
          ))}
        </nav>
        {welcome && <Copy item={welcome} size={13.5} className="flow-welcome fade" />}
      </Reveal>
      {rect && (
        <Reveal className="flow-intro-figure">
          <Patch rect={rect} scale={fs} items={figure} onOpen={onOpen} />
        </Reveal>
      )}
    </Section>
  )
}

function FlowThanks({ page, colW, onOpen }) {
  const title = page.items.find((i) => i.role === 'title')
  const sub = page.items.find((i) => i.role === 'subtitle')
  const lines = page.items.filter((i) => i.t === 'text').sort((a, b) => a.b[1] - b.b[1])
  const chips = page.items.filter((i) => i.kind === 'label').sort((a, b) => a.x - b.x)
  const cs = Math.min(...chips.map((c) => readable(c, colW, 15)), 0.62)
  return (
    <>
      <Section page={page} plate="big" className="flow-thanks">
        <Reveal>
          {title && <Heading item={title} colW={colW} max={0.96} />}
          {sub && <Heading item={sub} colW={colW} max={0.92} className="mt-3" />}
        </Reveal>
      </Section>
      <Reveal className="flow flow-band">
        {lines.map((l) => (
          <Copy key={l.id} item={l} size={12.5} className="flow-band-line fade" />
        ))}
        <div className="flow-chips flow-chips-centre">
          {chips.map((c) => (
            <Solo key={c.id} item={c} scale={cs} onOpen={onOpen} />
          ))}
        </div>
      </Reveal>
    </>
  )
}

// ---------------------------------------------------------------- about

function FlowAbout({ page, colW, onOpen }) {
  const items = page.items
  const heads = items.filter((i) => i.role === 'head').sort((a, b) => a.y - b.y || a.x - b.x)
  const title = items.find((i) => i.role === 'title')
  const portrait = items.find((i) => i.role === 'portrait')
  const firstHeadY = heads.length ? Math.min(...heads.map((h) => h.y)) : Infinity
  const cy = (it) => coreOf(it)[1] + coreOf(it)[3] / 2
  const cx = (it) => coreOf(it)[0] + coreOf(it)[2] / 2

  // above the headings: tab, paragraph, contact chips
  const top = items.filter((i) => i !== title && i !== portrait && i.role !== 'head' && cy(i) < firstHeadY)
  const tab = top.find((i) => i.kind === 'label' && !i.link && i.y < (title ? title.y : 200))
  const para = top.find((i) => i.t === 'text' && i.box) || top.find((i) => i.t === 'text')
  const contacts = top.filter((i) => i.kind === 'label' && i.link).sort((a, b) => Math.round(a.y / 60) - Math.round(b.y / 60) || a.x - b.x)

  // The headings stand in columns. A piece belongs to the column it sits in, and there to the
  // nearest heading above it. Read column by column on a phone.
  const columns = []
  for (const h of [...heads].sort((a, b) => a.x - b.x)) {
    const col = columns.find((c) => Math.abs(c[0].x - h.x) < 260)
    if (col) col.push(h)
    else columns.push([h])
  }
  columns.forEach((c) => c.sort((a, b) => a.y - b.y))
  const ordered = columns.flat()
  const owner = (it) => {
    const col = [...columns].reverse().find((c) => Math.min(...c.map((h) => h.x)) - 120 <= cx(it))
    if (!col) return null
    return [...col].reverse().find((h) => h.y <= cy(it) + 20) || null
  }
  const under = new Map(heads.map((h) => [h.id, []]))
  for (const it of items) {
    if (it === title || it === portrait || it.role === 'head' || top.includes(it) || it.kind === 'deco' || it.kind === 'sprite') continue
    const h = owner(it)
    if (h) under.get(h.id).push(it)
  }
  const chipScale = (list) => Math.min(...list.map((c) => readable(c, colW, 14)), 0.6)

  const block = (h) => {
    const list = under.get(h.id).sort((a, b) => Math.round(cy(a) / 30) - Math.round(cy(b) / 30) || coreOf(a)[0] - coreOf(b)[0])
    const chips = list.filter((i) => i.kind === 'label')
    // photos carry their own notes: gather those too
    const texts = [...list.filter((i) => i.t === 'text'), ...(portrait && portrait.texts ? portrait.texts.filter((t) => owner(t) === h) : [])]
    const hand = texts.filter((t) => t.lines[0].runs[0].f === 'hand')
    // a coloured word laid over a note (the red "adaptable") is part of that note
    const overlays = hand.filter((n) => hand.some((m) => m !== n && m.plain.includes(n.plain.trim()) && near(m.b, n.b, 4)))
    // a few handwritten words right beside a chip ("my job") are a tag on that chip
    const tagOf = new Map()
    for (const n of hand) {
      if (overlays.includes(n) || n.plain.replace(/\s+/g, ' ').length > 12) continue
      const chip = chips.find((c) => gapOf(coreOf(c), n.b) < 70)
      if (chip) tagOf.set(chip.id, n)
    }
    const notes = hand.filter((n) => ![...tagOf.values()].includes(n))
    const plain = texts.filter((t) => !hand.includes(t))
    // "KEY:" on the left with its value(s) on the right
    const keys = plain.filter((t) => /:\s*$/.test(t.plain))
    const rows = keys.map((k, i) => {
      const next = keys[i + 1]
      const vals = plain.filter((t) => !keys.includes(t) && t.m[5] >= k.m[5] - 12 && (!next || t.m[5] < next.m[5] - 12))
      return { k, vals }
    })
    const used = new Set(rows.flatMap((r) => [r.k, ...r.vals]))
    const loose = plain.filter((t) => !used.has(t))
    return (
      <Reveal as="section" key={h.id} className="about-block">
        <Solo item={h} scale={Math.min(0.5, (colW * 0.9) / h.w)} className="about-head" />
        {rows.length > 0 && (
          <dl className="about-facts">
            {rows.map((r) => (
              <div key={r.k.id}>
                <Copy as="dt" item={r.k} size={14} />
                <dd>
                  {r.vals.map((v) => (
                    <Copy as="span" key={v.id} item={v} size={14} className="block" />
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {loose.map((t) => (
          <Copy key={t.id} item={t} size={14} className="about-entry" join={'\n'} />
        ))}
        {chips.length > 0 && (
          <div className="flow-chips">
            {chips.map((c) => {
              const tag = tagOf.get(c.id)
              const chip = <Solo key={c.id} item={c} scale={chipScale(chips)} onOpen={onOpen} />
              return tag ? (
                <span key={c.id} className="chip-tagged">
                  <Copy as="span" item={tag} size={15} className="chip-tag" />
                  {chip}
                </span>
              ) : chip
            })}
          </div>
        )}
        {notes.filter((n) => !overlays.includes(n)).map((n) => {
          const hit = overlays.find((o) => n.plain.includes(o.plain.trim()))
          const link = linkProps(n.link)
          const body = hit ? <NoteWith item={n} word={hit} /> : <Copy as="span" item={n} size={17} />
          return link ? (
            <a key={n.id} className="about-note" href={link.href} onClick={link.onClick} aria-label={link.label} target={/^https?:/.test(link.href) ? '_blank' : undefined} rel="noopener">
              {body} <span aria-hidden="true">→</span>
            </a>
          ) : (
            <p key={n.id} className="about-note">{body}</p>
          )
        })}
      </Reveal>
    )
  }

  return (
    <Section page={page} className="flow-paper flow-about">
      <Edge page={page} at="top" />
      <Reveal>
        {tab && <Solo item={tab} scale={0.42} className="about-tab" />}
        {title && <Solo item={title} scale={Math.min((colW * 0.98) / title.w, 0.5)} className="mt-4" />}
        {para && <Copy item={para} size={14.5} className="about-para fade" />}
        <div className="flow-chips mt-5">
          {contacts.map((c) => (
            <Solo key={c.id} item={c} scale={chipScale(contacts)} onOpen={onOpen} />
          ))}
        </div>
      </Reveal>
      {portrait && (
        <Reveal className="about-portrait">
          <Patch rect={rectOf(portrait)} scale={Math.min((colW * 1.02) / portrait.w, 0.6)} items={[portrait]} onOpen={onOpen} className="mx-auto" />
        </Reveal>
      )}
      {ordered.map(block)}
      <Edge page={page} at="bottom" />
    </Section>
  )
}

/** A handwritten note with one word in another colour. */
function NoteWith({ item, word }) {
  const text = item.lines.map((l) => l.runs.map((r) => r.t).join('')).join(' ')
  const w = word.plain.trim()
  const at = text.indexOf(w)
  const colour = word.lines[0].runs[0].c
  const base = item.lines[0].runs[0]
  return (
    <span style={{ fontFamily: `var(--f-${base.f})`, color: base.c, fontSize: 17 }}>
      {at < 0 ? text : <>{text.slice(0, at)}<span style={{ color: colour }}>{w}</span>{text.slice(at + w.length)}</>}
    </span>
  )
}

// ---------------------------------------------------------------- entry

export default memo(function Flow({ page, onOpen }) {
  const { vw } = useStage()
  const colW = Math.min(vw, MAX_W) - PAD * 2
  const open = (id) => onOpen(page.id, id)
  if (page.id === 'intro') return <FlowIntro page={page} colW={colW} onOpen={open} />
  if (page.id === 'about') return <FlowAbout page={page} colW={colW} onOpen={open} />
  if (page.id === 'thanks') return <FlowThanks page={page} colW={colW} onOpen={open} />
  if (!page.items.some((i) => i.kind === 'photo' || i.kind === 'label')) return <Stage page={page} onOpen={onOpen} />
  return <FlowCollage page={page} colW={colW} onOpen={open} />
})
