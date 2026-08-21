const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const memoryCache = new Map();

function cleanText(value) {
  if (value == null) return '';
  const node = document.createElement('div');
  node.innerHTML = String(value);
  return (node.textContent || '').replace(/\s+/g, ' ').trim();
}

function metaValue(metadata, key) {
  return cleanText(metadata?.[key]?.value || '');
}

function normalizePage(page) {
  const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
  if (!info) return null;
  const mime = String(info.mime || '');
  if (!mime.startsWith('image/')) return null;
  const metadata = info.extmetadata || {};
  const title = String(page.title || '').replace(/^File:/i, '');
  const imageUrl = info.thumburl || info.url || '';
  const originalUrl = info.url || imageUrl;
  const sourcePage = info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || '')}`;
  const author = metaValue(metadata, 'Artist') || metaValue(metadata, 'Credit') || 'Wikimedia Commons contributor';
  const license = metaValue(metadata, 'LicenseShortName') || metaValue(metadata, 'UsageTerms') || 'Ver licencia en la fuente';
  const licenseUrl = cleanText(metadata?.LicenseUrl?.value || '');
  const description = metaValue(metadata, 'ImageDescription') || metaValue(metadata, 'ObjectName') || title;
  return {
    pageId: page.pageid,
    title,
    imageUrl,
    originalUrl,
    sourcePage,
    author,
    license,
    licenseUrl,
    description,
    mime,
    width: info.width || null,
    height: info.height || null,
  };
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function normalizedWords(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function queryVariants(query) {
  const original = String(query || '').replace(/\s+/g, ' ').trim();
  const words = normalizedWords(original);
  const noise = new Set([
    'ct','cta','mri','mr','xray','xr','radiograph','radiography','ultrasound','us','scan','image','imaging',
    'axial','coronal','sagittal','contrast','enhanced','angiography','neck','chest','abdomen','pelvis','brain',
    'pericholecystic','fluid','finding','findings','sign','signs','appearance','view'
  ]);
  const clinical = words.filter((word) => !noise.has(word));
  const variants = [original];
  if (clinical.length >= 2) variants.push(clinical.join(' '));
  if (clinical.length >= 3) variants.push(clinical.slice(0, 3).join(' '));
  if (clinical.length >= 2) variants.push(clinical.slice(0, 2).join(' '));
  const noModality = words.filter((word) => !['ct','cta','mri','mr','xray','xr','radiograph','radiography','ultrasound','us','scan','imaging'].includes(word));
  if (noModality.length >= 2) variants.push(noModality.join(' '));
  return [...new Set(variants.map((x) => x.trim()).filter((x) => x.length >= 3))].slice(0, 5);
}

function scoreImage(item, query) {
  const hay = normalizedWords(`${item.title} ${item.description}`).join(' ');
  const qWords = normalizedWords(query).filter((word) => word.length > 2);
  let score = qWords.reduce((sum, word) => sum + (hay.includes(word) ? 3 : 0), 0);
  const useful = ['ct','computed tomography','mri','magnetic resonance','x ray','radiograph','ultrasound','sonograph','angiograph'];
  useful.forEach((term) => { if (hay.includes(term)) score += 1; });
  const poor = ['logo','icon','map','diagram','scheme','drawing','histology','microscopy','pathology slide','specimen'];
  poor.forEach((term) => { if (hay.includes(term)) score -= 4; });
  if ((item.width || 0) >= 512 && (item.height || 0) >= 512) score += 1;
  return score;
}

async function fetchCommons(query, { limit = 24, continuation = null } = {}) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: String(Math.max(1, Math.min(Number(limit) || 24, 50))),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime|size',
    iiurlwidth: '1100',
  });
  if (continuation && typeof continuation === 'object') {
    Object.entries(continuation).forEach(([key, value]) => {
      if (value != null) params.set(key, String(value));
    });
  }

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${COMMONS_API}?${params.toString()}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data?.error) throw new Error(data.error.info || 'Error de Wikimedia Commons.');
      const pages = Array.isArray(data?.query?.pages) ? data.query.pages : [];
      return {
        query,
        results: pages.map(normalizePage).filter(Boolean),
        continuation: data?.continue && typeof data.continue === 'object' ? data.continue : null,
      };
    } catch (error) {
      lastError = error;
      if (attempt === 0) await sleep(450);
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastError?.name === 'AbortError') throw new Error('La fuente de imágenes tardó demasiado en responder.');
  throw new Error('No se pudo consultar la fuente de imágenes en este momento.');
}

export async function searchCommonsImages(query, { limit = 24, continuation = null } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Introduce un término de búsqueda.');

  // Pagination must stay on the exact same query used by Wikimedia.
  if (continuation) return fetchCommons(q, { limit, continuation });

  const cacheKey = `${q}::${limit}`;
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey);

  const promise = (async () => {
    let lastError = null;
    for (const variant of queryVariants(q)) {
      try {
        const result = await fetchCommons(variant, { limit });
        if (result.results.length) {
          result.results.sort((a, b) => scoreImage(b, q) - scoreImage(a, q));
          return { ...result, query: q, resolvedQuery: variant };
        }
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return { query: q, resolvedQuery: q, results: [], continuation: null };
  })();

  memoryCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    memoryCache.delete(cacheKey);
    throw error;
  }
}

export function commonsSearchUrl(query) {
  const q = String(query || 'medical imaging').trim();
  return `https://commons.wikimedia.org/w/index.php?search=${encodeURIComponent(q)}&title=Special:MediaSearch&type=image`;
}
