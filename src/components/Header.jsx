import { useEffect, useState } from 'react'
import { SITE } from '../content/site.js'
import { PAGES } from '../content/pages.js'
import { NAV_H, scrollToPage, useStage } from '../lib/stage.js'

const LINKS = SITE.header.links.map((l) => ({ ...l, children: l.children || [] }))
// which top-level link a page belongs to: the last link at or before it
const ORDER = PAGES.map((p) => p.id)
const ownerOf = (pageId) => {
  const at = ORDER.indexOf(pageId)
  let owner = LINKS[0]
  for (const l of LINKS) if (ORDER.indexOf(l.page) <= at) owner = l
  return owner
}

function useActivePage() {
  const [active, setActive] = useState(ORDER[0])
  useEffect(() => {
    let raf = 0
    const read = () => {
      const probe = NAV_H + Math.min(window.innerHeight / 3, 220)
      let cur = ORDER[0]
      for (const id of ORDER) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= probe) cur = id
      }
      setActive(cur)
    }
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(read) }
    read()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', on); window.removeEventListener('resize', on) }
  }, [])
  return active
}

const Chevron = ({ open }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }}>
    <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
)

export default function Header() {
  const { mode } = useStage()
  const active = useActivePage()
  const owner = ownerOf(active)
  const [open, setOpen] = useState(null) // label of the open drop-down, or 'menu' for the phone menu

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!e.target.closest?.('.nav')) setOpen(null) }
    const onKey = (e) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', onKey) }
  }, [open])
  // the phone menu covers the page: keep the page from scrolling behind it
  useEffect(() => {
    if (open !== 'menu') return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  const go = (e, page) => {
    e.preventDefault()
    setOpen(null)
    scrollToPage(page)
  }

  const brand = (
    <a href="#intro" onClick={(e) => go(e, 'intro')} className="shrink-0 leading-tight">
      <span className="block text-[13px] font-bold tracking-[0.08em] uppercase">{SITE.header.name}</span>
      <span className="block text-[10.5px] font-medium tracking-[0.2em] text-[#fdf6ec]/55 uppercase">{SITE.header.subtitle}</span>
    </a>
  )

  if (mode === 'flow') {
    const isOpen = open === 'menu'
    return (
      <header className="nav">
        <div className="flex h-full items-center justify-between gap-3 px-4">
          {brand}
          <button type="button" className="nav-link h-full gap-2 px-1" data-on={isOpen ? 1 : 0} aria-expanded={isOpen} aria-controls="phone-menu" onClick={() => setOpen(isOpen ? null : 'menu')}>
            <span>{isOpen ? 'Close' : owner.short || owner.label}</span>
            <span aria-hidden="true" className="grid gap-[4px]">
              <i className="block h-[2px] w-5 bg-current" style={{ transform: isOpen ? 'translateY(3px) rotate(45deg)' : undefined, transition: 'transform .2s' }} />
              <i className="block h-[2px] w-5 bg-current" style={{ transform: isOpen ? 'translateY(-3px) rotate(-45deg)' : undefined, transition: 'transform .2s' }} />
            </span>
            <span className="sr-only">menu</span>
          </button>
        </div>
        {isOpen && (
          <nav id="phone-menu" aria-label="Sections" className="phone-menu">
            {LINKS.map((l, i) => (
              <div key={l.label} className="phone-menu-group" style={{ '--i': i }}>
                <a href={`#${l.page}`} onClick={(e) => go(e, l.page)} data-on={owner === l ? 1 : 0} className="phone-menu-main">
                  {l.label}
                </a>
                {l.children.map((c) => (
                  <a key={c.label} href={`#${c.page}`} onClick={(e) => go(e, c.page)} className="phone-menu-sub">
                    {c.label}
                  </a>
                ))}
              </div>
            ))}
          </nav>
        )}
      </header>
    )
  }

  return (
    <header className="nav">
      <div className="mx-auto flex h-full max-w-[1800px] items-center justify-between gap-4 px-6">
        {brand}
        <nav aria-label="Sections" className="flex h-full items-stretch">
          {LINKS.map((l) => {
            const on = owner === l
            const hasMenu = l.children.length > 0
            const isOpen = open === l.label
            return (
              <div key={l.label} className="group relative flex items-stretch">
                <a href={`#${l.page}`} onClick={(e) => go(e, l.page)} className={`nav-link pl-3 lg:pl-4 ${hasMenu ? 'pr-1' : 'pr-3 lg:pr-4'}`} data-on={on ? 1 : 0} aria-current={on ? 'true' : undefined}>
                  {l.label}
                </a>
                {hasMenu && (
                  <button type="button" aria-label={`${l.label} shortcuts`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : l.label)} className="nav-link pr-3 pl-0.5 lg:pr-4" data-on={isOpen || on ? 1 : 0}>
                    <Chevron open={isOpen} />
                  </button>
                )}
                {on && <span className="nav-bar" />}
                {hasMenu && (
                  <div className={`nav-menu ${isOpen ? 'block' : 'hidden'} [@media(hover:hover)]:group-hover:block [@media(hover:hover)]:group-focus-within:block`}>
                    {l.children.map((c) => (
                      <a key={c.label} href={`#${c.page}`} onClick={(e) => go(e, c.page)} aria-current={active === c.page ? 'true' : undefined}>
                        {c.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
