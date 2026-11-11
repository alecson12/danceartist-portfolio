# Dance Artist portfolio

Alecson Gantica's dance portfolio as a real website, rebuilt from the Photoshop
design instead of showing the design as flat pictures.

- **The look is the design.** Backgrounds are the designer's own exported pixels.
  Photos, labels, stickers and title lettering are cut from the PSD layers.
- **The wording is real text.** Body copy, labels, captions, chips and contact
  details are set live in the design's fonts (Source Code Pro, Bebas Neue and
  Alecson's own handwriting font), so they can be selected, searched, read aloud
  and stay sharp at any size.
- **Things work.** The three buttons on the first page, the header menu, every
  contact chip and every photo (opens in a full-screen viewer) are functional.
- **Phones get their own layout.** The same pieces are re-stacked in one
  readable column instead of shrinking a whole page.

Live at https://alecson12.github.io/danceartist-portfolio/

## Changing things

| I want to change… | Do this |
| --- | --- |
| Wording, a photo, a layout, add a page element | Edit the PSD in Photoshop, save, run `npm run extract` |
| Where a link goes, the header menu, page names for screen readers | Edit `src/content/site.js` |
| Turn all movement off | `motion: false` in `src/content/site.js` |
| Which PSD is which page, or how a layer is treated | `scripts/psd/config.cjs` |

### After editing a PSD

```bash
npm run extract
```

That reads the PSDs in `E:\_DESIGN FILES\Dance Portfolio` (read-only: nothing in
that folder is ever written) and regenerates `public/art/` and
`src/content/generated/`. One document only: `npm run extract -- about`
(`intro`, `about`, `highlights`, `works` or `thanks`). It takes about five
minutes for everything.

Two things to know when saving in Photoshop:

- Keep **Maximize Compatibility** on (the default). The build takes the page
  backgrounds from the flattened copy that option stores inside the PSD.
- Text set in Source Code Pro, Bebas or the Handwritten font becomes live text.
  Text in any other font (the big title lettering, sticker words) stays artwork,
  exactly as drawn.

If the design folder moves, set `DANCE_DESIGN_DIR` to its new path.

## Running it

```bash
npm install
```

```bash
npm run dev
```

Then open the address Vite prints. `npm run build` writes the deployable site to
`dist/`.

## Deploying

Pushing to `main` on GitHub runs `.github/workflows/deploy.yml`, which builds the
site and publishes it to GitHub Pages. The repository is
`alecson12/danceartist-portfolio`; if it is ever renamed, change `base` in
`vite.config.js` to match.

## How it works

```
E:\_DESIGN FILES\Dance Portfolio\*.psd
        │  npm run extract   (scripts/psd/)
        ▼
public/art/<page>/plate-*.webp        page background
public/art/<page>/photo|label|title|deco|sprite-*.webp   separate pieces
public/art/<page>/full-*.webp         photos for the viewer
src/content/generated/*.json          where every piece and line of text goes
        │
        ▼
src/components/Stage.jsx   a page at 3275 × 1842, scaled as a whole (desktop, tablet)
src/components/Flow.jsx    the same pieces in one column (phones)
```

**Extraction** (`scripts/psd/`)

- `compositor.cjs` is a small Photoshop-compatible renderer: blend modes, masks,
  clipping, groups, and the layer effects this design uses. It can render any
  subset of a document's layers.
- `units.cjs` decides what each layer becomes: live text, a photo, a label with
  text on it, title art, or background. Decoration that sits on top of a photo
  (tape, a star, a sticker) travels with that photo.
- `page.cjs` builds each page. The background plate is the designer's own
  flattened export with the separate pieces removed and the layers beneath them
  rendered in. Solid areas of every piece are copied from that same export, so
  photos and labels are pixel-identical to the design.
- `text.cjs` turns a text layer into font, size, colour, spacing and position.
  Paragraphs are broken into lines the way Photoshop breaks them, and each block
  is anchored to the actual pixels of its layer.
- `photo.cjs` cuts the viewer picture: the same crop as the frame shows, upright,
  from the original image stored inside the PSD where there is one.

Each run prints, per page, how closely the pieces reassemble into the original
(`seam` is the mismatch where a removed piece met the background; under 1 on a
scale of 255 is invisible).

**The site** (`src/`)

- A page is a 3275 × 1842 stage. Everything inside is positioned in design pixels
  and the stage is scaled to the window, so the composition never reflows.
- Live text is pinned by its baseline and carries the layer's own transform
  (`components/LiveText.jsx`); `lib/fonts.js` measures where each font's baseline
  falls in the visitor's browser.
- Below 960 px wide the phone layout takes over (`components/Flow.jsx`): photo
  groups become patches of the design scaled to the column, labels and chips are
  the design's own, scaled so their text is comfortable to read.
- Movement is subtle and optional: pieces arrive as a page scrolls in, photos and
  buttons lift on hover. It is skipped entirely for visitors who ask their device
  for reduced motion.

## Fonts

- Source Code Pro and Bebas Neue: SIL Open Font License, served from the
  `@fontsource` packages.
- `src/assets/fonts/Handwritten.ttf`: Alecson's handwriting font.
- The title lettering fonts (Aliens Among Us, the Persona-style cut-out font,
  Designer, Bubblegum Superstar) are not shipped; that lettering is artwork.
