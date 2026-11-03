import { useEffect, useState } from 'react'
import pages from 'virtual:pages'
import { PORTFOLIO } from './content/portfolio.js'
import { STARS } from './content/stars.js'

const BASE = import.meta.env.BASE_URL

// Height reserved for the fixed header (also set as --nav-h in index.css).
const NAV_H = PORTFOLIO.header ? 56 : 0

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

// Resolve each header link (and its drop-down children) to the page it points at.
const resolve = (l) => ({ ...l, target: pages.find((p) => p.name.includes(l.page)) })
const links = (PORTFOLIO.header?.links ?? [])
  .map((l) => ({ ...resolve(l), children: (l.children ?? []).map(resolve).filter((c) => c.target) }))
  .filter((l) => l.target)

export default function App() {
  useEffect(() => {
    document.title = PORTFOLIO.title
    document.body.style.background = PORTFOLIO.background
  }, [])

  const maxWidth = PORTFOLIO.maxWidth ?? 'none'
  return (
    <div className="min-h-dvh" style={{ background: PORTFOLIO.background, paddingTop: NAV_H }}>
      {PORTFOLIO.header && <Header />}

      <main className="mx-auto w-full" style={{ maxWidth }}>
        {pages.length === 0 ? (
          <Empty />
        ) : (
          pages.map((page, i) => <Page key={page.name} page={page} index={i} />)
        )}
      </main>

      {PORTFOLIO.footer && (
        <footer className="mx-auto w-full py-6 text-center" style={{ maxWidth }}>
          <a
            href={PORTFOLIO.footer.href}
            className="text-xs tracking-wide text-white/40 transition-colors hover:text-white/80"
          >
            {PORTFOLIO.footer.label}
          </a>
        </footer>
      )}
    </div>
  )
}

// Fixed top bar: name on the left, section links on the right. The link whose
// page is currently on screen is underlined.
function Header() {
  const { name, subtitle } = PORTFOLIO.header
  const [active, setActive] = useState(links[0]?.target.name ?? '')
  const [open, setOpen] = useState(null) // label of the drop-down that is open (tap/keyboard)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!e.target.closest?.('header')) setOpen(null) }
    const onKey = (e) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    // Which link is active = the last link whose page has reached the probe line,
    // a little below the header (so short pages on phones still count one at a time).
    const onScroll = () => {
      const probe = window.scrollY + NAV_H + Math.min(window.innerHeight / 3, 160)
      let current = links[0]?.target.name ?? ''
      for (const l of links) {
        const el = document.getElementById(slug(l.target.name))
        if (el && el.offsetTop <= probe) current = l.target.name
      }
      setActive(current)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const go = (e, l) => {
    e.preventDefault()
    const el = document.getElementById(slug(l.target.name))
    if (!el) return
    const top = l === links[0] ? 0 : el.offsetTop - NAV_H
    window.scrollTo({ top, behavior: 'smooth' })
    history.replaceState(null, '', l === links[0] ? window.location.pathname : `#${slug(l.target.name)}`)
    setOpen(null)
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-black/75 text-white backdrop-blur-md" style={{ height: NAV_H }}>
      <div className="mx-auto flex h-full max-w-[1800px] items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#" onClick={(e) => links[0] && go(e, links[0])} className="hidden shrink-0 leading-tight sm:block">
          <span className="block text-sm font-semibold tracking-wide">{name}</span>
          {subtitle && <span className="block text-[11px] tracking-[0.18em] text-white/55 uppercase">{subtitle}</span>}
        </a>
        <nav aria-label="Sections" className="flex h-full w-full items-stretch justify-between sm:w-auto sm:justify-end">
          {links.map((l) => {
            const on = active === l.target.name
            const hasMenu = l.children.length > 0
            const isOpen = open === l.label
            return (
              <div key={l.label} className="group relative flex shrink-0 items-stretch">
                <a
                  href={`#${slug(l.target.name)}`}
                  onClick={(e) => go(e, l)}
                  className={`relative flex items-center pl-2.5 text-[11px] tracking-[0.06em] whitespace-nowrap uppercase transition-colors sm:pl-4 sm:text-[13px] sm:tracking-[0.12em] ${hasMenu ? 'pr-1' : 'pr-2.5 sm:pr-4'} ${on ? 'text-white' : 'text-white/60 hover:text-white'}`}
                >
                  <span className="sm:hidden">{l.short ?? l.label}</span>
                  <span className="hidden sm:inline">{l.label}</span>
                </a>
                {hasMenu && (
                  <button
                    type="button"
                    aria-label={`${l.label} shortcuts`}
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : l.label)}
                    className={`flex items-center pr-2.5 pl-0.5 text-white/60 transition-colors hover:text-white sm:pr-4 ${isOpen ? 'text-white' : ''}`}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true">
                      <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  </button>
                )}
                {on && <span className="absolute inset-x-2.5 bottom-0 h-[3px] bg-[#c8102e] sm:inset-x-4" />}
                {hasMenu && (
                  <ul
                    className={`absolute top-full right-0 z-50 min-w-[220px] border border-white/10 bg-black/90 py-1.5 shadow-xl backdrop-blur-md ${isOpen ? 'block' : 'hidden'} [@media(hover:hover)]:group-hover:block`}
                  >
                    {l.children.map((c) => (
                      <li key={c.label}>
                        <a
                          href={`#${slug(c.target.name)}`}
                          onClick={(e) => go(e, c)}
                          className="block px-4 py-2 text-[12px] tracking-[0.08em] whitespace-nowrap text-white/70 uppercase transition-colors hover:bg-white/10 hover:text-white"
                        >
                          {c.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </nav>
      </div>
    </header>
  )
}

// One page image plus, optionally, its spinning stars and a blurred copy of
// itself behind it to fill the space at the sides.
function Page({ page, index }) {
  const stars = (PORTFOLIO.stars && STARS[page.name]) || []
  const aspect = page.width / page.height
  return (
    <section
      id={slug(page.name)}
      className="relative overflow-hidden"
      style={{ scrollMarginTop: NAV_H }}
    >
      {PORTFOLIO.sides === 'blur' && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${page.src}")`, filter: 'blur(40px) brightness(0.6)', transform: 'scale(1.2)' }}
        />
      )}
      <div
        className="relative mx-auto"
        style={PORTFOLIO.fitScreen ? { maxWidth: `calc((100dvh - ${NAV_H}px) * ${aspect})` } : undefined}
      >
        <img
          src={page.src}
          width={page.width}
          height={page.height}
          alt={PORTFOLIO.alt[page.name] ?? `${PORTFOLIO.title}, page ${index + 1}`}
          className="h-auto w-full"
          loading={index < 2 ? 'eager' : 'lazy'}
          fetchPriority={index === 0 ? 'high' : 'auto'}
          decoding="async"
        />
        {stars.map((star, i) => (
          <Star key={i} star={star} index={i} />
        ))}
      </div>
    </section>
  )
}

function Star({ star, index }) {
  const { icon, scale, seconds } = PORTFOLIO.stars
  const size = star.s * (star.k ?? scale)
  // vary speed and direction per star so the page feels alive rather than mechanical
  const duration = seconds * (0.85 + ((index * 7) % 5) * 0.12)
  const reverse = index % 2 === 1
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: `${star.x}%`,
        top: `${star.y}%`,
        width: `${size}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <img
        src={BASE + icon}
        alt=""
        aria-hidden="true"
        className="spin block h-auto w-full"
        style={{
          '--spin-from': `${star.r ?? 0}deg`,
          animationDuration: `${duration}s`,
          animationDirection: reverse ? 'reverse' : 'normal',
        }}
      />
    </div>
  )
}

// Shown only while public/pages/ has no images yet.
function Empty() {
  return (
    <p className="flex min-h-dvh items-center justify-center px-6 text-center text-sm text-white/50">
      No images yet — drop them into public/pages/ as 01.jpg, 02.jpg, 03.jpg …
    </p>
  )
}
