import { searchCommonsImages } from './commons.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const cache = {
  cases: new Map(),
  atlas: [],
  vqaCount: 0,
  mirCount: 0,
};

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function loadJson(path) {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function loadCaches() {
  const [caseData, atlasData, vqaData, mirData] = await Promise.all([
    loadJson('./data/case-image-cache.json'),
    loadJson('./data/atlas-image-cache.json'),
    loadJson('./data/vqa-rad-snapshot.json'),
    loadJson('./data/mir-open-snapshot.json'),
  ]);
  const caseRows = Array.isArray(caseData?.results) ? caseData.results : [];
  caseRows.forEach((row) => cache.cases.set(String(row.id), row));
  cache.atlas = Array.isArray(atlasData?.results) ? atlasData.results : [];
  cache.vqaCount = Array.isArray(vqaData?.results) ? vqaData.results.length : 0;
  cache.mirCount = Array.isArray(mirData?.results) ? mirData.results.length : 0;
}

function currentCaseId() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash.startsWith('case=')) return '';
  try { return decodeURIComponent(hash.slice(5)); } catch { return hash.slice(5); }
}

function attributionHTML(meta) {
  const license = meta.licenseUrl
    ? `<a href="${esc(meta.licenseUrl)}" target="_blank" rel="noreferrer">${esc(meta.license || 'licencia')}</a>`
    : esc(meta.license || 'licencia abierta');
  const source = meta.sourcePage
    ? `<a href="${esc(meta.sourcePage)}" target="_blank" rel="noreferrer">fuente</a>`
    : 'fuente abierta';
  return `Imagen: ${esc(meta.author || 'fuente abierta')} · ${license} · ${source}`;
}


function positionHotspotLocal(stage, img) {
  const hotspot = $('.hotspot', stage);
  if (!hotspot || !img?.naturalWidth || !img?.naturalHeight) return;
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const ratio = Math.min(sw / img.naturalWidth, sh / img.naturalHeight);
  const iw = img.naturalWidth * ratio;
  const ih = img.naturalHeight * ratio;
  hotspot.style.left = `${(sw - iw) / 2 + (Number(hotspot.dataset.x) / 100) * iw}px`;
  hotspot.style.top = `${(sh - ih) / 2 + (Number(hotspot.dataset.y) / 100) * ih}px`;
}

function applyCachedCaseImage() {
  const dialog = $('#caseDialog');
  const body = $('#caseDialogBody');
  if (!dialog?.open || !body) return;
  const id = currentCaseId();
  const meta = cache.cases.get(id);
  if (!meta?.imageUrl) return;
  const stage = $('.image-stage', body);
  const img = $('[data-case-main-img]', body);
  const caption = $('[data-case-caption]', body);
  if (!stage || !img || !caption) return;

  const currentSrc = img.getAttribute('src') || '';
  const failedCaption = /no se encontr|no se pudo cargar|tard[oó] demasiado/i.test(caption.textContent || '');
  if (!img.hidden && currentSrc.includes(meta.imageUrl) && !failedCaption) return;

  img.src = meta.imageUrl;
  img.hidden = false;
  img.alt = meta.description || meta.clinicalLabel || img.alt || 'Imagen radiológica';
  img.addEventListener('load', () => positionHotspotLocal(stage, img), { once: true });
  if (img.complete) positionHotspotLocal(stage, img);
  $('.case-image-placeholder', stage)?.remove();
  caption.innerHTML = attributionHTML(meta);
}

function queryFromCommonsLink(caption) {
  const link = $('a[href*="commons.wikimedia.org"]', caption);
  if (!link) return '';
  try { return new URL(link.href).searchParams.get('search') || ''; } catch { return ''; }
}

function clinicalQueryFromDialog(body) {
  const title = $('h2, h3', body)?.textContent || '';
  const vignette = $('.vignette', body)?.textContent || '';
  return `${title} ${vignette}`.trim().slice(0, 180);
}

async function retryCaseImage(button) {
  const body = $('#caseDialogBody');
  if (!body) return;
  const caption = $('[data-case-caption]', body);
  const stage = $('.image-stage', body);
  const img = $('[data-case-main-img]', body);
  if (!caption || !stage || !img) return;
  const query = button.dataset.query || queryFromCommonsLink(caption) || clinicalQueryFromDialog(body);
  button.disabled = true;
  button.textContent = 'Buscando…';
  try {
    const result = await searchCommonsImages(query, { limit: 24 });
    const meta = result.results?.[0];
    if (!meta) throw new Error('No encontramos otra imagen adecuada.');
    img.src = meta.imageUrl;
    img.hidden = false;
    img.addEventListener('load', () => positionHotspotLocal(stage, img), { once: true });
    if (img.complete) positionHotspotLocal(stage, img);
    $('.case-image-placeholder', stage)?.remove();
    caption.innerHTML = attributionHTML(meta);
  } catch {
    caption.innerHTML = '<span class="image-friendly-error">La imagen no está disponible ahora. Puedes continuar resolviendo el caso y volver a intentarlo después.</span>';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'image-retry-btn';
    retry.textContent = '↻ Reintentar imagen';
    retry.dataset.query = query;
    retry.addEventListener('click', () => retryCaseImage(retry));
    caption.append(' ', retry);
  }
}

function improveCaseImageError() {
  const body = $('#caseDialogBody');
  if (!body) return;
  const caption = $('[data-case-caption]', body);
  if (!caption) return;
  const text = caption.textContent || '';
  if (!/no se encontr|no se pudo cargar|tard[oó] demasiado/i.test(text)) return;

  const cached = cache.cases.get(currentCaseId());
  if (cached?.imageUrl) {
    applyCachedCaseImage();
    return;
  }

  if ($('.image-retry-btn', caption)) return;
  const query = queryFromCommonsLink(caption) || clinicalQueryFromDialog(body);
  caption.innerHTML = '<span class="image-friendly-error">La imagen no ha cargado.</span> ';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'image-retry-btn';
  button.textContent = '↻ Reintentar imagen';
  button.dataset.query = query;
  button.addEventListener('click', () => retryCaseImage(button));
  caption.append(button);
}

function hydrateCaseCards() {
  // Case bank cards.
  $$('.case-card').forEach((card) => {
    const open = $('[data-open-case]', card);
    const id = open?.dataset.openCase;
    const meta = cache.cases.get(String(id || ''));
    const thumb = $('.case-thumb', card);
    if (!meta?.imageUrl || !thumb || $('img', thumb)) return;
    $('.case-image-placeholder', thumb)?.remove();
    const img = document.createElement('img');
    img.src = meta.imageUrl;
    img.alt = meta.description || meta.clinicalLabel || 'Imagen radiológica';
    img.loading = 'lazy';
    thumb.prepend(img);
  });

  // Library cards based on Radform cases.
  $$('[data-library-open-case]').forEach((button) => {
    const meta = cache.cases.get(String(button.dataset.libraryOpenCase || ''));
    if (!meta?.imageUrl || $('img', button)) return;
    $('.case-image-placeholder', button)?.remove();
    const img = document.createElement('img');
    img.src = meta.imageUrl;
    img.alt = meta.description || meta.clinicalLabel || 'Imagen radiológica';
    img.loading = 'lazy';
    button.prepend(img);
  });
}

function clinicalAtlasLabel() {
  const raw = $('#atlasQuery')?.value?.trim() || '';
  if (raw) return raw;
  return 'Imagen radiológica';
}

function rewriteAtlasTitles() {
  const label = clinicalAtlasLabel();
  $$('#atlasGrid .atlas-card h3').forEach((heading) => {
    if (!heading.dataset.originalTitle) heading.dataset.originalTitle = heading.textContent.trim();
    heading.title = heading.dataset.originalTitle;
    if (heading.textContent.trim() !== label) heading.textContent = label;
  });
}

function findAtlasCache() {
  const q = normalize($('#atlasQuery')?.value || '');
  if (!q) return [];
  return cache.atlas.filter((item) => {
    const label = normalize(item.label || item.clinicalLabel || '');
    const query = normalize(item.query || '');
    return label === q || label.includes(q) || q.includes(label) || query.includes(q) || q.includes(query);
  }).slice(0, 6);
}

function renderAtlasFallback() {
  const status = $('#atlasStatus');
  const grid = $('#atlasGrid');
  if (!status || !grid) return;
  const statusText = status.textContent || '';
  const looksBroken = /no se pudo|no respondi[oó]|no se encontraron|tard[oó] demasiado/i.test(statusText);
  if (!looksBroken || $('img', grid)) return;
  const items = findAtlasCache();
  if (!items.length) {
    status.innerHTML = '<div class="status-box">No encontramos imágenes para este tema ahora. Prueba otro tema o vuelve a intentarlo más tarde.</div>';
    return;
  }
  const label = esc(clinicalAtlasLabel());
  grid.innerHTML = items.map((item) => `
    <article class="atlas-card atlas-local-card">
      <div class="atlas-image-link atlas-image-static"><img src="${esc(item.imageUrl)}" alt="${esc(item.description || item.label || 'Imagen radiológica')}" loading="lazy"></div>
      <div class="atlas-card-body">
        <div class="meta-tags"><span class="tiny-badge">Atlas Radform</span></div>
        <h3>${label}</h3>
        <p>${esc(item.description || 'Imagen radiológica de referencia.')}</p>
        <div class="atlas-license"><span>${esc(item.author || 'Wikimedia Commons')}</span><span>${esc(item.license || 'Licencia abierta')}</span></div>
      </div>
    </article>`).join('');
  status.innerHTML = `<div class="status-box"><strong>${items.length}</strong> imágenes guardadas en Radform para este tema.</div>`;
}

function simplifyExternalCards() {
  $$('.external-library-card').forEach((card) => {
    const badge = $('.tiny-badge', card)?.textContent || '';
    if (!/VQA-RAD/i.test(badge)) return;
    const link = $('.library-image-link', card);
    if (link) {
      link.removeAttribute('href');
      link.removeAttribute('target');
      link.removeAttribute('rel');
      $('span', link)?.remove();
    }
    $$('.atlas-license a', card).forEach((a) => a.remove());
  });
}

function replaceTextNode(root, from, to) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    if (node.nodeValue?.includes(from)) node.nodeValue = node.nodeValue.replaceAll(from, to);
  });
}

function cleanTechnicalCopy() {
  const replacements = [
    ['Explora sin depender de una sola API', 'Explora una biblioteca de imagen radiológica'],
    ['sin introducir ninguna clave', 'de forma sencilla'],
    ['Ninguna requiere API key.', ''],
    [' · sin API key.', ''],
    ['sin API key', ''],
    ['API key', 'configuración técnica'],
    ['La copia preparada durante el despliegue', 'La colección guardada en Radform'],
    ['La búsqueda en vivo no respondió ahora.', ''],
    ['Esta fuente no pudo prepararse durante el último despliegue.', 'Esta colección todavía no está disponible en Radform.'],
  ];
  replacements.forEach(([from, to]) => replaceTextNode(document.body, from, to));

  // These links are useful for maintainers, but poor UX for learners.
  $('.external-collections')?.setAttribute('hidden', '');

  // Hide source choices that depend on live services; Radform keeps its own fallback cache.
  const source = $('#atlasSource');
  source?.closest('label')?.setAttribute('hidden', '');

  // Remove implementation-oriented hotspot messages.
  $$('.hint-unavailable').forEach((el) => el.remove());
  $$('.bookmark-row small').forEach((el) => {
    if (/hotspot|pista queda registrada/i.test(el.textContent || '')) el.remove();
  });

  // Hide unavailable optional sources instead of showing a broken feature.
  const vqaTab = $('[data-library-source="vqarad"]');
  if (vqaTab) vqaTab.hidden = cache.vqaCount === 0;
  const realMirTab = $('[data-mir-source="real"]');
  if (realMirTab) realMirTab.hidden = cache.mirCount === 0;
}

function platformInstallText() {
  const ua = navigator.userAgent || '';
  const isiOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  if (isiOS) return '<strong>Instalar Radform</strong><span>Pulsa <b>Compartir</b> y después <b>Añadir a pantalla de inicio</b>.</span>';
  if (isAndroid) return '<strong>Instalar Radform</strong><span>Abre el menú del navegador y elige <b>Instalar aplicación</b>.</span>';
  return '<strong>Instalar Radform</strong><span>Añádela a tu dispositivo para abrirla como una app.</span>';
}

function addInstallCard() {
  const nav = $('#mobileNav .drawer-nav');
  const existingButton = $('#drawerInstallBtn');
  if (!nav || $('#radformInstallCard')) return;
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
  if (standalone) {
    if (existingButton) existingButton.hidden = true;
    return;
  }
  if (existingButton) existingButton.hidden = true;
  const card = document.createElement('button');
  card.id = 'radformInstallCard';
  card.type = 'button';
  card.className = 'radform-install-card';
  card.innerHTML = `<span class="install-card-icon">⇩</span><span class="install-card-copy">${platformInstallText()}</span>`;
  card.addEventListener('click', () => existingButton?.click());
  const account = $('#drawerAccountBtn');
  nav.insertBefore(card, account || null);
}

let bodyLocked = false;
let lockedScrollY = 0;
function syncDialogLock() {
  const anyOpen = $$('dialog[open]').length > 0;
  if (anyOpen && !bodyLocked) {
    lockedScrollY = window.scrollY || 0;
    document.documentElement.classList.add('radform-modal-open');
    document.body.classList.add('radform-modal-lock');
    document.body.style.top = `-${lockedScrollY}px`;
    bodyLocked = true;
  } else if (!anyOpen && bodyLocked) {
    document.documentElement.classList.remove('radform-modal-open');
    document.body.classList.remove('radform-modal-lock');
    document.body.style.top = '';
    window.scrollTo(0, lockedScrollY);
    bodyLocked = false;
  }
}

function observeDialogs() {
  const observer = new MutationObserver(syncDialogLock);
  $$('dialog').forEach((dialog) => {
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    dialog.addEventListener('close', syncDialogLock);
    dialog.addEventListener('cancel', syncDialogLock);
  });
}

function repairUI() {
  cleanTechnicalCopy();
  addInstallCard();
  hydrateCaseCards();
  applyCachedCaseImage();
  improveCaseImageError();
  rewriteAtlasTitles();
  renderAtlasFallback();
  simplifyExternalCards();
}

async function initPatch() {
  await loadCaches();
  repairUI();
  observeDialogs();
  let repairScheduled = false;
  const observer = new MutationObserver(() => {
    if (repairScheduled) return;
    repairScheduled = true;
    window.requestAnimationFrame(() => {
      repairScheduled = false;
      repairUI();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('hashchange', () => window.setTimeout(repairUI, 30));
}

initPatch();
