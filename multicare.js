const HF_BASE = 'https://datasets-server.huggingface.co';
const DATASET = 'OpenMed/multicare-case-images';
const CONFIG = 'default';
const SPLIT = 'train';
const DATASET_URL = 'https://huggingface.co/datasets/OpenMed/multicare-case-images';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function imageSrc(image) {
  if (!image) return '';
  if (typeof image === 'string') return image;
  return image.src || image.url || image.path || '';
}

function normalize(rowWrapper) {
  const row = rowWrapper?.row || rowWrapper || {};
  const imageUrl = imageSrc(row.image);
  const articleId = clean(row.article_id || '');
  return {
    id: clean(row.image_id || row.file_id || `${articleId}-${rowWrapper?.row_idx ?? ''}`),
    imageUrl,
    caption: clean(row.caption || 'Imagen de caso clínico'),
    textReferences: clean(row.text_references || ''),
    tag: clean(row.tag || 'caso clínico'),
    caseId: clean(row.case_id || row.patient_id || ''),
    articleId,
    license: clean(row.license || 'Consultar licencia por artículo'),
    articleUrl: articleId ? `https://pmc.ncbi.nlm.nih.gov/articles/${encodeURIComponent(articleId)}/` : DATASET_URL,
    datasetUrl: DATASET_URL,
  };
}

export async function searchMultiCaRe(query, { offset = 0, length = 24 } = {}) {
  const q = clean(query);
  if (!q) throw new Error('Introduce un término de búsqueda.');
  const params = new URLSearchParams({ dataset: DATASET, config: CONFIG, split: SPLIT, query: q, offset: String(Math.max(0, Number(offset) || 0)), length: String(Math.max(1, Math.min(Number(length) || 24, 100))) });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${HF_BASE}/search?${params.toString()}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`La biblioteca respondió con HTTP ${response.status}.`);
    const data = await response.json();
    if (data?.error) throw new Error(data.error);
    const results = (Array.isArray(data?.rows) ? data.rows : []).map(normalize).filter((item) => item.imageUrl);
    return { query: q, results, partial: Boolean(data?.partial), nextOffset: (Number(offset) || 0) + (Array.isArray(data?.rows) ? data.rows.length : 0), total: Number(data?.num_rows_total || 0) };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('La biblioteca tardó demasiado en responder.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function multiCaReDatasetUrl() { return DATASET_URL; }
