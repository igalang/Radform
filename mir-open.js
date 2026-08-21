const HF_BASE = 'https://datasets-server.huggingface.co';
const DATASET = 'HiTZ/casimedicos-exp';
const CONFIG = 'es';
const DATASET_URL = 'https://huggingface.co/datasets/HiTZ/casimedicos-exp';
const SPLITS = ['train', 'validation', 'test'];
let localSnapshotPromise = null;

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function normalizeText(value) {
  return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeOptions(raw) {
  if (Array.isArray(raw)) return raw.map(clean).filter(Boolean);
  if (raw && typeof raw === 'object') {
    return Object.entries(raw)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, value]) => clean(value))
      .filter(Boolean);
  }
  return [];
}

function correctIndex(rawCorrect, rawOptions) {
  if (rawCorrect == null) return null;
  const text = clean(rawCorrect);
  const n = Number(text);
  if (Number.isFinite(n)) {
    if (n >= 1 && n <= rawOptions.length) return n - 1;
    if (n >= 0 && n < rawOptions.length) return n;
  }
  const letter = text.toUpperCase().charCodeAt(0) - 65;
  return letter >= 0 && letter < rawOptions.length ? letter : null;
}

export function normalizeCasiMedicosRow(wrapper) {
  const row = wrapper?.row || wrapper || {};
  const options = normalizeOptions(row.options);
  return {
    id: clean(row.id || `casimedicos-${row.year || ''}-${row.question_id_specific || wrapper?.row_idx || ''}`),
    year: clean(row.year),
    questionId: clean(row.question_id_specific),
    question: clean(row.full_question || row.question),
    explanation: clean(row.full_answer || row.full_answer_text || ''),
    specialty: clean(row.type || 'MIR'),
    options,
    correctIndex: correctIndex(row.correct_option ?? row['correct option'], options),
    source: 'CasiMedicos / HiTZ',
    license: 'CC BY 4.0',
    sourceUrl: DATASET_URL,
  };
}

async function getLocalSnapshot() {
  if (!localSnapshotPromise) {
    localSnapshotPromise = fetch('./data/mir-open-snapshot.json', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data?.results) ? data.results : [];
      })
      .catch(() => []);
  }
  return localSnapshotPromise;
}

function searchLocal(items, query, limit) {
  const terms = normalizeText(query).split(/\s+/).filter((x) => x.length > 2);
  if (!terms.length) return items.slice(0, limit);
  const scored = items.map((item) => {
    const hay = normalizeText(`${item.question} ${item.explanation} ${item.specialty}`);
    const score = terms.reduce((n, term) => n + (hay.includes(term) ? 1 : 0), 0);
    return { item, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.item);
}

async function searchSplit(query, split, length) {
  const params = new URLSearchParams({ dataset: DATASET, config: CONFIG, split, query, offset: '0', length: String(Math.max(1, Math.min(length, 100))) });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${HF_BASE}/search?${params.toString()}`, { signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data?.error) throw new Error(data.error);
    return (Array.isArray(data?.rows) ? data.rows : []).map(normalizeCasiMedicosRow);
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchCasiMedicos(query, { lengthPerSplit = 35 } = {}) {
  const q = clean(query);
  if (!q) throw new Error('Introduce un término para buscar en preguntas MIR.');

  // Prefer the copy prepared by Radform. This keeps the user experience fast and stable.
  const local = await getLocalSnapshot();
  const localMatches = searchLocal(local, q, Math.max(20, lengthPerSplit * 3));
  if (localMatches.length) return localMatches;

  // Best-effort fallback only. A separate GitHub Action refreshes the local copy periodically.
  const settled = await Promise.allSettled(SPLITS.map((split) => searchSplit(q, split, lengthPerSplit)));
  const results = settled.flatMap((part) => part.status === 'fulfilled' ? part.value : []);
  const unique = [];
  const seen = new Set();
  results.forEach((item) => {
    if (!item.question || seen.has(item.id)) return;
    seen.add(item.id);
    unique.push(item);
  });
  if (!unique.length) throw new Error('El banco MIR no está disponible temporalmente.');
  return unique;
}

export function casiMedicosDatasetUrl() { return DATASET_URL; }
