// What the extraction reads, and the few decisions it cannot guess from the layers.
//
// The design folder is only ever READ. Point DANCE_DESIGN_DIR somewhere else if it moves.
'use strict'
const path = require('node:path')

const DESIGN_DIR = process.env.DANCE_DESIGN_DIR || 'E:/_DESIGN FILES/Dance Portfolio'
const PAGE_W = 3275
const PAGE_H = 1842

const name = (...names) => (u) => names.includes(u.name)
const re = (r) => (u) => r.test(u.name)
const inGroup = (g) => (u) => u.path.split(' / ').slice(0, -1).includes(g)
const isStar = (u) => /^star_p5/.test(u.name)

/**
 * rules: first match wins. kind:
 *   title   display lettering kept as artwork (gets a real heading for screen readers)
 *   photo   a picture card: hover, opens in the viewer
 *   sprite  a separate, non-interactive piece (so it can sit above other pieces or animate)
 *   static  stays in the page background
 */
const DOCS = [
  {
    key: 'intro',
    file: 'DP_WEBSITE/DPWeb_Page0_Intro(Landscape).psd',
    pages: ['intro'],
    rules: [
      { test: name('TEXT'), kind: 'title', id: 'title', alt: 'Dance Portfolio' },
      { test: name('NAME  copy'), kind: 'sprite', id: 'name', alt: 'Alecson Gantica' },
      { test: name('Group 1 copy 2'), kind: 'sprite', id: 'portrait', alt: 'Illustrated portrait of Alecson Gantica pointing at the viewer' },
    ],
  },
  {
    key: 'about',
    file: 'DP_WEBSITE/DPWeb_Page1_AbtMe.psd',
    pages: ['about'],
    // the cream paper, sampled here for the phone layout's background
    paper: { layers: ['Color Fill 1', 'GRUNGE_10'], at: [520, 1030] },
    rules: [
      { test: name('Hello copy 2'), kind: 'title', id: 'title', alt: 'Kamusta?' },
      { test: name('PIcsAndStickers'), kind: 'photo', id: 'portrait', alt: 'Alecson Gantica leaning on a lamp post, with Rocketeerz, FLOPM and Nitrous Image stickers', crop: 'Poster copy' },
      { test: name('Rectangle 2'), kind: 'static' }, // plain backing behind the paragraph
      { test: name('TITLES'), kind: 'title', id: 'head', split: true, alts: ['Background', 'Groups / Reppin', 'Main dance styles'] },
      { test: name('Layer 14'), kind: 'title', id: 'head', alt: 'Beside dance I do' },
    ],
  },
  {
    key: 'highlights',
    file: 'DP_WEBSITE/DPWeb_Page2_Highlight.psd',
    pages: ['highlights', 'highlights-group-1', 'highlights-group-2', 'highlights-group-3', 'highlights-group-4', 'highlights-solo-1', 'highlights-solo-2'],
    rules: [
      { test: name('Highlights copy'), kind: 'title', id: 'title', alt: 'Highlights' },
      { test: name('Title 1 copy'), kind: 'title', id: 'title', alt: 'Competitions (Group | Nitrous Image)' },
      { test: name('Title 1 copy 2'), kind: 'title', id: 'title', alt: 'Competitions (Solo)' },
      { test: (u) => u.rawKind === 'SMART' && /^[1-5]$/.test(u.name), kind: 'photo' },
    ],
  },
  {
    key: 'works',
    file: 'DP_WEBSITE/DPWeb_Page3_Works.psd',
    pages: ['works', 'works-tv-1', 'works-tv-2', 'works-coaching', 'works-judging', 'works-corporate-1', 'works-corporate-2', 'works-corporate-3', 'works-passion-1', 'works-passion-2', 'works-passion-3'],
    rules: [
      { test: name('works & copy'), kind: 'title', id: 'title', alt: 'Works & Projects' },
      {
        test: name('Title 1 copy 5'), kind: 'title', id: 'title',
        alts: {
          'works-tv-1': ['TV Appearances: solo and group'],
          'works-coaching': ['Coaching Experience'],
          'works-judging': ['Competition Judging'],
          'works-corporate-1': ['Corporate Guestings and private events'],
          'works-passion-1': ['Passion Projects as dancer / choreographer'],
        },
      },
    ],
  },
  {
    key: 'thanks',
    file: 'DP_Page4_LastPPage.psd',
    // The saved PSD is the 2800 px version; the 3275 px export is the reference for this page.
    truth: 'DP_WEBSITE/DPWeb_Page4_LastPPage.png',
    offsetX: -237,
    pages: ['thanks'],
    bgExclude: isStar,
    rules: [
      { test: name('TY copy'), kind: 'title', id: 'title', alt: 'Thank you!' },
      { test: name('Did i'), kind: 'title', id: 'subtitle', alt: 'Did I stole your heart?' },
      { test: name('Rectangle 1', 'Lower line'), kind: 'static' }, // the black band and its torn white edge
    ],
  },
]

module.exports = { DESIGN_DIR, PAGE_W, PAGE_H, DOCS, isStar, name, re, inGroup }
