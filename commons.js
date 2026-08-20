const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

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

export async function searchCommonsImages(query, { limit = 24, continuation = null } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Introduce un término de búsqueda.');

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    generator: 'search',
    gsrsearch: q,
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 16000);
  try {
    const response = await fetch(`${COMMONS_API}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Wikimedia Commons respondió con HTTP ${response.status}.`);
    const data = await response.json();
    if (data?.error) throw new Error(data.error.info || 'Error de Wikimedia Commons.');
    const pages = Array.isArray(data?.query?.pages) ? data.query.pages : [];
    const results = pages.map(normalizePage).filter(Boolean);
    return {
      query: q,
      results,
      continuation: data?.continue && typeof data.continue === 'object' ? data.continue : null,
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Wikimedia Commons tardó demasiado en responder.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function commonsSearchUrl(query) {
  const q = String(query || 'medical imaging').trim();
  return `https://commons.wikimedia.org/w/index.php?search=${encodeURIComponent(q)}&title=Special:MediaSearch&type=image`;
}
