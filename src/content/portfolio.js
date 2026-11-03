// =====================================================================
//  DANCE PORTFOLIO — everything editable lives in this file.
//
//  THE IMAGES are NOT listed here. Drop them into  public/pages/  and
//  they appear automatically, in filename order. Name them in the order
//  you want them shown:  01.jpg, 02.jpg, 03.jpg ... (any size, any of
//  jpg / png / webp / gif / avif / svg). To reorder, rename. To remove,
//  delete the file. See public/pages/README.md.
// =====================================================================

export const PORTFOLIO = {
  // Browser tab title.
  title: 'Alecson Gantica — Dance Artist',

  // Page background behind and around the images. Any CSS colour.
  background: '#000000',

  // Widest the image stack gets on big screens (px). Below that the images
  // fill the viewport width; above it they are centred.
  maxWidth: 1400,

  // Tiny footer link back to the main site. Set `footer` to null to hide it.
  footer: {
    label: 'almarga.github.io',
    href: 'https://almarga.github.io/',
  },

  // Screen-reader text per image. Optional: any image not listed here gets
  // "<title>, page N". Keys are the filenames in public/pages/.
  alt: {
    // '01.jpg': 'Cover — Alecson Gantica, dance artist',
    // '02.jpg': 'About',
  },
}
