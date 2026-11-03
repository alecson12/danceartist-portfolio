import { useEffect, useState } from 'react'
import pages from 'virtual:pages'
import { PORTFOLIO } from './content/portfolio.js'
import { STARS } from './content/stars.js'

const BASE = import.meta.env.BASE_URL

// Height reserved for the fixed header (also set as --nav-h in index.css).
const NAV_H = PORTFOLIO.header ? 56 : 0

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

// Resolve each header link to the page it points at.
const links = (PORTFOLIO.header?.links ?? [])
  .map((l) => ({ ...l, target: pages.find((p) => p.name.includes(l.page)) }))
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
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-black/75 text-white backdrop-blur-md" style={{ height: NAV_H }}>
      <div className="mx-auto flex h-full max-w-[1800px] items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#" onClick={(e) => links[0] && go(e, links[0])} className="hidden shrink-0 leading-tight sm:block">
          <span className="block text-sm font-semibold tracking-wide">{name}</span>
          {subtitle && <span className="block text-[11px] tracking-[0.18em] text-white/55 uppercase">{subtitle}</span>}
        </a>
        <nav aria-label="Sections" className="-mx-4 flex h-full w-full items-stretch overflow-x-auto px-4 sm:mx-0 sm:w-auto sm:px-0 [scrollbar-width:none]">
          {links.map((l) => {
            const on = active === l.target.name
            return (
              <a
                key={l.label}
                href={`#${slug(l.target.name)}`}
                onClick={(e) => go(e, l)}
                className={`relative flex shrink-0 items-center px-2.5 text-[11px] tracking-[0.06em] whitespace-nowrap uppercase transition-colors sm:px-4 sm:text-[13px] sm:tracking-[0.12em] ${on ? 'text-white' : 'text-white/60 hover:text-white'}`}
              >
                <span className="sm:hidden">{l.short ?? l.label}</span>
                <span className="hidden sm:inline">{l.label}</span>
                {on && <span className="absolute inset-x-2.5 bottom-0 h-[3px] bg-[#c8102e] sm:inset-x-4" />}
              </a>
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
