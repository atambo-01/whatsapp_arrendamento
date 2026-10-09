// PDF layout for the Jinzo export.
// Called from export.js as buildPDF(listings, photoLimit).
//
// Page structure:
//   Page 1              — index of all listings, with page numbers
//   Page 2..N           — one or more pages per listing
//
// Per listing:
//   First page  — info block (top 30%), photos (bottom 70%, up to 6)
//   Further pages — photos only (up to 10 per page)
//   Last page   — raw text (9pt) under the photos
//
// Every page has a footer: "página N".

const PDF_CFG = {
  pageW: 210,
  pageH: 297,
  marginX: 12,
  marginTop: 14,
  marginBottom: 16,

  infoBlockH: 78,          // top 30% of the usable area, roughly
  infoPad: 4,

  photoGap: 2,
  photosFirstPage: 6,
  photosOtherPage: 10,

  footerFontSize: 8,
  rawTextFontSize: 9,

  fontSizeLocation: 18,
  fontSizePrice: 15,
  fontSizeMeta: 11,
  fontSizeSmall: 9,

  fontFamily: 'helvetica',
};

// --- Public entry ---

function buildPDF(listings, photoLimit) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // Normalise: apply photo limit, decide usable photos.
  const prepared = listings.map(l => prepareListing(l, photoLimit));

  // Phase 1 — pagination plan. Walk listings, assign start/end page numbers.
  // Index is page 1. Listings start on page 2.
  const plan = [];
  let page = 2;
  for (const l of prepared) {
    const pageCount = pagesForListing(l.photoCount);
    plan.push({ listing: l, startPage: page, endPage: page + pageCount - 1, pageCount });
    page += pageCount;
  }

  // Phase 2 — index page.
  renderIndexPage(doc, prepared, plan);

  // Phase 3 — listings.
  for (const entry of plan) {
    renderListing(doc, entry);
  }

  return doc;
}

// --- Preparation ---

function prepareListing(listing, photoLimit) {
  const media = (listing.media || []).slice(0, photoLimit === Infinity ? undefined : photoLimit);
  // Photos that actually resolved to a data URL.
  const photos = media.filter(m => m.dataUrl && m.type !== 'video');
  return Object.assign({}, listing, {
    photos,
    photoCount: photos.length,
  });
}

function pagesForListing(n) {
  if (n <= 0) return 1;
  if (n <= PDF_CFG.photosFirstPage) return 1;
  return 1 + Math.ceil((n - PDF_CFG.photosFirstPage) / PDF_CFG.photosOtherPage);
}

// --- Index page (page 1) ---

function renderIndexPage(doc, listings, plan) {
  const { marginX, marginTop, fontSizeSmall, fontFamily } = PDF_CFG;
  doc.setFont(fontFamily, 'normal');

  let y = marginTop;

  // Header — what filter, how many, when.
  doc.setFontSize(16);
  doc.setFont(fontFamily, 'bold');
  doc.text('Jinzo — Casas para arrendar', marginX, y);
  y += 8;

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(10);
  const stamp = todayStamp();
  doc.text(listings.length + (listings.length === 1 ? ' anúncio' : ' anúncios') + ' · ' + stamp, marginX, y);
  y += 10;

  // Line items.
  doc.setFontSize(fontSizeSmall);
  for (let i = 0; i < plan.length; i++) {
    const entry = plan[i];
    const l = entry.listing;
    const idx = i + 1;

    const location = (l.location || l.location_raw || '—').toString();
    const price = formatPrice(l);
    const typology = (l.typology || '').toString();
    const pageLabel = entry.pageCount === 1
      ? 'página ' + entry.startPage
      : 'páginas ' + entry.startPage + '–' + entry.endPage;

    const left = idx + '. ' + location + (typology ? ' · ' + typology : '');
    const mid = ' · ' + price;
    const right = ' · ' + pageLabel;

    // Compose, truncate location if it's long.
    const maxWidth = PDF_CFG.pageW - 2 * marginX;
    doc.setFont(fontFamily, 'normal');
    let line = left + mid + right;
    while (doc.getTextWidth(line) > maxWidth && location.length > 4) {
      // Trim the location string.
      const parts = left.split(' · ');
      parts[0] = parts[0].slice(0, -2);
      line = parts.join(' · ') + mid + right;
    }
    doc.text(line, marginX, y);
    y += 5;

    if (y > PDF_CFG.pageH - PDF_CFG.marginBottom - 6) {
      // Index overflowed one page — bail. In practice this won't happen for
      // our scale (< 100 results). If it does, we'd need to shift everything.
      doc.addPage();
      y = PDF_CFG.marginTop;
      doc.setFontSize(fontSizeSmall);
    }
  }

  renderFooter(doc, 1);
}

// --- Listing pages ---

function renderListing(doc, entry) {
  const { pageW, pageH, marginX, marginTop, marginBottom } = PDF_CFG;
  const l = entry.listing;

  let pageInListing = 0;
  let photoIdx = 0;

  while (photoIdx < l.photoCount || pageInListing === 0) {
    if (pageInListing > 0) doc.addPage();

    const absolutePage = entry.startPage + pageInListing;
    const isFirst = pageInListing === 0;
    const isLast = photoIdx + (isFirst ? PDF_CFG.photosFirstPage : PDF_CFG.photosOtherPage) >= l.photoCount;

    // Info block — first page only.
    let contentTop = marginTop;
    if (isFirst) {
      contentTop = renderInfoBlock(doc, l);
    }

    // Photos.
    const photosOnThisPage = isFirst ? PDF_CFG.photosFirstPage : PDF_CFG.photosOtherPage;
    const slice = l.photos.slice(photoIdx, photoIdx + photosOnThisPage);
    photoIdx += slice.length;

    const photoTop = contentTop;
    const photoBottom = isLast ? pageH - marginBottom - 24 : pageH - marginBottom;
    renderPhotoGrid(doc, slice, marginX, photoTop, pageW - 2 * marginX, photoBottom - photoTop, isFirst);

    // Raw text — last page only, under the photos.
    if (isLast && l.raw_text && l.raw_text.trim()) {
      renderRawText(doc, l.raw_text, marginX, photoBottom + 2, pageW - 2 * marginX);
    }

    renderFooter(doc, absolutePage);
    pageInListing++;

    if (photoIdx >= l.photoCount && pageInListing > 0) break;
    if (photoIdx >= l.photoCount && l.photoCount === 0) break;
  }
}

function renderInfoBlock(doc, l) {
  const { marginX, marginTop, infoBlockH, fontFamily } = PDF_CFG;
  let y = marginTop + 8;

  // Location — biggest.
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(PDF_CFG.fontSizeLocation);
  const loc = (l.location || l.location_raw || 'Localização não indicada').toString();
  doc.text(loc.slice(0, 60), marginX, y);
  y += 9;

  // Price — large.
  doc.setFontSize(PDF_CFG.fontSizePrice);
  doc.text(formatPrice(l), marginX, y);
  y += 7;

  // Meta line — typology · date.
  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(PDF_CFG.fontSizeMeta);
  const metaParts = [];
  if (l.typology) metaParts.push(l.typology);
  if (l.timestamp) metaParts.push(l.timestamp.slice(0, 10));
  if (l.sender) metaParts.push(l.sender);
  doc.text(metaParts.join(' · '), marginX, y);
  y += 5;

  // Phone — prominent.
  if (l.phone) {
    doc.setFont(fontFamily, 'bold');
    doc.setFontSize(PDF_CFG.fontSizeMeta);
    doc.text('☎ ' + l.phone, marginX, y);
  }

  return marginTop + infoBlockH;
}

function formatPrice(l) {
  if (l.price && l.price_ok === 1) {
    return l.price.toLocaleString('pt-PT').replace(/\u00a0/g, ' ') + ' Kz';
  }
  if (l.price_text && l.price_text.trim()) {
    return l.price_text.trim();
  }
  return 'Preço não indicado';
}

// --- Photo grid ---

function renderPhotoGrid(doc, photos, x, y, w, h, isFirst) {
  if (photos.length === 0) {
    // Placeholder box.
    doc.setDrawColor(200);
    doc.setFillColor(245, 245, 245);
    doc.rect(x, y, w, Math.min(h, 60), 'FD');
    doc.setFont(PDF_CFG.fontFamily, 'normal');
    doc.setFontSize(12);
    doc.setTextColor(140);
    doc.text('Sem fotos', x + w / 2, y + 20, { align: 'center' });
    doc.setTextColor(0);
    return;
  }

  // Grid geometry based on count.
  const cols = photos.length === 1 ? 1
             : photos.length === 2 ? 2
             : photos.length <= 4 ? 2
             : photos.length <= 6 ? 3
             : photos.length <= 8 ? 4
             : photos.length <= 10 ? 5
             : 5;
  const rows = Math.ceil(photos.length / cols);

  const gap = PDF_CFG.photoGap;
  const cellW = (w - gap * (cols - 1)) / cols;
  const cellH = (h - gap * (rows - 1)) / rows;

  for (let i = 0; i < photos.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const px = x + col * (cellW + gap);
    const py = y + row * (cellH + gap);
    try {
      doc.addImage(photos[i].dataUrl, 'JPEG', px, py, cellW, cellH);
    } catch (e) {
      // Skip silently.
    }
  }
}

// --- Raw text ---

function renderRawText(doc, text, x, y, w) {
  const { pageH, marginBottom, rawTextFontSize, fontFamily } = PDF_CFG;
  const maxY = pageH - marginBottom - 6;

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(rawTextFontSize);
  doc.setTextColor(90);

  const lineHeight = rawTextFontSize * 0.4;
  const lines = doc.splitTextToSize(text.trim(), w);

  for (const line of lines) {
    if (y > maxY) break;
    doc.text(line, x, y);
    y += lineHeight;
  }
  doc.setTextColor(0);
}

// --- Footer ---

function renderFooter(doc, pageNumber) {
  const { pageW, pageH, marginX, footerFontSize, fontFamily } = PDF_CFG;
  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(footerFontSize);
  doc.setTextColor(150);
  doc.text('página ' + pageNumber, pageW - marginX, pageH - 6, { align: 'right' });
  doc.setTextColor(0);
}

// --- Utils ---

function todayStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return day + '/' + m + '/' + y;
}