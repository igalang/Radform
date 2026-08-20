const OPENI_BASE = 'https://openi.nlm.nih.gov';
const OPENI_API = `${OPENI_BASE}/api/search`;

const TYPE_CODES = { XR: 'x', CT: 'c', MRI: 'm', US: 'u', MAMMO: 'xm', ANGIO: 'xg', PET: 'p' };

function clean(value) {
  if (value == null) return '';
  const text = String(value).replace(/<[^>]+>/g, ' ');
  return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

function absUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${OPENI_BASE}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

function first(...values) {
  return values.find((value) => value != null && String(value).trim()) || '';
}

function normalizeItem(item) {
  const image = item?.image && typeof item.image === 'object' ? item.image : {};
  const title = clean(first(item?.title, item?.docTitle, image?.caption, 'Imagen Open-i'));
  const imageUrl = absUrl(first(item?.imgLarge, item?.imgGrid150, item?.imgThumb, image?.imgLarge));
  const thumbUrl = absUrl(first(item?.imgGrid150, item?.imgThumb, item?.imgLarge));
  const description = clean(first(image?.caption, item?.abstract, image?.mention, title));
  let articleUrl = absUrl(first(item?.fulltext_html_url, item?.detailedQueryURL, item?.pmc_url));
  if (!articleUrl && item?.pmcid) articleUrl = `https://pmc.ncbi.nlm.nih.gov/articles/${encodeURIComponent(item.pmcid)}/`;
  return {
    id: String(first(item?.uid, item?.pmcid, item?.id, `${title}-${imageUrl}`)),
    title,
    imageUrl,
    thumbUrl: thumbUrl || imageUrl,
    description,
    articleUrl: articleUrl || OPENI_BASE,
    sourcePage: articleUrl || OPENI_BASE,
    author: 'U.S. National Library of Medicine / source article',
    license: clean(first(item?.license, item?.lic, 'Consultar licencia del artículo fuente')),
    licenseUrl: articleUrl || OPENI_BASE,
    source: 'Open-i (NLM)',
  };
}

export async function searchOpenI(query, { modality = 'all', collection = 'all', start = 1, count = 24 } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Introduce un término de búsqueda.');
  const n = Math.max(1, Math.min(Number(count) || 24, 50));
  const m = Math.max(1, Number(start) || 1);
  const params = new URLSearchParams({ query: q, m: String(m), n: String(m + n - 1) });
  const code = TYPE_CODES[modality];
  if (code) params.set('it', code);
  if (collection && collection !== 'all') params.set('coll', collection);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(`${OPENI_API}?${params.toString()}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Open-i respondió con HTTP ${response.status}.`);
    const data = await response.json();
    const raw = Array.isArray(data?.list) ? data.list : [];
    const results = raw.map(normalizeItem).filter((item) => item.imageUrl);
    return { query: q, results, total: Number(data?.total || data?.count || results.length), nextStart: results.length ? m + results.length : null };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Open-i tardó demasiado en responder.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function openISearchUrl(query, modality = 'all', collection = 'all') {
  const params = new URLSearchParams({ query: String(query || 'radiology') });
  const code = TYPE_CODES[modality];
  if (code) params.set('it', code);
  if (collection && collection !== 'all') params.set('coll', collection);
  return `${OPENI_BASE}/gridquery?${params.toString()}`;
}
