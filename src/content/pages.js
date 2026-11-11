// Puts the generated page data (from `npm run extract`) together with the hand-written
// settings in site.js. Nothing to edit here.
import intro from './generated/intro.json'
import about from './generated/about.json'
import highlights from './generated/highlights.json'
import works from './generated/works.json'
import thanks from './generated/thanks.json'
import fonts from './generated/fonts.json'
import { SITE } from './site.js'

export const DESIGN = { w: 3275, h: 1842 }
export const FONTS = fonts
export const ASSET = (src) => import.meta.env.BASE_URL + src

const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim()
const linkFor = (page, text) => SITE.links.find((l) => norm(l.text) === norm(text) && (!l.on || l.on === page.id))
const plainOf = (item) => (item.t === 'text' ? item.plain : (item.texts || []).map((t) => t.plain).join(' '))

function decorate(page) {
  const items = page.items.map((item) => {
    const link = linkFor(page, plainOf(item))
    return link ? { ...item, link } : item
  })
  // photos, in the order a viewer steps through them: top to bottom, then left to right
  const photos = items
    .filter((i) => i.kind === 'photo' && i.full)
    .sort((a, b) => a.core[1] + a.core[3] / 2 - (b.core[1] + b.core[3] / 2) || a.core[0] - b.core[0])
    .map((i) => i.id)
  const title = SITE.pages[page.id] || page.id
  return { ...page, items, photos, title }
}

export const PAGES = [...intro, ...about, ...highlights, ...works, ...thanks].map(decorate)
export const PAGE_BY_ID = Object.fromEntries(PAGES.map((p) => [p.id, p]))
