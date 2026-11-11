// =====================================================================
//  DANCE PORTFOLIO — the settings you may want to change by hand.
//
//  Where everything else comes from:
//  - The pages, pictures and all the wording come straight from the
//    Photoshop files. Change them in Photoshop, save, then run
//        npm run extract
//    and the site rebuilds its pieces (see README.md).
//  - This file holds what Photoshop cannot know: where links go, what
//    the menu says, and descriptions for screen readers.
// =====================================================================

export const SITE = {
  // Browser tab title and search-engine description.
  title: 'Alecson Gantica — Dance Artist',
  description:
    'Dance portfolio of Alecson Gantica (Jr Tsubaki): choreographer and dance artist from Bulacan, Philippines. Competition highlights, TV appearances, coaching, judging and passion projects.',

  // Colour around the pages when the window is not the same shape as a page.
  background: '#000000',

  // Header menu. `page` is the id of the page a link scrolls to
  // (ids are listed in scripts/psd/config.cjs). `short` is the phone label.
  header: {
    name: 'Alecson Gantica',
    subtitle: 'Dance Artist',
    links: [
      { label: 'Start', page: 'intro' },
      { label: 'About Me', short: 'About', page: 'about' },
      {
        label: 'Highlights',
        page: 'highlights',
        children: [
          { label: 'Competitions (Group)', page: 'highlights-group-1' },
          { label: 'Competitions (Solo)', page: 'highlights-solo-1' },
        ],
      },
      {
        label: 'Works & Projects',
        short: 'Works',
        page: 'works',
        children: [
          { label: 'TV Appearances', page: 'works-tv-1' },
          { label: 'Coaching Experience', page: 'works-coaching' },
          { label: 'Competition Judging', page: 'works-judging' },
          { label: 'Corporate Guesting', page: 'works-corporate-1' },
          { label: 'Passion Projects', page: 'works-passion-1' },
        ],
      },
    ],
  },

  // What happens when a piece of text (or the button it sits on) is clicked.
  // `text` must match the wording in the design; capitals do not matter.
  //   href = open an address        page = scroll to a page of this site
  //   on   = only on that page (leave out to apply wherever the wording appears)
  links: [
    { text: 'About me', page: 'about', on: 'intro' },
    { text: 'Highlights', page: 'highlights', on: 'intro' },
    { text: 'Works/projects', page: 'works', on: 'intro' },

    { text: 'alecsongantica12@gmail.com', href: 'mailto:alecsongantica12@gmail.com', label: 'Email Alecson' },
    { text: '(+63)915-234-2303', href: 'tel:+639152342303', label: 'Call Alecson' },
    { text: '@alecson.12', href: 'https://www.facebook.com/alecson.12', label: 'Alecson on Facebook' },
    { text: '@mr.gantica', href: 'https://www.tiktok.com/@mr.gantica', label: 'Alecson on TikTok' },
    { text: '@alec.jrtsubaki', href: 'https://www.instagram.com/alec.jrtsubaki', label: 'Alecson on Instagram' },
    { text: 'behance.net/KozmikKreations', href: 'https://www.behance.net/KozmikKreations', label: 'Kozmik Kreations on Behance' },

    // "Beside dance I do": the two that have a portfolio of their own
    { text: 'Graphic Design', href: 'https://alecson12.github.io/kozmikkreations-portfolio/', label: 'Graphic design portfolio: Kozmik Kreations' },
    { text: 'Check out my works @KozmikKreations', href: 'https://alecson12.github.io/kozmikkreations-portfolio/', label: 'Graphic design portfolio: Kozmik Kreations' },
    { text: 'Game Developing', href: 'https://alecson12.github.io/unitydeveloper-portfolio/', label: 'Game development portfolio' },
  ],

  // Name of each page for screen readers and the browser's outline.
  // Pages not listed here take the name of their section.
  pages: {
    intro: 'Dance Portfolio',
    about: 'About me',
    highlights: 'Highlights',
    'highlights-group-1': 'Competitions: group, Nitrous Image',
    'highlights-group-2': 'Competitions: group, World of Dance 2018',
    'highlights-group-3': 'Competitions: group, World of Dance Philippines and Throwdown',
    'highlights-group-4': 'Competitions: group, 2019 to 2023',
    'highlights-solo-1': 'Competitions: solo',
    'highlights-solo-2': 'Competitions: solo, continued',
    works: 'Works and projects',
    'works-tv-1': 'TV appearances: Unang Hirit',
    'works-tv-2': 'TV appearances: Eat Bulaga',
    'works-coaching': 'Coaching experience',
    'works-judging': 'Competition judging',
    'works-corporate-1': 'Corporate guestings: Nestle Philippines',
    'works-corporate-2': 'Corporate guestings: FWD Life',
    'works-corporate-3': 'Corporate guestings: SM Supermalls',
    'works-passion-1': 'Passion projects: FLOPM',
    'works-passion-2': 'Passion projects: Nitrous Image Crew',
    'works-passion-3': 'Passion projects: more',
    thanks: 'Thank you and contact',
  },

  // Small link back to the main site, under the last page. null hides it.
  footer: { label: 'alecson12.github.io', href: 'https://alecson12.github.io/' },

  // Motion. `false` switches every entrance and hover movement off.
  // (Visitors who ask their device for reduced motion never see it anyway.)
  motion: true,
}
