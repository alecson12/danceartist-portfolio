import { memo, useEffect, useRef, useState } from 'react'
import { ASSET, DESIGN } from '../content/pages.js'
import { scrollToPage, useStage } from '../lib/stage.js'
import LiveText from './LiveText.jsx'

// how each kind of piece arrives
const ENTER = { title: 'stamp', photo: 'rise', label: 'pop', deco: 'fade', sprite: 'pop', text: 'fade' }
const ENTER_ROLE = { portrait: 'slide', name: 'pop' }
export const enterClass = (item) => ENTER_ROLE[item.role] || ENTER[item.t === 'text' ? 'text' : item.kind] || ''

export function linkProps(link) {
  if (!link) return null
  if (link.page) return { href: `#${link.page}`, onClick: (e) => { e.preventDefault(); scrollToPage(link.page) }, label: link.label }
  return { href: link.href, label: link.label }
}
const external = (href) => (/^https?:/.test(href) ? { target: '_blank', rel: 'noopener' } : null)

/**
 * Marks an element data-in="0" until it scrolls into view, "1" while its pieces arrive,
 * "2" once they have settled. The entrance styles in index.css hang off that attribute.
 */
export function useReveal(threshold = 0.16) {
  const ref = useRef(null)
  const [seen, setSeen] = useState('0')
  useEffect(() => {
    const el = ref.current
    if (!el || seen !== '0') return
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen('1'); io.disconnect() } }, { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [seen, threshold])
  useEffect(() => {
    if (seen !== '1') return
    const t = setTimeout(() => setSeen('2'), 1700)
    return () => clearTimeout(t)
  }, [seen])
  return [ref, seen]
}

function Sprite({ item, scale, eager }) {
  return (
    <img
      src={ASSET(item.src)}
      srcSet={item.half ? `${ASSET(item.half)} ${Math.round(item.w / 2)}w, ${ASSET(item.src)} ${item.w}w` : undefined}
      sizes={item.half ? `${Math.max(1, Math.ceil(item.w * scale))}px` : undefined}
      width={item.w}
      height={item.h}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
    />
  )
}

/**
 * One piece of the design (photo, label, title, sticker) with the live text that sits on it.
 * Positioned in design pixels; ox/oy move the origin when it is shown inside a smaller patch.
 */
export const Piece = memo(function Piece({ item, order = 0, z, scale, eager, onOpen, ox = 0, oy = 0, still }) {
  const cls = still ? '' : enterClass(item)
  const style = { left: item.x - ox, top: item.y - oy, width: item.w, height: item.h, '--i': order, '--z': z }
  const kids = (item.texts || []).map((t) => <LiveText key={t.id} item={t} ox={item.x} oy={item.y} />)

  if (item.kind === 'photo' && item.full) {
    style['--tilt'] = order % 2 ? '0.4deg' : '-0.4deg'
    style['--from'] = order % 2 ? '-2deg' : '2deg'
    const name = item.alt || (item.caption ? item.caption.join(', ') : 'Photo')
    return (
      <>
        <button type="button" className={`pc pc-photo ${cls}`} style={style} onClick={() => onOpen(item.id)} aria-label={`View photo: ${name}`}>
          <Sprite item={item} scale={scale} eager={eager} />
        </button>
        {/* What is written on the photo. In the design it lies over neighbouring photos too, so it
            sits in a twin box above them and follows the photo's every move (see .pc-follow). */}
        {kids.length > 0 && (
          <div className={`pc pc-follow ${cls}`} style={style} aria-hidden="true">
            {kids}
          </div>
        )}
      </>
    )
  }
  const link = linkProps(item.link)
  if (link) {
    const { label, ...rest } = link
    return (
      <a className={`pc pc-link ${cls}`} style={style} aria-label={label} {...rest} {...external(rest.href)}>
        <Sprite item={item} scale={scale} eager={eager} />
        {kids}
      </a>
    )
  }
  if (item.alt && !kids.length) {
    return (
      <div className={`pc ${cls}`} style={style} role="img" aria-label={item.alt}>
        <Sprite item={item} scale={scale} eager={eager} />
      </div>
    )
  }
  return (
    <div className={`pc ${cls}`} style={style} aria-hidden={kids.length ? undefined : true}>
      <Sprite item={item} scale={scale} eager={eager} />
      {kids}
    </div>
  )
})

/** Arrival order of a set of pieces: top to bottom in bands, left to right inside a band. */
export function arrival(items) {
  const top = (it) => (it.core || it.b)[1]
  const left = (it) => (it.core || it.b)[0]
  return new Map([...items].sort((p, q) => Math.round(top(p) / 260) - Math.round(top(q) / 260) || left(p) - left(q)).map((it, i) => [it.id, Math.min(i, 14)]))
}

/**
 * Reading order: titles first, then top to bottom in bands, left to right. The pieces are
 * written to the page in this order (so the Tab key and screen readers follow the layout),
 * while --z keeps the stacking the designer gave them.
 */
function reading(items) {
  const top = (it) => (it.core || it.b)[1]
  const left = (it) => (it.core || it.b)[0]
  const rank = (it) => (it.kind === 'title' ? 0 : 1)
  return [...items].sort((p, q) => rank(p) - rank(q) || Math.round(top(p) / 200) - Math.round(top(q) / 200) || left(p) - left(q))
}

/** One page of the design, scaled as a whole. */
export default memo(function Stage({ page, eager, onOpen }) {
  const { scale, width } = useStage()
  const [ref, seen] = useReveal()
  const order = arrival(page.items)
  const stack = new Map(page.items.map((it, i) => [it.id, i + 1]))
  const plate = page.plate
  const open = (id) => onOpen(page.id, id)

  return (
    <div className="stage" ref={ref} data-in={seen} style={{ background: plate.color }}>
      <div className="stage-inner design">
        <img
          className="plate"
          src={ASSET(plate.srcs[2].src)}
          srcSet={plate.srcs.map((s) => `${ASSET(s.src)} ${s.w}w`).join(', ')}
          sizes={`${Math.ceil(width)}px`}
          width={DESIGN.w}
          height={DESIGN.h}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          decoding="async"
          draggable={false}
          style={{ backgroundImage: `url(${plate.tiny})` }}
        />
        {reading(page.items).map((item) =>
          item.t === 'text' ? (
            <LiveText key={item.id} item={item} className={ENTER.text} style={{ '--i': order.get(item.id), '--z': stack.get(item.id) }} {...(linkProps(item.link) || {})} />
          ) : (
            <Piece key={item.id} item={item} order={order.get(item.id)} z={stack.get(item.id)} scale={scale} eager={eager} onOpen={open} still={item.y <= 3 || item.y + item.h >= DESIGN.h - 3 /* continues on the next page: must not move apart from its other half */} />
          ),
        )}
      </div>
    </div>
  )
})
