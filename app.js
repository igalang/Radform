import { searchCommonsImages, commonsSearchUrl } from './commons.js';
import { searchOpenI, openISearchUrl } from './openi.js';
import { searchMultiCaRe, multiCaReDatasetUrl } from './multicare.js';
import { searchCasiMedicos, casiMedicosDatasetUrl } from './mir-open.js';
import { getSupabaseClient } from './supabase-client.js';

const STORAGE_KEY = 'radform-state-v2';
const ROUTES = new Set(['inicio', 'casos', 'biblioteca', 'entrenar', 'mir', 'atlas', 'ranking', 'acerca']);
const WIKIMEDIA_REDIRECT = 'https://commons.wikimedia.org/wiki/Special:Redirect/file/';
const PENDING_USERNAME_KEY = 'radform-pending-username-v1';
const AUTH_REDIRECT_URL = 'https://igalang.github.io/Radform/';

let cases = [];
let atlasTopics = [];
let mirQuestions = [];
let atlasContinuation = null;
let atlasOpenIStart = 1;
let atlasLastQuery = '';
let atlasSource = 'commons';
let openiSnapshot = [];
let multicareSnapshot = [];
let vqaRadSnapshot = [];
let rocoSnapshot = [];
let librarySource = 'radform';
let libraryRendered = 0;
let mirOpenSnapshot = [];
let libraryOffset = 0;
let libraryLastQuery = '';
let libraryDisplayQuery = '';
let libraryLoaded = false;
let mirRealLoaded = false;
let mirRealItems = [];
let mirSourceMode = 'radform';
const caseImageCache = new Map();
let atlasLoaded = false;
let featuredCase = null;
let installPrompt = null;
let exam = null;
let resizeHandler = null;

// Optional cloud account. Radform remains fully usable as a guest if Supabase or the network is unavailable.
let supabaseClient = null;
let cloudSession = null;
let currentProfile = null;
let currentCloudStats = null;
let cloudReady = false;
let cloudBusy = false;
let rankingPeriod = 'week';
let authSubscription = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = loadState();

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      answers: raw.answers && typeof raw.answers === 'object' ? raw.answers : {},
      favorites: Array.isArray(raw.favorites) ? raw.favorites : [],
      mirAnswers: raw.mirAnswers && typeof raw.mirAnswers === 'object' ? raw.mirAnswers : {},
    };
  } catch {
    return { answers: {}, favorites: [], mirAnswers: {} };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Progress is helpful, not essential. The application remains usable without storage.
  }
}

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeUrl(value, fallback = '#') {
  try {
    const url = new URL(value, window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : fallback;
  } catch {
    return fallback;
  }
}

function hasFixedImage(caseItem) {
  return Boolean(caseItem?.image?.file);
}

function imageUrl(caseItem) {
  return hasFixedImage(caseItem) ? `${WIKIMEDIA_REDIRECT}${encodeURIComponent(caseItem.image.file)}` : '';
}

function modalityPlaceholder(item, compact = false) {
  return `<div class="case-image-placeholder ${compact ? 'compact' : ''}"><strong>${escapeHTML(item.modalityCode || item.modality || 'IMG')}</strong><span>${escapeHTML(item.anatomy || 'Radiología')}</span><small>imagen abierta al resolver</small></div>`;
}

async function resolveCaseImage(item) {
  if (!item) throw new Error('Caso no disponible.');
  if (hasFixedImage(item)) {
    return {
      imageUrl: imageUrl(item), description: item.image.alt || item.title,
      sourcePage: item.image.sourcePage, author: item.image.author || 'Fuente original',
      license: item.image.license || 'Consultar fuente', licenseUrl: item.image.licenseUrl || item.image.sourcePage,
    };
  }
  if (caseImageCache.has(item.id)) return caseImageCache.get(item.id);
  const promise = searchCommonsImages(item.image?.searchQuery || item.diagnosis || item.title, { limit: 12 })
    .then((result) => {
      if (!result.results.length) throw new Error('No se encontró una imagen abierta para este caso.');
      const terms = `${item.diagnosis || ''} ${item.title || ''}`.toLowerCase().split(/\W+/).filter((x) => x.length > 4);
      const scored = result.results.map((img) => ({ img, score: terms.reduce((n, term) => n + (`${img.title} ${img.description}`.toLowerCase().includes(term) ? 1 : 0), 0) }));
      scored.sort((a, b) => b.score - a.score);
      return scored[0].img;
    });
  caseImageCache.set(item.id, promise);
  return promise;
}

function caseImageCaption(meta) {
  const license = meta?.licenseUrl ? `<a href="${escapeHTML(safeUrl(meta.licenseUrl))}" target="_blank" rel="noreferrer">${escapeHTML(meta.license || 'licencia')}</a>` : escapeHTML(meta?.license || 'consultar licencia');
  return `Imagen: ${escapeHTML(meta?.author || 'fuente abierta')} · ${license} · <a href="${escapeHTML(safeUrl(meta?.sourcePage))}" target="_blank" rel="noreferrer">fuente ↗</a>`;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2300);
}


function difficultyForCloud(value) {
  const normalized = String(value || '').trim().toLocaleLowerCase('es');
  if (['avanzado', 'advanced'].includes(normalized)) return 'advanced';
  if (['intermedio', 'intermediate'].includes(normalized)) return 'intermediate';
  return 'basic';
}

function cloudUser() {
  return cloudSession?.user || null;
}

function setCloudNotice(message, tone = '') {
  const el = $('#cloudConnectionNotice');
  if (!el) return;
  el.textContent = message;
  el.className = `cloud-notice ${tone}`.trim();
}

function setAuthMessage(message = '', tone = '') {
  const el = $('#authMessage');
  if (!el) return;
  el.textContent = message;
  el.className = `auth-message ${tone}`.trim();
}

function setProfileMessage(message = '', tone = '') {
  const el = $('#profileMessage');
  if (!el) return;
  el.textContent = message;
  el.className = `auth-message ${tone}`.trim();
}

function setRecoveryMessage(message = '', tone = '') {
  const el = $('#recoveryMessage');
  if (!el) return;
  el.textContent = message;
  el.className = `auth-message ${tone}`.trim();
}

function setAuthTab(mode = 'login') {
  const login = mode !== 'signup';
  $('#loginForm').hidden = !login;
  $('#signupForm').hidden = login;
  $('#loginTabBtn').classList.toggle('is-active', login);
  $('#signupTabBtn').classList.toggle('is-active', !login);
  setAuthMessage('');
}

function openAccountDialog(mode = null) {
  setMobileMenu(false);
  const dialog = $('#accountDialog');
  if (!dialog) return;
  if (mode === 'signup') setAuthTab('signup');
  if (mode === 'login') setAuthTab('login');
  renderAccountUI();
  if (!dialog.open) dialog.showModal();
}

function profileLabel() {
  return currentProfile?.display_name?.trim() || currentProfile?.username || 'Usuario Radform';
}

function renderAccountUI() {
  const user = cloudUser();
  const loggedIn = Boolean(user);
  const loggedOut = $('#authLoggedOut');
  const logged = $('#authLoggedIn');
  const recovery = $('#passwordRecovery');
  if (!recovery?.dataset.active) {
    if (loggedOut) loggedOut.hidden = loggedIn;
    if (logged) logged.hidden = !loggedIn;
  }

  const chipText = $('#accountChipText');
  const drawerText = $('#drawerAccountText');
  if (loggedIn) {
    const shortName = currentProfile?.username ? `@${currentProfile.username}` : 'Mi cuenta';
    if (chipText) chipText.textContent = shortName;
    if (drawerText) drawerText.textContent = shortName;
    $('#accountBtn')?.classList.add('is-authenticated');
    if ($('#accountUserTitle')) $('#accountUserTitle').textContent = profileLabel();
    if ($('#accountEmail')) $('#accountEmail').textContent = user.email || '';
    if ($('#profileUsername')) $('#profileUsername').value = currentProfile?.username || '';
    if ($('#profileDisplayName')) $('#profileDisplayName').value = currentProfile?.display_name || '';
    if ($('#profilePublic')) $('#profilePublic').checked = currentProfile?.is_public !== false;
  } else {
    if (chipText) chipText.textContent = 'Cuenta';
    if (drawerText) drawerText.textContent = 'Cuenta y progreso';
    $('#accountBtn')?.classList.remove('is-authenticated');
  }
  updateCloudStatsUI();
}

function updateCloudStatsUI() {
  const stats = currentCloudStats;
  const loggedIn = Boolean(cloudUser());
  if ($('#myStatsGuest')) $('#myStatsGuest').hidden = loggedIn;
  if ($('#myStatsUser')) $('#myStatsUser').hidden = !loggedIn;

  if (!loggedIn) {
    if ($('#cloudHomeStrip')) $('#cloudHomeStrip').hidden = true;
    return;
  }
  const accuracy = stats ? `${Number(stats.accuracy || 0).toFixed(Number(stats.accuracy || 0) % 1 ? 1 : 0)}%` : '—';
  const points = stats?.total_points ?? 0;
  const attempts = stats?.total_first_attempts ?? 0;
  const streak = stats?.current_streak ?? 0;

  if ($('#accountPoints')) $('#accountPoints').textContent = String(points);
  if ($('#accountAccuracy')) $('#accountAccuracy').textContent = accuracy;
  if ($('#accountStreak')) $('#accountStreak').textContent = String(streak);
  if ($('#cloudPoints')) $('#cloudPoints').textContent = String(points);
  if ($('#cloudAccuracy')) $('#cloudAccuracy').textContent = accuracy;
  if ($('#cloudAttempts')) $('#cloudAttempts').textContent = String(attempts);
  if ($('#cloudStreak')) $('#cloudStreak').textContent = String(streak);
  if ($('#myStatsName')) $('#myStatsName').textContent = profileLabel();
  if ($('#myStatsVisibility')) $('#myStatsVisibility').textContent = currentProfile?.is_public === false ? 'Perfil privado · no aparece en el ranking' : 'Perfil visible en el ranking';
  const homeStrip = $('#cloudHomeStrip');
  if (homeStrip) homeStrip.hidden = !loggedIn;
  if ($('#cloudHomeUser')) $('#cloudHomeUser').textContent = currentProfile?.username ? `@${currentProfile.username}` : profileLabel();
  if ($('#cloudHomeSummary')) $('#cloudHomeSummary').textContent = `${points} puntos · ${attempts} primeros intentos · racha ${streak}`;
}

async function loadProfile() {
  const user = cloudUser();
  if (!supabaseClient || !user) {
    currentProfile = null;
    return null;
  }
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('id,username,display_name,avatar_url,is_public,created_at,updated_at')
    .eq('id', user.id)
    .single();
  if (error) throw error;
  currentProfile = data;
  return data;
}

async function applyPendingUsername() {
  if (!supabaseClient || !cloudUser()) return;
  const pending = localStorage.getItem(PENDING_USERNAME_KEY);
  if (!pending) return;
  const { error } = await supabaseClient
    .from('profiles')
    .update({ username: pending })
    .eq('id', cloudUser().id);
  if (!error) {
    localStorage.removeItem(PENDING_USERNAME_KEY);
    await loadProfile();
  }
}

function mergeCloudCaseAttempts(rows = []) {
  const firstByCase = new Map();
  rows.forEach((row) => {
    if (!firstByCase.has(row.case_id)) firstByCase.set(row.case_id, row);
  });
  firstByCase.forEach((row, caseId) => {
    if (!state.answers[caseId]) {
      state.answers[caseId] = {
        selected: null,
        correct: Boolean(row.is_correct),
        hinted: false,
        at: row.created_at,
        cloud: true,
      };
    }
  });
}

function mergeCloudMirAttempts(rows = []) {
  const firstByQuestion = new Map();
  rows.forEach((row) => {
    if (!firstByQuestion.has(row.question_id)) firstByQuestion.set(row.question_id, row);
  });
  firstByQuestion.forEach((row, questionId) => {
    if (!state.mirAnswers[questionId]) {
      state.mirAnswers[questionId] = {
        selected: null,
        correct: Boolean(row.is_correct),
        at: row.created_at,
        cloud: true,
      };
    }
  });
}

async function loadCloudProgress() {
  if (!supabaseClient || !cloudUser()) return;
  const [caseResult, mirResult] = await Promise.all([
    supabaseClient.from('case_attempts').select('case_id,is_correct,first_try,points,created_at').order('created_at', { ascending: true }),
    supabaseClient.from('mir_attempts').select('question_id,is_correct,first_try,points,created_at').order('created_at', { ascending: true }),
  ]);
  if (caseResult.error) throw caseResult.error;
  if (mirResult.error) throw mirResult.error;
  mergeCloudCaseAttempts(caseResult.data || []);
  mergeCloudMirAttempts(mirResult.data || []);
  saveState();
  updateStats();
  renderCaseGrid();
  renderMirGrid();
}

async function syncLocalProgressToCloud({ silent = false } = {}) {
  if (!supabaseClient || !cloudUser() || cloudBusy) return;
  cloudBusy = true;
  const syncButton = $('#syncProgressBtn');
  if (syncButton) syncButton.disabled = true;
  try {
    const [caseExisting, mirExisting] = await Promise.all([
      supabaseClient.from('case_attempts').select('case_id'),
      supabaseClient.from('mir_attempts').select('question_id'),
    ]);
    if (caseExisting.error) throw caseExisting.error;
    if (mirExisting.error) throw mirExisting.error;

    const existingCases = new Set((caseExisting.data || []).map((row) => row.case_id));
    const existingMir = new Set((mirExisting.data || []).map((row) => row.question_id));

    const caseRows = Object.entries(state.answers)
      .filter(([id]) => !existingCases.has(id))
      .map(([id, answer]) => {
        const item = cases.find((entry) => entry.id === id);
        if (!item) return null;
        return { case_id: id, difficulty: difficultyForCloud(item.difficulty), is_correct: Boolean(answer.correct) };
      })
      .filter(Boolean);

    const mirRows = Object.entries(state.mirAnswers)
      .filter(([id]) => !existingMir.has(id))
      .map(([id, answer]) => {
        const item = mirQuestions.find((entry) => entry.id === id);
        if (!item) return null;
        return { question_id: id, difficulty: difficultyForCloud(item.difficulty), is_correct: Boolean(answer.correct) };
      })
      .filter(Boolean);

    if (caseRows.length) {
      const { error } = await supabaseClient.from('case_attempts').insert(caseRows);
      if (error) throw error;
    }
    if (mirRows.length) {
      const { error } = await supabaseClient.from('mir_attempts').insert(mirRows);
      if (error) throw error;
    }

    await Promise.all([loadCloudStats(), loadLeaderboard(rankingPeriod)]);
    if (!silent) toast(`Progreso sincronizado${caseRows.length || mirRows.length ? ` · ${caseRows.length + mirRows.length} nuevos intentos` : ''}.`);
  } catch (error) {
    console.warn('Radform cloud sync:', error);
    if (!silent) toast('No se pudo completar la sincronización ahora. Tu progreso local sigue guardado.');
  } finally {
    cloudBusy = false;
    if (syncButton) syncButton.disabled = false;
  }
}

async function recordCaseAttempt(item, correct) {
  if (!supabaseClient || !cloudUser() || !item) return;
  const { data, error } = await supabaseClient.from('case_attempts').insert({
    case_id: item.id,
    difficulty: difficultyForCloud(item.difficulty),
    is_correct: Boolean(correct),
  }).select('points,first_try').single();
  if (error) {
    console.warn('Case cloud attempt:', error);
    return;
  }
  if (Number(data?.points || 0) > 0) toast(`+${data.points} puntos · primer intento`);
  void loadCloudStats();
}

async function recordMirAttempt(item, correct) {
  if (!supabaseClient || !cloudUser() || !item) return;
  const { data, error } = await supabaseClient.from('mir_attempts').insert({
    question_id: item.id,
    difficulty: difficultyForCloud(item.difficulty),
    is_correct: Boolean(correct),
  }).select('points,first_try').single();
  if (error) {
    console.warn('MIR cloud attempt:', error);
    return;
  }
  if (Number(data?.points || 0) > 0) toast(`+${data.points} puntos · primer intento`);
  void loadCloudStats();
}

async function loadCloudStats() {
  if (!supabaseClient || !cloudUser()) {
    currentCloudStats = null;
    updateCloudStatsUI();
    return null;
  }
  const { data, error } = await supabaseClient.rpc('get_my_stats');
  if (error) {
    console.warn('Cloud stats:', error);
    return null;
  }
  currentCloudStats = Array.isArray(data) ? (data[0] || null) : data;
  updateCloudStatsUI();
  return currentCloudStats;
}

function leaderboardRow(row) {
  const isMe = currentProfile?.username && row.username === currentProfile.username;
  const display = row.display_name?.trim() || `@${row.username}`;
  const sub = row.display_name?.trim() ? `@${row.username}` : '';
  return `<tr class="${isMe ? 'is-me' : ''}">
    <td data-label="Posición"><span class="rank-number">${Number(row.rank_position) <= 3 ? ['🥇','🥈','🥉'][Number(row.rank_position)-1] : `#${escapeHTML(row.rank_position)}`}</span></td>
    <td data-label="Usuario"><strong>${escapeHTML(display)}</strong>${sub ? `<small>${escapeHTML(sub)}</small>` : ''}${isMe ? '<span class="me-badge">Tú</span>' : ''}</td>
    <td data-label="Puntos"><strong>${escapeHTML(row.total_points ?? 0)}</strong></td>
    <td data-label="Acierto">${escapeHTML(row.accuracy ?? 0)}%</td>
    <td data-label="Primeros intentos">${escapeHTML(row.first_attempts ?? 0)}</td>
  </tr>`;
}

async function loadLeaderboard(period = rankingPeriod) {
  rankingPeriod = period;
  $$('[data-rank-period]').forEach((button) => button.classList.toggle('is-active', button.dataset.rankPeriod === rankingPeriod));
  const status = $('#leaderboardStatus');
  const body = $('#leaderboardBody');
  if (!status || !body) return;
  if (!supabaseClient) {
    status.textContent = cloudReady ? 'Clasificación no disponible.' : 'Conectando con la clasificación…';
    body.innerHTML = '';
    return;
  }
  status.textContent = 'Actualizando clasificación…';
  const { data, error } = await supabaseClient.rpc('get_leaderboard', { p_period: rankingPeriod, p_limit: 50 });
  if (error) {
    console.warn('Leaderboard:', error);
    status.textContent = 'La clasificación no pudo cargarse ahora. Puedes seguir usando Radform normalmente.';
    body.innerHTML = '';
    return;
  }
  const rows = Array.isArray(data) ? data : [];
  status.textContent = rows.length ? `${rows.length} usuarios en esta clasificación` : 'Todavía no hay puntuaciones en este periodo. Sé el primero.';
  body.innerHTML = rows.map(leaderboardRow).join('');
}

async function handleCloudSession(session, { sync = true } = {}) {
  cloudSession = session;
  currentProfile = null;
  currentCloudStats = null;
  if (!session?.user) {
    renderAccountUI();
    updateCloudStatsUI();
    setCloudNotice(cloudReady ? 'Modo invitado · progreso local' : 'Conectando…');
    return;
  }
  try {
    await loadProfile();
    await applyPendingUsername();
    await Promise.all([loadCloudProgress(), loadCloudStats()]);
    renderAccountUI();
    setCloudNotice('Conectado · progreso sincronizable', 'good');
    if (sync) await syncLocalProgressToCloud({ silent: true });
  } catch (error) {
    console.warn('Cloud session:', error);
    setCloudNotice('Sesión iniciada, pero la sincronización no está disponible ahora.', 'warn');
    renderAccountUI();
  }
  if (parseLocation().route === 'ranking') void loadLeaderboard(rankingPeriod);
}

async function initCloud() {
  setCloudNotice('Conectando con Radform Cloud…');
  try {
    supabaseClient = await getSupabaseClient();
    cloudReady = true;
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    await handleCloudSession(data?.session || null, { sync: true });
    const listener = supabaseClient.auth.onAuthStateChange((event, session) => {
      window.setTimeout(() => {
        if (event === 'PASSWORD_RECOVERY') {
          const recovery = $('#passwordRecovery');
          if (recovery) recovery.dataset.active = 'true';
          $('#authLoggedOut').hidden = true;
          $('#authLoggedIn').hidden = true;
          $('#passwordRecovery').hidden = false;
          openAccountDialog();
        }
        void handleCloudSession(session, { sync: event === 'SIGNED_IN' || event === 'INITIAL_SESSION' });
      }, 0);
    });
    authSubscription = listener?.data?.subscription || null;
    void loadLeaderboard(rankingPeriod);
  } catch (error) {
    console.warn('Supabase unavailable:', error);
    cloudReady = true;
    supabaseClient = null;
    setCloudNotice('Radform Cloud no está disponible ahora. El modo invitado sigue funcionando.', 'warn');
    renderAccountUI();
    if ($('#leaderboardStatus')) $('#leaderboardStatus').textContent = 'La clasificación no está disponible ahora.';
  }
}

async function handleLogin(event) {
  event.preventDefault();
  if (!supabaseClient) return setAuthMessage('No se puede conectar con el servicio de cuentas ahora.', 'bad');
  setAuthMessage('Iniciando sesión…');
  const email = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return setAuthMessage(error.message || 'No se pudo iniciar sesión.', 'bad');
  setAuthMessage('Sesión iniciada.', 'good');
}

async function handleSignup(event) {
  event.preventDefault();
  if (!supabaseClient) return setAuthMessage('No se puede conectar con el servicio de cuentas ahora.', 'bad');
  const username = $('#signupUsername').value.trim();
  const email = $('#signupEmail').value.trim();
  const password = $('#signupPassword').value;
  if (!/^[A-Za-z0-9_-]{3,30}$/.test(username)) return setAuthMessage('El alias debe tener 3–30 caracteres y usar solo letras, números, - o _.', 'bad');
  setAuthMessage('Creando cuenta…');
  localStorage.setItem(PENDING_USERNAME_KEY, username);
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: AUTH_REDIRECT_URL },
  });
  if (error) {
    localStorage.removeItem(PENDING_USERNAME_KEY);
    return setAuthMessage(error.message || 'No se pudo crear la cuenta.', 'bad');
  }
  if (data?.session) {
    setAuthMessage('Cuenta creada. Sincronizando tu progreso…', 'good');
  } else {
    setAuthMessage('Cuenta creada. Revisa tu correo y confirma el enlace; después podrás iniciar sesión.', 'good');
  }
}

async function handleForgotPassword() {
  if (!supabaseClient) return setAuthMessage('No se puede conectar con el servicio de cuentas ahora.', 'bad');
  const email = ($('#loginEmail').value || '').trim();
  if (!email) return setAuthMessage('Escribe primero tu email en el formulario.', 'bad');
  setAuthMessage('Enviando enlace de recuperación…');
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: AUTH_REDIRECT_URL });
  if (error) return setAuthMessage(error.message || 'No se pudo enviar el enlace.', 'bad');
  setAuthMessage('Te hemos enviado un enlace para crear una nueva contraseña.', 'good');
}

async function handleRecovery(event) {
  event.preventDefault();
  if (!supabaseClient) return setRecoveryMessage('No se puede conectar ahora.', 'bad');
  const password = $('#recoveryPassword').value;
  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) return setRecoveryMessage(error.message || 'No se pudo cambiar la contraseña.', 'bad');
  setRecoveryMessage('Contraseña actualizada.', 'good');
  const recovery = $('#passwordRecovery');
  recovery.dataset.active = '';
  recovery.hidden = true;
  renderAccountUI();
}

async function handleProfileSave(event) {
  event.preventDefault();
  if (!supabaseClient || !cloudUser()) return;
  const username = $('#profileUsername').value.trim();
  const displayName = $('#profileDisplayName').value.trim();
  const isPublic = $('#profilePublic').checked;
  if (!/^[A-Za-z0-9_-]{3,30}$/.test(username)) return setProfileMessage('Alias no válido.', 'bad');
  setProfileMessage('Guardando…');
  const { error } = await supabaseClient
    .from('profiles')
    .update({ username, display_name: displayName || null, is_public: isPublic })
    .eq('id', cloudUser().id);
  if (error) {
    const duplicate = String(error.message || '').toLowerCase().includes('duplicate');
    return setProfileMessage(duplicate ? 'Ese alias ya está en uso. Elige otro.' : (error.message || 'No se pudo guardar el perfil.'), 'bad');
  }
  await loadProfile();
  renderAccountUI();
  setProfileMessage('Perfil actualizado.', 'good');
  void loadLeaderboard(rankingPeriod);
}

async function handleSignOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  toast('Sesión cerrada. Radform continúa en modo invitado.');
}

function answerStats() {
  const answers = Object.values(state.answers);
  const answered = answers.length;
  const correct = answers.filter((answer) => answer.correct).length;
  return { answered, correct, accuracy: answered ? Math.round((correct / answered) * 100) : null };
}

function updateStats() {
  const stats = answerStats();
  $('#statCases').textContent = String(cases.length);
  $('#statMirQuestions').textContent = String(mirQuestions.length);
  $('#statTopics').textContent = '∞';
  $('#statAnswered').textContent = String(stats.answered);
  $('#statAccuracy').textContent = stats.accuracy == null ? '—' : `${stats.accuracy}%`;
}

function parseLocation() {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash.startsWith('case=')) return { route: 'casos', caseId: decodeURIComponent(hash.slice(5)) };
  return { route: ROUTES.has(hash) ? hash : 'inicio', caseId: null };
}

function navigate(route, { updateHash = true } = {}) {
  const target = ROUTES.has(route) ? route : 'inicio';
  setMobileMenu(false);
  if (target !== 'atlas') setTopicDrawer(false);
  $$('.view').forEach((view) => view.classList.toggle('is-active', view.dataset.view === target));
  $$('.nav-link').forEach((link) => link.classList.toggle('is-active', link.dataset.route === target));
  $$('.drawer-nav-link').forEach((link) => link.classList.toggle('is-active', link.dataset.route === target));
  if (updateHash) history.replaceState(null, '', `#${target}`);
  $('#main')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (target === 'biblioteca' && !libraryLoaded) {
    libraryLoaded = true;
    runLibrarySearch('', { reset: true, displayQuery: 'Todos' });
  }
  if (target === 'atlas' && !atlasLoaded) {
    atlasLoaded = true;
    const starter = atlasTopics.find((topic) => topic.id === 'atlas-002') || atlasTopics[0];
    if (starter) {
      $('#atlasQuery').value = starter.label;
      $('#atlasModality').value = starter.modality || 'all';
      runAtlasSearch(starter.query, { reset: true, displayQuery: starter.label });
    }
  }
  if (target === 'ranking') {
    void loadLeaderboard(rankingPeriod);
    void loadCloudStats();
  }
}


function setMobileMenu(open) {
  const drawer = $('#mobileNav');
  const overlay = $('#navOverlay');
  const button = $('#menuBtn');
  if (!drawer || !overlay || !button) return;
  drawer.classList.toggle('is-open', open);
  drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  overlay.hidden = !open;
  document.body.classList.toggle('drawer-open', open);
}

function setTopicDrawer(open) {
  const panel = $('#topicPanel');
  const overlay = $('#topicOverlay');
  const button = $('#topicDrawerBtn');
  if (!panel || !overlay || !button) return;
  panel.classList.toggle('is-open', open);
  if (window.matchMedia('(max-width: 900px)').matches) panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  overlay.hidden = !open;
  document.body.classList.toggle('topic-drawer-open', open);
}

function setMobileFilter(panelSelector, buttonSelector, open) {
  const panel = $(panelSelector); const button = $(buttonSelector); const overlay = $('#filterOverlay');
  if (!panel || !button || !overlay) return;
  panel.classList.toggle('is-open', open);
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  overlay.hidden = !open;
  document.body.classList.toggle('filter-sheet-open', open);
}

function toggleMobileFilter(panelSelector, buttonSelector) {
  const panel = $(panelSelector);
  if (!panel) return;
  setMobileFilter(panelSelector, buttonSelector, !panel.classList.contains('is-open'));
}

function closeMobileFilters() {
  setMobileFilter('#caseFilters', '#caseFiltersBtn', false);
  setMobileFilter('#mirFilters', '#mirFiltersBtn', false);
}

function populateLibraryTopicControls() {
  const anatomySelect = $('#libraryAnatomy');
  const topicSelect = $('#libraryTopic');
  if (!anatomySelect || !topicSelect) return;
  const anatomy = [...new Set(atlasTopics.map((topic) => topic.anatomy))].sort((a,b)=>a.localeCompare(b,'es'));
  anatomySelect.innerHTML = '<option value="all">Todas</option>' + anatomy.map((value)=>`<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join('');
  const render = () => {
    const area = anatomySelect.value;
    const items = atlasTopics.filter((topic)=>area==='all' || topic.anatomy===area).sort((a,b)=>a.label.localeCompare(b.label,'es'));
    topicSelect.innerHTML = '<option value="">Selecciona un tema</option>' + items.map((topic)=>`<option value="${escapeHTML(topic.id)}">${escapeHTML(topic.label)} · ${escapeHTML(topic.modality)}</option>`).join('');
  };
  anatomySelect.addEventListener('change', render); render();
}

function populateAtlasQuickTopic() {
  const select = $('#atlasQuickTopic');
  if (!select) return;
  const grouped = new Map();
  atlasTopics.forEach((topic) => {
    if (!grouped.has(topic.anatomy)) grouped.set(topic.anatomy, []);
    grouped.get(topic.anatomy).push(topic);
  });
  select.innerHTML = '<option value="">Selecciona un tema</option>' + [...grouped.entries()]
    .sort((a,b)=>a[0].localeCompare(b[0],'es'))
    .map(([area, items]) => `<optgroup label="${escapeHTML(area)}">${items.sort((a,b)=>a.label.localeCompare(b.label,'es')).map((topic)=>`<option value="${escapeHTML(topic.id)}">${escapeHTML(topic.label)} · ${escapeHTML(topic.modality)}</option>`).join('')}</optgroup>`).join('');
}

function runAtlasQuickTopic() {
  const topic = atlasTopics.find((entry) => entry.id === $('#atlasQuickTopic')?.value);
  if (!topic) { toast('Selecciona un tema.'); return; }
  $('#atlasQuery').value = topic.label;
  $('#atlasModality').value = topic.modality || 'all';
  renderTopicList();
  runAtlasSearch(topic.query, { reset: true, displayQuery: topic.label });
}

function resolveOpenSearchQuery(rawQuery) {
  const normalized = normalizeSearchText(rawQuery);
  const exact = atlasTopics.find((topic) => normalizeSearchText(topic.label) === normalized);
  const partial = atlasTopics.find((topic) => {
    const label = normalizeSearchText(topic.label);
    return normalized.length >= 4 && (label.includes(normalized) || normalized.includes(label));
  });
  return (exact || partial)?.query || FREE_SEARCH_ALIASES[normalized] || String(rawQuery || '').trim();
}

function populateAnatomyFilter() {
  const values = [...new Set(cases.map((item) => item.anatomy))].sort((a, b) => a.localeCompare(b, 'es'));
  const select = $('#filterAnatomy');
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function renderFeatured() {
  const fixed = cases.filter(hasFixedImage);
  featuredCase = shuffle(fixed.length ? fixed : cases)[0];
  if (!featuredCase) return;
  $('#featuredTitle').textContent = featuredCase.title;
  $('#featuredModality').textContent = featuredCase.modality;
  $('#featuredAnatomy').textContent = `${featuredCase.anatomy} · ${featuredCase.difficulty}`;
  const wrap = $('#featuredImageWrap');
  if (hasFixedImage(featuredCase)) {
    wrap.innerHTML = `<img src="${escapeHTML(imageUrl(featuredCase))}" alt="${escapeHTML(featuredCase.image.alt)}" loading="eager" referrerpolicy="no-referrer" />`;
  } else {
    wrap.innerHTML = modalityPlaceholder(featuredCase);
    resolveCaseImage(featuredCase).then((meta) => { wrap.innerHTML = `<img src="${escapeHTML(safeUrl(meta.imageUrl))}" alt="${escapeHTML(meta.description || featuredCase.image.alt)}" loading="eager" referrerpolicy="no-referrer" />`; }).catch(() => {});
  }
}

function filteredCases() {
  const query = ($('#caseSearch').value || '').trim().toLocaleLowerCase('es');
  const modality = $('#filterModality').value;
  const anatomy = $('#filterAnatomy').value;
  const difficulty = $('#filterDifficulty').value;
  const favoritesOnly = $('#filterFavorites').checked;

  return cases.filter((item) => {
    const haystack = [item.title, item.diagnosis, item.anatomy, item.modality, ...(item.tags || [])].join(' ').toLocaleLowerCase('es');
    return (!query || haystack.includes(query))
      && (modality === 'all' || item.modalityCode === modality)
      && (anatomy === 'all' || item.anatomy === anatomy)
      && (difficulty === 'all' || item.difficulty === difficulty)
      && (!favoritesOnly || state.favorites.includes(item.id));
  });
}

function renderCaseGrid() {
  const items = filteredCases();
  const grid = $('#caseGrid');
  grid.innerHTML = items.map((item) => {
    const answer = state.answers[item.id];
    const isFav = state.favorites.includes(item.id);
    const statusClass = answer ? (answer.correct ? 'good' : 'bad') : '';
    return `
      <article class="case-card" data-case-id="${escapeHTML(item.id)}">
        <button class="case-thumb" data-open-case="${escapeHTML(item.id)}" aria-label="Abrir ${escapeHTML(item.title)}">
          ${hasFixedImage(item) ? `<img src="${escapeHTML(imageUrl(item))}" alt="${escapeHTML(item.image.alt)}" loading="lazy" referrerpolicy="no-referrer" />` : modalityPlaceholder(item, true)}
          <span class="case-thumb-overlay"></span>
        </button>
        <div class="case-card-body">
          <div class="case-meta">
            <div class="meta-tags"><span class="tiny-badge">${escapeHTML(item.modality)}</span><span class="tiny-badge diff">${escapeHTML(item.difficulty)}</span></div>
            <span class="answered-dot ${statusClass}" title="${answer ? (answer.correct ? 'Respondido correctamente' : 'Respondido incorrectamente') : 'Sin responder'}"></span>
          </div>
          <h3>${escapeHTML(item.title)}</h3>
          <p>${escapeHTML(item.anatomy)} · ${escapeHTML(item.keyFinding)}</p>
          <div class="case-actions">
            <button class="text-btn" data-open-case="${escapeHTML(item.id)}">Resolver →</button>
            <button class="fav-btn ${isFav ? 'is-fav' : ''}" data-fav-case="${escapeHTML(item.id)}" aria-label="${isFav ? 'Quitar de guardados' : 'Guardar caso'}">${isFav ? '★' : '☆'}</button>
          </div>
        </div>
      </article>`;
  }).join('');

  $('#caseEmpty').hidden = items.length > 0;
  $$('[data-open-case]', grid).forEach((button) => button.addEventListener('click', () => openCase(button.dataset.openCase, { mode: 'guided' })));
  $$('[data-fav-case]', grid).forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFavorite(button.dataset.favCase);
    renderCaseGrid();
  }));
}


function populateMirAreaFilter() {
  const values = [...new Set(mirQuestions.map((item) => item.area))].sort((a, b) => a.localeCompare(b, 'es'));
  const select = $('#mirArea');
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function filteredMirQuestions() {
  const query = ($('#mirSearch')?.value || '').trim().toLocaleLowerCase('es');
  const area = $('#mirArea')?.value || 'all';
  const difficulty = $('#mirDifficulty')?.value || 'all';
  const withImage = $('#mirWithImage')?.checked || false;
  return mirQuestions.filter((item) => {
    const haystack = [item.stem, item.question, item.area, item.difficulty, ...(item.options || [])].join(' ').toLocaleLowerCase('es');
    return (!query || haystack.includes(query))
      && (area === 'all' || item.area === area)
      && (difficulty === 'all' || item.difficulty === difficulty)
      && (!withImage || Boolean(item.caseId));
  });
}

function renderMirGrid() {
  const items = filteredMirQuestions();
  const grid = $('#mirGrid');
  if (!grid) return;
  const solved = Object.keys(state.mirAnswers || {}).length;
  $('#mirVisibleCount').textContent = String(items.length);
  $('#mirSolvedCount').textContent = `${solved} resueltas`;
  grid.innerHTML = items.map((item) => {
    const answer = state.mirAnswers?.[item.id];
    const status = answer ? (answer.correct ? 'good' : 'bad') : '';
    const imageBadge = item.caseId ? '<span class="tiny-badge image-badge">con imagen</span>' : '';
    return `<article class="mir-card ${status}" data-mir-id="${escapeHTML(item.id)}">
      <div class="mir-card-top"><div class="meta-tags"><span class="tiny-badge">${escapeHTML(item.area)}</span><span class="tiny-badge diff">${escapeHTML(item.difficulty)}</span>${imageBadge}</div><span class="answered-dot ${status}"></span></div>
      <p class="mir-stem">${escapeHTML(item.stem)}</p>
      <h3>${escapeHTML(item.question)}</h3>
      <button type="button" class="text-btn" data-open-mir="${escapeHTML(item.id)}">Resolver →</button>
    </article>`;
  }).join('');
  $('#mirEmpty').hidden = items.length > 0;
  $$('[data-open-mir]', grid).forEach((button) => button.addEventListener('click', () => openMirQuestion(button.dataset.openMir)));
}

function mirImageBlock(item) {
  if (!item.caseId) return '';
  const linkedCase = cases.find((entry) => entry.id === item.caseId);
  if (!linkedCase) return '';
  if (hasFixedImage(linkedCase)) return `<div class="mir-image-card">
    <img src="${escapeHTML(imageUrl(linkedCase))}" alt="${escapeHTML(linkedCase.image.alt)}" loading="eager" referrerpolicy="no-referrer" />
    <div class="viewer-caption">${caseImageCaption({ sourcePage: linkedCase.image.sourcePage, author: linkedCase.image.author, license: linkedCase.image.license, licenseUrl: linkedCase.image.licenseUrl })}</div>
  </div>`;
  return `<div class="mir-image-card" data-mir-dynamic-image="${escapeHTML(linkedCase.id)}">${modalityPlaceholder(linkedCase)}<div class="viewer-caption">Cargando imagen abierta…</div></div>`;
}

async function hydrateMirImage(item, mount) {
  if (!item?.caseId) return;
  const linkedCase = cases.find((entry) => entry.id === item.caseId);
  if (!linkedCase || hasFixedImage(linkedCase)) return;
  const card = $(`[data-mir-dynamic-image="${linkedCase.id}"]`, mount);
  if (!card) return;
  try {
    const meta = await resolveCaseImage(linkedCase);
    card.innerHTML = `<img src="${escapeHTML(safeUrl(meta.imageUrl))}" alt="${escapeHTML(meta.description || linkedCase.image.alt)}" loading="eager" referrerpolicy="no-referrer" /><div class="viewer-caption">${caseImageCaption(meta)}</div>`;
  } catch (error) {
    card.innerHTML = `${modalityPlaceholder(linkedCase)}<div class="viewer-caption">${escapeHTML(error?.message || 'Imagen no disponible ahora.')}</div>`;
  }
}

function openMirQuestion(questionId) {
  const item = mirQuestions.find((entry) => entry.id === questionId);
  if (!item) return;
  const dialog = $('#mirDialog');
  const mount = $('#mirDialogBody');
  const previous = state.mirAnswers?.[item.id];
  let answered = Boolean(previous);
  let selected = previous?.selected ?? null;
  let answerCorrect = previous?.correct ?? null;

  const render = () => {
    mount.innerHTML = `<article class="mir-detail">
      <header class="case-detail-head"><div><span class="eyebrow">PREGUNTA MIR · ${escapeHTML(item.area)}</span><h2>${escapeHTML(item.question)}</h2><div class="chip-row"><span class="chip">${escapeHTML(item.difficulty)}</span>${item.caseId ? '<span class="chip">con imagen</span>' : ''}</div></div></header>
      <div class="mir-detail-grid ${item.caseId ? 'has-image' : ''}">
        ${mirImageBlock(item)}
        <div class="case-question">
          <p class="vignette">${escapeHTML(item.stem)}</p>
          <div class="answer-list mir-answer-list">
            ${item.options.map((option, index) => {
              let cls = '';
              if (answered) {
                if (index === item.correctIndex) cls = 'correct';
                else if (index === selected) cls = 'incorrect';
              }
              return `<button type="button" class="answer-btn ${cls}" data-mir-answer="${index}" ${answered ? 'disabled' : ''}><strong>${String.fromCharCode(65 + index)}.</strong> ${escapeHTML(option)}</button>`;
            }).join('')}
          </div>
          ${answered ? `<div class="feedback ${(answerCorrect ?? (selected === item.correctIndex)) ? 'good' : 'bad'}"><h4>${(answerCorrect ?? (selected === item.correctIndex)) ? 'Correcto' : 'Respuesta incorrecta'}</h4><p>${escapeHTML(item.explanation)}</p></div>` : ''}
          <div class="mir-dialog-actions"><button type="button" class="btn secondary" id="mirNextRandom">Otra pregunta</button></div>
        </div>
      </div>
    </article>`;

    hydrateMirImage(item, mount);

    $$('[data-mir-answer]', mount).forEach((button) => button.addEventListener('click', () => {
      if (answered) return;
      selected = Number(button.dataset.mirAnswer);
      answered = true;
      answerCorrect = selected === item.correctIndex;
      state.mirAnswers[item.id] = { selected, correct: answerCorrect, at: Date.now() };
      saveState();
      void recordMirAttempt(item, answerCorrect);
      render();
      renderMirGrid();
    }));
    $('#mirNextRandom', mount)?.addEventListener('click', () => {
      const pool = filteredMirQuestions().filter((entry) => entry.id !== item.id);
      const next = shuffle(pool.length ? pool : mirQuestions.filter((entry) => entry.id !== item.id))[0];
      if (next) openMirQuestion(next.id);
    });
  };

  render();
  if (!dialog.open) dialog.showModal();
}

function toggleFavorite(caseId) {
  const index = state.favorites.indexOf(caseId);
  if (index >= 0) state.favorites.splice(index, 1);
  else state.favorites.push(caseId);
  saveState();
}

function positionHotspot(stage, img, hotspot, zoom = 1) {
  if (!stage || !img || !hotspot || !img.naturalWidth || !img.naturalHeight) return;
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const ratio = Math.min(sw / img.naturalWidth, sh / img.naturalHeight);
  const iw = img.naturalWidth * ratio;
  const ih = img.naturalHeight * ratio;
  const left0 = (sw - iw) / 2 + (Number(hotspot.dataset.x) / 100) * iw;
  const top0 = (sh - ih) / 2 + (Number(hotspot.dataset.y) / 100) * ih;
  const cx = sw / 2;
  const cy = sh / 2;
  hotspot.style.left = `${cx + (left0 - cx) * zoom}px`;
  hotspot.style.top = `${cy + (top0 - cy) * zoom}px`;
}

function renderCaseExperience(item, { mode = 'guided', mount, examMode = false, onExamAnswered = null } = {}) {
  const previous = examMode ? null : state.answers[item.id];
  let selected = previous?.selected ?? null;
  let answered = previous != null;
  let answerCorrect = previous?.correct ?? null;
  const hotspotData = item.image?.hotspot && Number.isFinite(Number(item.image.hotspot.x)) && Number.isFinite(Number(item.image.hotspot.y)) ? item.image.hotspot : null;
  let hintVisible = Boolean(hotspotData) && mode === 'guided';
  let zoom = 1;
  const fixed = hasFixedImage(item);

  mount.innerHTML = `
    <article class="case-detail">
      <header class="case-detail-head">
        <div>
          <span class="eyebrow">${escapeHTML(item.modality)} · ${escapeHTML(item.anatomy)}</span>
          <h2>${escapeHTML(item.title)}</h2>
          <div class="chip-row"><span class="chip">${escapeHTML(item.difficulty)}</span>${(item.tags || []).slice(0, 3).map((tag) => `<span class="chip">${escapeHTML(tag)}</span>`).join('')}</div>
        </div>
      </header>
      <div class="case-detail-grid">
        <div class="viewer-card">
          <div class="viewer-toolbar">
            <div class="mode-toggle" aria-label="Modo de visualización">
              <button type="button" data-mode="guided" class="${mode === 'guided' ? 'is-active' : ''}">Guiado</button>
              <button type="button" data-mode="exam" class="${mode === 'exam' ? 'is-active' : ''}">Examen</button>
            </div>
            <div class="viewer-controls">
              <button type="button" data-zoom="out" aria-label="Alejar">−</button>
              <button type="button" data-zoom="reset" aria-label="Restablecer zoom">1:1</button>
              <button type="button" data-zoom="in" aria-label="Acercar">＋</button>
            </div>
          </div>
          <div class="image-stage">
            ${fixed ? `<img data-case-main-img src="${escapeHTML(imageUrl(item))}" alt="${escapeHTML(item.image.alt)}" referrerpolicy="no-referrer" />` : `${modalityPlaceholder(item)}<img data-case-main-img alt="${escapeHTML(item.image.alt)}" referrerpolicy="no-referrer" hidden />`}
            ${hotspotData ? `<button type="button" class="hotspot" data-x="${Number(hotspotData.x)}" data-y="${Number(hotspotData.y)}" title="${escapeHTML(hotspotData.label)}" aria-label="Pista: ${escapeHTML(hotspotData.label)}" ${hintVisible || answered ? '' : 'hidden'}>✦</button>` : ''}
          </div>
          <div class="viewer-caption" data-case-caption>${fixed ? caseImageCaption({ sourcePage: item.image.sourcePage, author: item.image.author, license: item.image.license, licenseUrl: item.image.licenseUrl }) : 'Buscando una imagen abierta para este caso…'}</div>
        </div>
        <div class="case-question">
          <p class="vignette">${escapeHTML(item.vignette)}</p>
          <h3 class="question-title">${escapeHTML(item.question)}</h3>
          <div class="answer-list">
            ${item.options.map((option, index) => `<button type="button" class="answer-btn" data-answer="${index}"><strong>${String.fromCharCode(65 + index)}.</strong> ${escapeHTML(option)}</button>`).join('')}
          </div>
          <div class="bookmark-row">
            ${hotspotData ? `<button type="button" class="btn secondary inline" data-hint>${hintVisible ? 'Ocultar pista' : 'Mostrar pista'}</button>` : '<span class="hint-unavailable">Este caso no utiliza hotspot.</span>'}
            ${examMode ? '<small>Si existe hotspot, usar la pista queda registrado como ayuda.</small>' : `<button type="button" class="fav-btn ${state.favorites.includes(item.id) ? 'is-fav' : ''}" data-fav>${state.favorites.includes(item.id) ? '★ Guardado' : '☆ Guardar'}</button>`}
          </div>
          <div data-feedback></div>
        </div>
      </div>
    </article>`;

  const stage = $('.image-stage', mount);
  const img = $('[data-case-main-img]', mount);
  const hotspot = $('.hotspot', mount);
  const caption = $('[data-case-caption]', mount);
  const feedback = $('[data-feedback]', mount);
  const answerButtons = $$('[data-answer]', mount);
  const hintButton = $('[data-hint]', mount);

  const updateViewer = () => {
    if (!img || img.hidden) return;
    img.style.transform = `scale(${zoom})`;
    if (hotspot) positionHotspot(stage, img, hotspot, zoom);
  };

  const renderFeedback = () => {
    answerButtons.forEach((button) => {
      const index = Number(button.dataset.answer);
      button.disabled = answered;
      button.classList.toggle('correct', answered && index === item.correctIndex);
      button.classList.toggle('incorrect', answered && index === selected && index !== item.correctIndex);
    });
    if (!answered) { feedback.innerHTML = ''; return; }
    const correct = answerCorrect ?? (selected === item.correctIndex);
    feedback.innerHTML = `<div class="feedback ${correct ? 'good' : 'bad'}">
      <h4>${correct ? '✓ Correcto' : `✕ Respuesta correcta: ${escapeHTML(item.options[item.correctIndex])}`}</h4>
      <p><strong>Hallazgo clave:</strong> ${escapeHTML(item.keyFinding)}</p>
      <p>${escapeHTML(item.explanation)}</p>
      <div class="differential"><strong>Diagnóstico diferencial</strong><div class="chip-row">${(item.differential || []).map((entry) => `<span class="chip">${escapeHTML(entry)}</span>`).join('')}</div></div>
      <ul class="pearl-list">${(item.pearls || []).map((pearl) => `<li>${escapeHTML(pearl)}</li>`).join('')}</ul>
    </div>`;
    if (hotspot) hotspot.hidden = false;
    if (hintButton) { hintButton.textContent = 'Pista mostrada'; hintButton.disabled = true; }
  };

  answerButtons.forEach((button) => button.addEventListener('click', () => {
    if (answered) return;
    selected = Number(button.dataset.answer);
    answered = true;
    const correct = selected === item.correctIndex;
    answerCorrect = correct;
    if (!examMode) {
      state.answers[item.id] = { selected, correct, hinted: hintVisible, at: new Date().toISOString() };
      saveState(); updateStats(); renderCaseGrid();
      void recordCaseAttempt(item, correct);
    }
    renderFeedback();
    onExamAnswered?.({ item, selected, correct, hinted: hintVisible });
  }));

  hintButton?.addEventListener('click', () => {
    if (answered || !hotspot) return;
    hintVisible = !hintVisible;
    hotspot.hidden = !hintVisible;
    hintButton.textContent = hintVisible ? 'Ocultar pista' : 'Mostrar pista';
  });

  $$('[data-mode]', mount).forEach((button) => button.addEventListener('click', () => {
    if (answered) return;
    const selectedMode = button.dataset.mode;
    hintVisible = Boolean(hotspot) && selectedMode === 'guided';
    if (hotspot) hotspot.hidden = !hintVisible;
    if (hintButton) hintButton.textContent = hintVisible ? 'Ocultar pista' : 'Mostrar pista';
    $$('[data-mode]', mount).forEach((entry) => entry.classList.toggle('is-active', entry.dataset.mode === selectedMode));
  }));

  $$('[data-zoom]', mount).forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.zoom === 'in') zoom = Math.min(2.2, Math.round((zoom + 0.2) * 10) / 10);
    if (button.dataset.zoom === 'out') zoom = Math.max(0.8, Math.round((zoom - 0.2) * 10) / 10);
    if (button.dataset.zoom === 'reset') zoom = 1;
    updateViewer();
  }));

  const fav = $('[data-fav]', mount);
  fav?.addEventListener('click', () => {
    toggleFavorite(item.id);
    const isFav = state.favorites.includes(item.id);
    fav.classList.toggle('is-fav', isFav); fav.textContent = isFav ? '★ Guardado' : '☆ Guardar'; renderCaseGrid();
  });

  if (fixed) {
    img.addEventListener('load', updateViewer, { once: true });
    if (img.complete) updateViewer();
  } else {
    resolveCaseImage(item).then((meta) => {
      const placeholder = $('.case-image-placeholder', stage);
      img.src = safeUrl(meta.imageUrl, '');
      img.hidden = false;
      placeholder?.remove();
      caption.innerHTML = caseImageCaption(meta);
      img.addEventListener('load', updateViewer, { once: true });
    }).catch((error) => {
      caption.innerHTML = `<span class="error-text">${escapeHTML(error?.message || 'No se pudo cargar la imagen.')}</span> · <a href="${escapeHTML(safeUrl(commonsSearchUrl(item.image?.searchQuery || item.diagnosis)))}" target="_blank" rel="noreferrer">buscar en Commons ↗</a>`;
    });
  }

  resizeHandler = () => updateViewer();
  window.addEventListener('resize', resizeHandler, { passive: true });
  renderFeedback();
  return { getHinted: () => hintVisible };
}

function openCase(caseId, { mode = 'guided' } = {}) {
  const item = cases.find((entry) => entry.id === caseId);
  if (!item) return;
  const dialog = $('#caseDialog');
  const body = $('#caseDialogBody');
  if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  renderCaseExperience(item, { mode, mount: body });
  if (!dialog.open) dialog.showModal();
  history.replaceState(null, '', `#case=${encodeURIComponent(item.id)}`);
}

function closeCaseDialog() {
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
  const current = parseLocation();
  if (current.caseId) history.replaceState(null, '', '#casos');
}

function examPool() {
  const modality = $('#examModality').value;
  const difficulty = $('#examDifficulty').value;
  return cases.filter((item) => (modality === 'all' || item.modalityCode === modality) && (difficulty === 'all' || item.difficulty === difficulty));
}

function startExam() {
  const pool = shuffle(examPool());
  if (!pool.length) {
    toast('No hay casos con esos filtros.');
    return;
  }
  exam = { cases: pool.slice(0, Math.min(10, pool.length)), index: 0, score: 0, results: [], answeredCurrent: false };
  $('#examIntro').hidden = true;
  $('#examResults').hidden = true;
  $('#examStage').hidden = false;
  renderExamCase();
}

function updateExamHeader() {
  if (!exam) {
    $('#examPosition').textContent = '0 / 10';
    $('#examScore').textContent = '0 aciertos';
    return;
  }
  $('#examPosition').textContent = `${Math.min(exam.index + 1, exam.cases.length)} / ${exam.cases.length}`;
  $('#examScore').textContent = `${exam.score} ${exam.score === 1 ? 'acierto' : 'aciertos'}`;
}

function renderExamCase() {
  if (!exam || exam.index >= exam.cases.length) return finishExam();
  updateExamHeader();
  const mount = $('#examStage');
  mount.innerHTML = `<div class="panel exam-card"><div class="exam-progress"><span style="width:${(exam.index / exam.cases.length) * 100}%"></span></div><div data-exam-case></div><div class="exam-next-row" data-exam-next></div></div>`;
  const caseMount = $('[data-exam-case]', mount);
  exam.answeredCurrent = false;
  renderCaseExperience(exam.cases[exam.index], {
    mode: 'exam',
    mount: caseMount,
    examMode: true,
    onExamAnswered: ({ item, selected, correct, hinted }) => {
      if (exam.answeredCurrent) return;
      exam.answeredCurrent = true;
      if (correct) exam.score += 1;
      exam.results.push({ id: item.id, title: item.title, selected, correct, hinted, correctText: item.options[item.correctIndex] });
      state.answers[item.id] = { selected, correct, hinted, at: new Date().toISOString() };
      saveState();
      void recordCaseAttempt(item, correct);
      updateStats();
      updateExamHeader();
      $('[data-exam-next]', mount).innerHTML = `<button type="button" class="btn primary" id="nextExamBtn">${exam.index === exam.cases.length - 1 ? 'Ver resultado' : 'Siguiente caso →'}</button>`;
      $('#nextExamBtn').addEventListener('click', () => { exam.index += 1; renderExamCase(); });
    },
  });
}

function finishExam() {
  if (!exam) return;
  if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  $('#examStage').hidden = true;
  const results = $('#examResults');
  results.hidden = false;
  const pct = Math.round((exam.score / exam.cases.length) * 100);
  results.innerHTML = `
    <div class="panel result-card">
      <span class="eyebrow">RESULTADO</span>
      <h2>Entrenamiento completado</h2>
      <div class="result-score">${exam.score}/${exam.cases.length} · ${pct}%</div>
      <p>${pct >= 80 ? 'Buen reconocimiento de patrones. Revisa las preguntas falladas para consolidar el razonamiento.' : 'Repasa los hallazgos clave y vuelve a intentarlo. La repetición espaciada mejora la lectura sistemática.'}</p>
      <div class="result-list">${exam.results.map((result) => `<div class="result-row"><div><strong>${result.correct ? '✓' : '✕'} ${escapeHTML(result.title)}</strong><br><small>${result.correct ? 'Correcta' : `Correcta: ${escapeHTML(result.correctText)}`}${result.hinted ? ' · con pista' : ''}</small></div><span class="badge ${result.correct ? '' : 'muted'}">${result.correct ? 'Acierto' : 'Revisar'}</span></div>`).join('')}</div>
      <div class="hero-actions"><button class="btn primary" id="repeatExamBtn">Nuevo entrenamiento</button><button class="btn secondary" data-go-results="casos">Revisar banco</button></div>
    </div>`;
  $('#repeatExamBtn').addEventListener('click', () => {
    exam = null;
    results.hidden = true;
    $('#examIntro').hidden = false;
    updateExamHeader();
  });
  $('[data-go-results="casos"]').addEventListener('click', () => navigate('casos'));
  renderCaseGrid();
}


function snapshotSearch(items, query, fields, limit = 60) {
  const terms = normalizeSearchText(query).split(/\s+/).filter((x) => x.length > 2);
  if (!terms.length) return items.slice(0, limit);
  return items.filter((item) => {
    const hay = normalizeSearchText(fields.map((field) => {
      const value = item?.[field];
      if (Array.isArray(value)) return value.map((v)=>typeof v==='string'?v:JSON.stringify(v)).join(' ');
      return value || '';
    }).join(' '));
    return terms.some((term) => hay.includes(term));
  }).slice(0, limit);
}

function libraryDatasetLink(source) {
  if (source === 'vqarad') return 'https://huggingface.co/datasets/abhay2812/vqa-rad';
  if (source === 'roco') return 'https://huggingface.co/datasets/eltorio/ROCOv2-radiology';
  if (source === 'multicare') return multiCaReDatasetUrl();
  return '#casos';
}

function setLibrarySource(source, { run = true } = {}) {
  librarySource = ['radform','vqarad','roco','multicare'].includes(source) ? source : 'radform';
  $$('[data-library-source]').forEach((button)=>button.classList.toggle('is-active',button.dataset.librarySource===librarySource));
  const note=$('#librarySourceNote'); const hint=$('#libraryHint');
  const notes={
    radform:'<div class="status-box"><strong>Banco Radform.</strong> Casos educativos originales almacenados en la propia web: carga inmediata y sin dependencia externa.</div>',
    vqarad:'<div class="status-box"><strong>VQA-RAD · CC0 1.0.</strong> Imágenes radiológicas con preguntas y respuestas creadas por clínicos. Radform prepara una copia local durante el despliegue para evitar esperas.</div>',
    roco:'<div class="status-box"><strong>ROCOv2.</strong> Muestra local de un dataset de 79.789 imágenes radiológicas con pies de figura. Licencia del dataset: CC BY-NC-SA 4.0.</div>',
    multicare:'<div class="status-box"><strong>MultiCaRe.</strong> Muestra local de casos de PubMed Central Open Access. Si necesitas más, Radform puede intentar una búsqueda en vivo sin bloquear el resto de la app.</div>'
  };
  if(note) note.innerHTML=notes[librarySource];
  if(hint) hint.textContent = librarySource==='radform' ? 'El banco local funciona incluso si una fuente externa está caída.' : 'La copia preparada durante el despliegue se consulta primero; la red solo se usa como ampliación.';
  if(run) runLibrarySearch($('#libraryQuery')?.value || '', {reset:true,displayQuery:$('#libraryQuery')?.value || ''});
}

function localCaseLibraryCard(item) {
  return `<article class="library-card local-library-card">
    <button class="library-image-link case-thumb" data-library-open-case="${escapeHTML(item.id)}" aria-label="Abrir ${escapeHTML(item.title)}">
      ${hasFixedImage(item) ? `<img src="${escapeHTML(imageUrl(item))}" alt="${escapeHTML(item.image.alt)}" loading="lazy" referrerpolicy="no-referrer" />` : modalityPlaceholder(item,true)}
      <span>Abrir caso →</span>
    </button>
    <div class="library-card-body"><div class="meta-tags"><span class="tiny-badge">${escapeHTML(item.modality)}</span><span class="tiny-badge diff">${escapeHTML(item.anatomy)}</span></div><h3>${escapeHTML(item.title)}</h3><p class="library-caption">${escapeHTML(item.keyFinding)}</p><div class="atlas-license"><span>${escapeHTML(item.difficulty)} · caso educativo Radform</span></div></div>
  </article>`;
}

function externalLibraryCard(item, source) {
  const sourceUrl=item.sourceUrl || item.articleUrl || item.datasetUrl || libraryDatasetLink(source);
  const badge=source==='vqarad'?'VQA-RAD':source==='roco'?'ROCOv2':'MultiCaRe';
  const questions=Array.isArray(item.questions)?item.questions:[];
  const qText=questions.length ? `<div class="vqa-preview"><strong>${questions.length} preguntas asociadas</strong><p>${escapeHTML(questions[0]?.question||'')}</p><small>Respuesta: ${escapeHTML(questions[0]?.answer||'')}</small></div>` : '';
  return `<article class="library-card external-library-card">
    <a class="library-image-link" href="${escapeHTML(safeUrl(sourceUrl))}" target="_blank" rel="noreferrer">
      ${item.imageUrl ? `<img src="${escapeHTML(safeUrl(item.imageUrl))}" alt="${escapeHTML(item.caption || 'Imagen radiológica')}" loading="lazy" />` : '<div class="case-image-placeholder compact"><strong>IMG</strong><span>Fuente abierta</span></div>'}
      <span>Fuente ↗</span>
    </a>
    <div class="library-card-body"><div class="meta-tags"><span class="tiny-badge">${badge}</span>${item.organ?`<span class="tiny-badge diff">${escapeHTML(item.organ)}</span>`:''}</div><p class="library-caption">${escapeHTML(item.caption || item.context || 'Imagen radiológica')}</p>${qText}${item.context?`<p class="library-context">${escapeHTML(item.context)}</p>`:''}<div class="atlas-license"><span>${escapeHTML(item.license || 'Consultar fuente')}</span><a href="${escapeHTML(safeUrl(item.datasetUrl || libraryDatasetLink(source)))}" target="_blank" rel="noreferrer">dataset ↗</a></div></div>
  </article>`;
}

function filteredLocalCasesForLibrary(query) {
  const resolved=resolveOpenSearchQuery(query || '');
  const terms=normalizeSearchText(`${query} ${resolved}`).split(/\s+/).filter((x)=>x.length>2);
  if(!terms.length) return cases;
  return cases.filter((item)=>{
    const hay=normalizeSearchText([item.title,item.diagnosis,item.anatomy,item.modality,item.keyFinding,...(item.tags||[]),item.image?.searchQuery||''].join(' '));
    return terms.some((t)=>hay.includes(t));
  });
}

function sourceSnapshot(source) {
  if(source==='vqarad') return vqaRadSnapshot;
  if(source==='roco') return rocoSnapshot;
  if(source==='multicare') return multicareSnapshot;
  return [];
}

function renderLibrarySnapshot(source, query, { append=false }={}) {
  const grid=$('#libraryGrid'); const status=$('#libraryStatus'); const more=$('#libraryMoreBtn');
  const length=Number($('#libraryLength')?.value||24);
  let items=[];
  if(source==='radform') items=filteredLocalCasesForLibrary(query);
  else {
    const fields=source==='vqarad'?['id','organ','questions']:['caption','context','tag','license'];
    items=snapshotSearch(sourceSnapshot(source),resolveOpenSearchQuery(query),fields,9999);
  }
  if(!append){libraryRendered=0;grid.innerHTML='';}
  const slice=items.slice(libraryRendered,libraryRendered+length); libraryRendered+=slice.length;
  grid.insertAdjacentHTML('beforeend',slice.map((item)=>source==='radform'?localCaseLibraryCard(item):externalLibraryCard(item,source)).join(''));
  if(source==='radform') $$('[data-library-open-case]',grid).forEach((btn)=>{if(!btn.dataset.bound){btn.dataset.bound='1';btn.addEventListener('click',()=>openCase(btn.dataset.libraryOpenCase,{mode:'guided'}));}});
  const total=items.length;
  const datasetEmpty=source!=='radform' && sourceSnapshot(source).length===0;
  if(datasetEmpty){status.innerHTML=`<div class="status-box"><strong>Esta fuente no pudo prepararse durante el último despliegue.</strong> Radform sigue funcionando con sus ${cases.length} casos locales. <a href="${escapeHTML(safeUrl(libraryDatasetLink(source)))}" target="_blank" rel="noreferrer">Abrir la fuente ↗</a></div>`;more.hidden=true;return {total:0};}
  status.innerHTML=`<div class="status-box"><strong>${Math.min(libraryRendered,total)}</strong> de <strong>${total}</strong> resultados disponibles en ${source==='radform'?'el banco local':source==='vqarad'?'VQA-RAD':source==='roco'?'la muestra ROCOv2':'la muestra MultiCaRe'}.</div>`;
  more.hidden=libraryRendered>=total;
  return {total};
}

async function runLibrarySearch(query,{reset=true,displayQuery=null}={}) {
  const raw=String(query||'').trim();
  if(reset){libraryRendered=0;libraryLastQuery=resolveOpenSearchQuery(raw);libraryDisplayQuery=displayQuery||raw;}
  const effective=libraryLastQuery||raw;
  const initial=renderLibrarySnapshot(librarySource,effective,{append:!reset});
  // Only MultiCaRe gets a best-effort live search when the local deployment snapshot has no match.
  if(librarySource==='multicare' && initial.total===0 && effective && sourceSnapshot('multicare').length){
    return;
  }
  if(librarySource==='multicare' && sourceSnapshot('multicare').length===0 && effective){
    const status=$('#libraryStatus');
    status.innerHTML='<div class="status-box"><span class="loading-dot"></span> La copia local no está disponible; intentando MultiCaRe en línea…</div>';
    try{
      const result=await searchMultiCaRe(effective,{offset:0,length:Number($('#libraryLength')?.value||24)});
      if(result.results.length){$('#libraryGrid').innerHTML=result.results.map((x)=>externalLibraryCard(x,'multicare')).join('');status.innerHTML=`<div class="status-box"><strong>${result.results.length}</strong> resultados cargados en línea.</div>`;}
      else status.innerHTML=`<div class="status-box">No se encontraron resultados. <a href="${escapeHTML(safeUrl(multiCaReDatasetUrl()))}" target="_blank" rel="noreferrer">Abrir MultiCaRe ↗</a></div>`;
    }catch(error){status.innerHTML=`<div class="status-box error"><strong>MultiCaRe no respondió.</strong> El banco local de Radform sigue disponible. <a href="${escapeHTML(safeUrl(multiCaReDatasetUrl()))}" target="_blank" rel="noreferrer">Abrir MultiCaRe ↗</a></div>`;}
  }
}

function handleLibrarySearch(event){event?.preventDefault();const raw=$('#libraryQuery').value.trim();runLibrarySearch(raw,{reset:true,displayQuery:raw});}

function runSelectedLibraryTopic(){const topic=atlasTopics.find((entry)=>entry.id===$('#libraryTopic')?.value);if(!topic){toast('Selecciona un tema.');return;}$('#libraryQuery').value=topic.label;runLibrarySearch(topic.query,{reset:true,displayQuery:topic.label});}

function realMirCard(item) {
  return `<article class="mir-card real" data-real-mir-id="${escapeHTML(item.id)}">
    <div class="mir-card-top"><div class="meta-tags"><span class="tiny-badge">MIR ${escapeHTML(item.year || '')}</span><span class="tiny-badge diff">${escapeHTML(item.specialty || 'Medicina')}</span></div></div>
    <p class="mir-stem">${escapeHTML(item.question)}</p>
    <button type="button" class="text-btn" data-open-real-mir="${escapeHTML(item.id)}">Abrir pregunta →</button>
  </article>`;
}

function renderRealMirGrid(items) {
  mirRealItems = items;
  const grid = $('#mirRealGrid');
  if (!grid) return;
  grid.innerHTML = items.length ? items.map(realMirCard).join('') : '<div class="empty-state">No hay preguntas para esta búsqueda.</div>';
  $$('[data-open-real-mir]', grid).forEach((button) => button.addEventListener('click', () => openRealMirQuestion(button.dataset.openRealMir)));
}

function openRealMirQuestion(id) {
  const item = mirRealItems.find((entry) => entry.id === id) || mirOpenSnapshot.find((entry) => entry.id === id);
  if (!item) return;
  const dialog = $('#mirDialog');
  const mount = $('#mirDialogBody');
  let answered = false;
  let selected = null;
  const render = () => {
    const options = Array.isArray(item.options) ? item.options : [];
    mount.innerHTML = `<article class="mir-detail">
      <header class="case-detail-head"><div><span class="eyebrow">MIR REAL · ${escapeHTML(item.year || '')}</span><h2>${escapeHTML(item.specialty || 'Pregunta MIR')}</h2><div class="chip-row"><span class="chip">CasiMedicos / HiTZ</span><span class="chip">CC BY 4.0</span>${item.questionId ? `<span class="chip">Pregunta ${escapeHTML(item.questionId)}</span>` : ''}</div></div></header>
      <div class="case-question real-mir-detail"><p class="vignette">${escapeHTML(item.question)}</p>
        <div class="answer-list mir-answer-list">${options.map((option,index)=>{
          let cls=''; if(answered && item.correctIndex != null){ if(index===item.correctIndex) cls='correct'; else if(index===selected) cls='incorrect'; }
          return `<button type="button" class="answer-btn ${cls}" data-real-answer="${index}" ${answered?'disabled':''}><strong>${String.fromCharCode(65+index)}.</strong> ${escapeHTML(option)}</button>`;
        }).join('')}</div>
        ${answered ? `<div class="feedback ${selected === item.correctIndex ? 'good' : 'bad'}"><h4>${item.correctIndex == null ? 'Respuesta comentada' : selected === item.correctIndex ? '✓ Correcto' : `Respuesta correcta: ${escapeHTML(options[item.correctIndex] || '')}`}</h4><p>${escapeHTML(item.explanation || 'Consulta la explicación en la fuente original.')}</p><p class="source-note">Fuente: <a href="${escapeHTML(safeUrl(item.sourceUrl || casiMedicosDatasetUrl()))}" target="_blank" rel="noreferrer">CasiMedicos / HiTZ · CC BY 4.0 ↗</a></p></div>` : ''}
        <div class="mir-dialog-actions"><a class="btn secondary inline" href="${escapeHTML(safeUrl(item.sourceUrl || casiMedicosDatasetUrl()))}" target="_blank" rel="noreferrer">Fuente ↗</a></div>
      </div></article>`;
    $$('[data-real-answer]', mount).forEach((button)=>button.addEventListener('click',()=>{ if(answered)return; selected=Number(button.dataset.realAnswer); answered=true; render(); }));
  };
  render(); if (!dialog.open) dialog.showModal();
}

async function runRealMirSearch(query) {
  const q = String(query || '').trim();
  const status = $('#mirRealStatus');
  const limit = Number($('#mirRealLength')?.value || 40);
  status.innerHTML = `<div class="status-box"><span class="loading-dot"></span> Buscando “${escapeHTML(q)}” en MIR comentado…</div>`;
  try {
    const items = (await searchCasiMedicos(q, { lengthPerSplit: Math.min(100, Math.ceil(limit / 2)) })).slice(0, limit);
    renderRealMirGrid(items);
    status.innerHTML = `<div class="status-box"><strong>${items.length}</strong> preguntas encontradas · CasiMedicos/HiTZ · CC BY 4.0.</div>`;
  } catch (error) {
    const fallback = snapshotSearch(mirOpenSnapshot, q, ['question','explanation','specialty'], limit);
    renderRealMirGrid(fallback);
    status.innerHTML = fallback.length
      ? `<div class="status-box"><strong>${fallback.length}</strong> preguntas de la copia preparada durante el despliegue. La búsqueda en vivo no respondió ahora.</div>`
      : `<div class="status-box error"><strong>No se pudo consultar el banco MIR abierto ahora.</strong><br>${escapeHTML(error?.message || 'Error de red.')} <a href="${escapeHTML(safeUrl(casiMedicosDatasetUrl()))}" target="_blank" rel="noreferrer">Abrir conjunto original ↗</a></div>`;
  }
}

function setMirSource(mode) {
  mirSourceMode = mode === 'real' ? 'real' : 'radform';
  $('#mirLocalPanel').hidden = mirSourceMode !== 'radform';
  $('#mirRealPanel').hidden = mirSourceMode !== 'real';
  $$('[data-mir-source]').forEach((button) => button.classList.toggle('is-active', button.dataset.mirSource === mirSourceMode));
  $('#mirRandomBtn').hidden = mirSourceMode !== 'radform';
  if (mirSourceMode === 'real' && !mirRealLoaded) { mirRealLoaded = true; runRealMirSearch($('#mirRealQuery').value || 'radiografía'); }
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim();
}

const FREE_SEARCH_ALIASES = {
  'neumotorax': 'pneumothorax',
  'neumonia': 'pneumonia',
  'derrame pleural': 'pleural effusion',
  'edema pulmonar': 'pulmonary edema',
  'embolia pulmonar': 'pulmonary embolism CT angiography',
  'tromboembolismo pulmonar': 'pulmonary embolism CT angiography',
  'ictus': 'acute ischemic stroke',
  'infarto cerebral': 'acute ischemic stroke',
  'hemorragia cerebral': 'intracerebral hemorrhage',
  'hematoma subdural': 'subdural hematoma',
  'apendicitis': 'acute appendicitis',
  'colecistitis': 'acute cholecystitis',
  'colelitiasis': 'gallstones',
  'litiasis renal': 'renal stone',
  'calculo renal': 'renal stone',
  'trombosis venosa profunda': 'deep vein thrombosis ultrasound',
  'diseccion aortica': 'aortic dissection CT angiography',
  'aneurisma aortico': 'aortic aneurysm',
  'fractura': 'fracture radiograph',
  'luxacion': 'dislocation radiograph',
};

function resolveAtlasQuery(rawQuery, modality = 'all') {
  let query = resolveOpenSearchQuery(rawQuery);
  const hints = { XR: 'radiograph x-ray', CT: 'CT', MRI: 'MRI', US: 'ultrasound', MAMMO: 'mammography', ANGIO: 'angiography', PET: 'PET' };
  if (modality !== 'all' && hints[modality] && !normalizeSearchText(query).includes(normalizeSearchText(hints[modality].split(' ')[0]))) {
    query = `${query} ${hints[modality]}`;
  }
  if (!query) query = 'medical imaging radiology';
  return query;
}

function populateTopicFilters() {
  const anatomy = [...new Set(atlasTopics.map((topic) => topic.anatomy))].sort((a, b) => a.localeCompare(b, 'es'));
  const select = $('#topicAnatomy');
  anatomy.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function filteredTopics() {
  const anatomy = $('#topicAnatomy')?.value || 'all';
  const level = $('#topicLevel')?.value || 'all';
  const modality = $('#atlasModality')?.value || 'all';
  return atlasTopics.filter((topic) => (anatomy === 'all' || topic.anatomy === anatomy)
    && (level === 'all' || topic.level === level)
    && (modality === 'all' || topic.modality === modality));
}

function renderTopicList() {
  const items = filteredTopics();
  $('#topicCount').textContent = `${items.length}`;
  $('#topicList').innerHTML = items.map((topic) => `
    <button type="button" class="topic-item" data-topic-id="${escapeHTML(topic.id)}">
      <span><strong>${escapeHTML(topic.label)}</strong><small>${escapeHTML(topic.anatomy)} · ${escapeHTML(topic.level)}</small></span>
      <span class="tiny-badge">${escapeHTML(topic.modality)}</span>
    </button>`).join('');
  $$('[data-topic-id]', $('#topicList')).forEach((button) => button.addEventListener('click', () => {
    const topic = atlasTopics.find((entry) => entry.id === button.dataset.topicId);
    if (!topic) return;
    $('#atlasQuery').value = topic.label;
    $('#atlasModality').value = topic.modality;
    renderTopicList();
    runAtlasSearch(topic.query, { reset: true, displayQuery: topic.label });
    if (window.matchMedia('(max-width: 900px)').matches) setTopicDrawer(false);
  }));
}

function atlasCard(item) {
  const licenseLink = item.licenseUrl ? `<a href="${escapeHTML(safeUrl(item.licenseUrl))}" target="_blank" rel="noreferrer">${escapeHTML(item.license)}</a>` : escapeHTML(item.license || 'Consultar fuente');
  const sourceName = item.source || (String(item.sourcePage || '').includes('openi.nlm.nih.gov') ? 'Open-i (NLM)' : 'Wikimedia Commons');
  return `
    <article class="atlas-card">
      <a class="atlas-image-link" href="${escapeHTML(safeUrl(item.sourcePage))}" target="_blank" rel="noreferrer" title="Abrir fuente original">
        <img src="${escapeHTML(safeUrl(item.imageUrl))}" alt="${escapeHTML(item.description || item.title)}" loading="lazy" referrerpolicy="no-referrer" />
        <span>Ver fuente ↗</span>
      </a>
      <div class="atlas-card-body">
        <div class="meta-tags"><span class="tiny-badge">${escapeHTML(sourceName)}</span></div>
        <h3>${escapeHTML(item.title)}</h3>
        <p>${escapeHTML(item.description || 'Imagen médica abierta.')}</p>
        <div class="atlas-license"><span>${licenseLink}</span><span title="Autor o crédito">${escapeHTML(item.author || sourceName)}</span></div>
      </div>
    </article>`;
}

async function runAtlasSearch(query, { reset = true, displayQuery = null } = {}) {
  const status = $('#atlasStatus');
  const grid = $('#atlasGrid');
  const more = $('#atlasMoreBtn');
  atlasSource = $('#atlasSource')?.value || atlasSource || 'commons';
  const modality = $('#atlasModality')?.value || 'all';
  if (reset) {
    atlasContinuation = null;
    atlasOpenIStart = 1;
    atlasLastQuery = query;
    grid.innerHTML = '';
  }
  const sourceLabel = atlasSource === 'openi' ? 'Open-i (NLM)' : atlasSource === 'medpix' ? 'MedPix (NLM)' : 'Wikimedia Commons';
  status.innerHTML = `<div class="status-box"><span class="loading-dot"></span> Buscando en ${sourceLabel}: ${escapeHTML(displayQuery || $('#atlasQuery').value || query)}…</div>`;
  more.hidden = true;
  try {
    if (atlasSource === 'openi' || atlasSource === 'medpix') {
      const collection = atlasSource === 'medpix' ? 'mpx' : 'all';
      const result = await searchOpenI(atlasLastQuery || query, { modality, collection, start: reset ? 1 : atlasOpenIStart, count: 30 });
      atlasOpenIStart = result.nextStart || atlasOpenIStart;
      if (reset && !result.results.length) {
        status.innerHTML = '<div class="status-box">Open-i no devolvió imágenes para esta búsqueda. Prueba otro término o cambia de fuente.</div>';
        return;
      }
      grid.insertAdjacentHTML('beforeend', result.results.map(atlasCard).join(''));
      const shown = $$('.atlas-card', grid).length;
      status.innerHTML = `<div class="status-box"><strong>${shown}</strong> imágenes mostradas · ${atlasSource === 'medpix' ? 'MedPix vía Open-i' : 'Open-i'}, U.S. National Library of Medicine · sin API key.</div>`;
      more.hidden = result.results.length < 30;
      return;
    }

    const result = await searchCommonsImages(atlasLastQuery || query, { limit: 30, continuation: reset ? null : atlasContinuation });
    atlasContinuation = result.continuation;
    if (reset && !result.results.length) {
      status.innerHTML = '<div class="status-box">No se encontraron imágenes para esta búsqueda. Prueba otro término o una de las rutas rápidas.</div>';
      return;
    }
    grid.insertAdjacentHTML('beforeend', result.results.map((x) => ({ ...x, source: 'Wikimedia Commons' })).map(atlasCard).join(''));
    const shown = $$('.atlas-card', grid).length;
    status.innerHTML = `<div class="status-box"><strong>${shown}</strong> imágenes mostradas · Wikimedia Commons${atlasContinuation ? ' · puedes cargar más' : ''}.</div>`;
    more.hidden = !atlasContinuation;
  } catch (error) {
    if (atlasSource === 'openi' || atlasSource === 'medpix') {
      const fallback = snapshotSearch(openiSnapshot, atlasLastQuery || query, ['query','title','description'], 60);
      if (fallback.length) {
        grid.innerHTML = fallback.map(atlasCard).join('');
        status.innerHTML = `<div class="status-box"><strong>${fallback.length}</strong> imágenes de la copia Open-i preparada durante el despliegue. La consulta en vivo no respondió ahora.</div>`;
        return;
      }
      const external = openISearchUrl(atlasLastQuery || query, modality, atlasSource === 'medpix' ? 'mpx' : 'all');
      status.innerHTML = `<div class="status-box error"><strong>${atlasSource === 'medpix' ? 'MedPix/Open-i' : 'Open-i'} no respondió ahora.</strong><br>${escapeHTML(error?.message || 'Error de red.')} <a href="${escapeHTML(safeUrl(external))}" target="_blank" rel="noreferrer">Abrir búsqueda Open-i ↗</a></div>`;
      return;
    }
    const external = commonsSearchUrl(atlasLastQuery || query);
    status.innerHTML = `<div class="status-box error"><strong>No se pudo cargar Wikimedia Commons ahora.</strong><br>${escapeHTML(error?.message || 'Error de red.')} <a href="${escapeHTML(safeUrl(external))}" target="_blank" rel="noreferrer">Abrir búsqueda en Commons ↗</a></div>`;
  }
}

function handleAtlasSearch(event) {
  event.preventDefault();
  const raw = $('#atlasQuery').value.trim();
  const modality = $('#atlasModality').value;
  const query = resolveAtlasQuery(raw, modality);
  runAtlasSearch(query, { reset: true, displayQuery: raw });
}

async function shareRadform() {
  const data = { title: 'Radform', text: 'Radiología por casos, preguntas MIR, biblioteca clínica y atlas abierto de imagen médica.', url: `${location.origin}${location.pathname}` };
  try {
    if (navigator.share) await navigator.share(data);
    else {
      await navigator.clipboard.writeText(data.url);
      toast('Enlace copiado al portapapeles.');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') toast('No se pudo compartir el enlace.');
  }
}

function platformInstallInstructions() {
  const ua=navigator.userAgent || '';
  const standalone=window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone===true;
  if(standalone) return '<div class="install-step"><strong>Radform ya está instalada.</strong><span>La estás usando en modo aplicación.</span></div>';
  const isiOS=/iPad|iPhone|iPod/.test(ua) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  const isAndroid=/Android/.test(ua);
  if(isiOS) return '<ol><li>Abre Radform en <strong>Safari</strong>.</li><li>Pulsa <strong>Compartir</strong> (cuadrado con flecha hacia arriba).</li><li>Desplázate y toca <strong>Añadir a pantalla de inicio</strong>.</li><li>Confirma con <strong>Añadir</strong>. El icono de Radform aparecerá junto a tus apps.</li></ol>';
  if(isAndroid) return '<ol><li>Abre Radform en <strong>Chrome</strong>.</li><li>Pulsa el menú <strong>⋮</strong>.</li><li>Elige <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>.</li><li>Confirma la instalación.</li></ol>';
  return '<ol><li>Abre Radform en Chrome, Edge u otro navegador compatible.</li><li>Busca el icono de instalación en la barra de direcciones o abre el menú del navegador.</li><li>Selecciona <strong>Instalar Radform</strong>.</li><li>También puedes seguir utilizándola normalmente desde esta web.</li></ol>';
}

function openInstallDialog() {
  const dialog=$('#installDialog'); if(!dialog) return;
  $('#installInstructions').innerHTML=platformInstallInstructions();
  const native=$('#nativeInstallBtn');
  native.hidden=!installPrompt;
  if(!dialog.open) dialog.showModal();
}

async function triggerNativeInstall(){
  if(!installPrompt){openInstallDialog();return;}
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt=null;
  $('#installBtn').hidden=true;
  $('#nativeInstallBtn').hidden=true;
}

function setupPWA() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    $('#installBtn').hidden = false;
    const native=$('#nativeInstallBtn'); if(native) native.hidden=false;
  });
  $('#installBtn')?.addEventListener('click', triggerNativeInstall);
  $('#nativeInstallBtn')?.addEventListener('click', triggerNativeInstall);
  $('#installHelpBtn')?.addEventListener('click', openInstallDialog);
  $('#drawerInstallBtn')?.addEventListener('click', ()=>{setMobileMenu(false);openInstallDialog();});
  $('#aboutInstallBtn')?.addEventListener('click', openInstallDialog);
  $$('[data-close-install]').forEach((button)=>button.addEventListener('click',()=>$('#installDialog')?.close()));
  window.addEventListener('appinstalled', () => {
    $('#installBtn').hidden = true;
    if($('#installDialog')?.open) $('#installDialog').close();
    toast('Radform instalada.');
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
}

function bindEvents() {
  $('#accountBtn')?.addEventListener('click', () => openAccountDialog());
  $('#drawerAccountBtn')?.addEventListener('click', () => { setMobileMenu(false); openAccountDialog(); });
  $('#rankingAccountBtn')?.addEventListener('click', () => openAccountDialog());
  $$('[data-open-account]').forEach((button) => button.addEventListener('click', () => openAccountDialog()));
  $('#loginTabBtn')?.addEventListener('click', () => setAuthTab('login'));
  $('#signupTabBtn')?.addEventListener('click', () => setAuthTab('signup'));
  $('#loginForm')?.addEventListener('submit', handleLogin);
  $('#signupForm')?.addEventListener('submit', handleSignup);
  $('#forgotPasswordBtn')?.addEventListener('click', handleForgotPassword);
  $('#profileForm')?.addEventListener('submit', handleProfileSave);
  $('#recoveryForm')?.addEventListener('submit', handleRecovery);
  $('#signOutBtn')?.addEventListener('click', handleSignOut);
  $('#syncProgressBtn')?.addEventListener('click', () => syncLocalProgressToCloud({ silent: false }));
  $$('[data-rank-period]').forEach((button) => button.addEventListener('click', () => loadLeaderboard(button.dataset.rankPeriod)));
  $('#accountDialog')?.addEventListener('click', (event) => {
    const dialog = event.currentTarget;
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) dialog.close();
  });
  $('#menuBtn')?.addEventListener('click', () => setMobileMenu(!$('#mobileNav').classList.contains('is-open')));
  $('#mobileNavClose')?.addEventListener('click', () => setMobileMenu(false));
  $('#navOverlay')?.addEventListener('click', () => setMobileMenu(false));
  $$('.drawer-nav-link[data-route]').forEach((button) => button.addEventListener('click', () => { setMobileMenu(false); navigate(button.dataset.route); }));
  $('#topicDrawerBtn')?.addEventListener('click', () => setTopicDrawer(!$('#topicPanel').classList.contains('is-open')));
  $('#topicDrawerClose')?.addEventListener('click', () => setTopicDrawer(false));
  $('#topicOverlay')?.addEventListener('click', () => setTopicDrawer(false));
  $('#caseFiltersBtn')?.addEventListener('click', () => toggleMobileFilter('#caseFilters', '#caseFiltersBtn'));
  $('#mirFiltersBtn')?.addEventListener('click', () => toggleMobileFilter('#mirFilters', '#mirFiltersBtn'));
  $('#caseFiltersClose')?.addEventListener('click', () => setMobileFilter('#caseFilters', '#caseFiltersBtn', false));
  $('#mirFiltersClose')?.addEventListener('click', () => setMobileFilter('#mirFilters', '#mirFiltersBtn', false));
  $('#filterOverlay')?.addEventListener('click', closeMobileFilters);
  $('#libraryTopicGo')?.addEventListener('click', runSelectedLibraryTopic);
  $('#atlasQuickGo')?.addEventListener('click', runAtlasQuickTopic);
  $('#atlasQuickTopic')?.addEventListener('change', () => { if ($('#atlasQuickTopic').value) runAtlasQuickTopic(); });
  if (window.matchMedia('(max-width: 900px)').matches) setTopicDrawer(false);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { setMobileMenu(false); setTopicDrawer(false); closeMobileFilters(); } });
  $$('.nav-link').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.route)));
  $$('[data-go]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.go)));
  $('#featuredOpen').addEventListener('click', () => featuredCase && openCase(featuredCase.id));
  $('#randomCaseBtn').addEventListener('click', () => openCase(shuffle(filteredCases().length ? filteredCases() : cases)[0]?.id));
  ['caseSearch', 'filterModality', 'filterAnatomy', 'filterDifficulty', 'filterFavorites'].forEach((id) => $(`#${id}`).addEventListener(id === 'caseSearch' ? 'input' : 'change', renderCaseGrid));
  $('#startExamBtn').addEventListener('click', startExam);
  ['mirSearch', 'mirArea', 'mirDifficulty', 'mirWithImage'].forEach((id) => $(`#${id}`)?.addEventListener(id === 'mirSearch' ? 'input' : 'change', renderMirGrid));
  $('#mirRandomBtn')?.addEventListener('click', () => { const pool = filteredMirQuestions(); const item = shuffle(pool.length ? pool : mirQuestions)[0]; if (item) openMirQuestion(item.id); });
  $$('[data-mir-source]').forEach((button) => button.addEventListener('click', () => setMirSource(button.dataset.mirSource)));
  $('#mirRealForm')?.addEventListener('submit', (event) => { event.preventDefault(); runRealMirSearch($('#mirRealQuery').value.trim()); });
  $('#mirRealPresetGo')?.addEventListener('click', () => { const q = $('#mirRealPresetSelect')?.value || 'imagen'; $('#mirRealQuery').value = q; runRealMirSearch(q); });
  $$('[data-mir-real-preset]').forEach((button) => button.addEventListener('click', () => { $('#mirRealQuery').value = button.dataset.mirRealPreset; runRealMirSearch(button.dataset.mirRealPreset); }));
  $('#libraryForm')?.addEventListener('submit', handleLibrarySearch);
  $$('[data-library-source]').forEach((button)=>button.addEventListener('click',()=>setLibrarySource(button.dataset.librarySource)));
  $('#libraryMoreBtn')?.addEventListener('click', () => runLibrarySearch(libraryLastQuery, { reset: false, displayQuery: libraryDisplayQuery }));
  $$('[data-library-preset]').forEach((button) => button.addEventListener('click', () => { const label = button.textContent.trim(); $('#libraryQuery').value = label; runLibrarySearch(button.dataset.libraryPreset, { reset: true, displayQuery: label }); }));
  $('#atlasForm').addEventListener('submit', handleAtlasSearch);
  $('#atlasMoreBtn').addEventListener('click', () => runAtlasSearch(atlasLastQuery, { reset: false }));
  $('#topicAnatomy').addEventListener('change', renderTopicList);
  $('#topicLevel').addEventListener('change', renderTopicList);
  $('#atlasModality').addEventListener('change', renderTopicList);
  $('#atlasSource')?.addEventListener('change', () => { atlasSource = $('#atlasSource').value; if (atlasLoaded) handleAtlasSearch(new Event('submit')); });
  $('#shareBtn').addEventListener('click', shareRadform);
  $('#caseDialog').addEventListener('close', closeCaseDialog);
  $('#installDialog')?.addEventListener('click', (event) => { const dialog=event.currentTarget; const rect=dialog.getBoundingClientRect(); const outside=event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom; if(outside) dialog.close(); });
  $('#mirDialog')?.addEventListener('click', (event) => { const dialog = event.currentTarget; const rect = dialog.getBoundingClientRect(); const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom; if (outside) dialog.close(); });
  $('#caseDialog').addEventListener('click', (event) => {
    const dialog = event.currentTarget;
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) dialog.close();
  });
  window.addEventListener('hashchange', () => {
    const locationState = parseLocation();
    navigate(locationState.route, { updateHash: false });
    if (locationState.caseId && !$('#caseDialog').open) openCase(locationState.caseId);
  });
}

async function init() {
  try {
    const [caseResponse, topicResponse, mirResponse, openiResponse, multicareResponse, mirOpenResponse, vqaResponse, rocoResponse] = await Promise.all([
      fetch('./data/cases.json'), fetch('./data/atlas-topics.json'), fetch('./data/mir-questions.json'),
      fetch('./data/openi-snapshot.json'), fetch('./data/multicare-snapshot.json'), fetch('./data/mir-open-snapshot.json'),
      fetch('./data/vqa-rad-snapshot.json'), fetch('./data/roco-snapshot.json')
    ]);
    if (!caseResponse.ok) throw new Error(`HTTP ${caseResponse.status}`);
    cases = await caseResponse.json();
    if (!Array.isArray(cases) || !cases.length) throw new Error('Banco de casos vacío.');
    if (topicResponse.ok) { atlasTopics = await topicResponse.json(); if (!Array.isArray(atlasTopics)) atlasTopics = []; }
    if (mirResponse.ok) { mirQuestions = await mirResponse.json(); if (!Array.isArray(mirQuestions)) mirQuestions = []; }
    if (openiResponse.ok) { const data = await openiResponse.json(); openiSnapshot = Array.isArray(data?.results) ? data.results : []; }
    if (multicareResponse.ok) { const data = await multicareResponse.json(); multicareSnapshot = Array.isArray(data?.results) ? data.results : []; }
    if (mirOpenResponse.ok) { const data = await mirOpenResponse.json(); mirOpenSnapshot = Array.isArray(data?.results) ? data.results : []; }
    if (vqaResponse.ok) { const data = await vqaResponse.json(); vqaRadSnapshot = Array.isArray(data?.results) ? data.results : []; }
    if (rocoResponse.ok) { const data = await rocoResponse.json(); rocoSnapshot = Array.isArray(data?.results) ? data.results : []; }
  } catch (error) {
    document.body.innerHTML = `<main class="container"><div class="panel status-box error"><h1>Radform no pudo cargar el banco de casos</h1><p>${escapeHTML(error?.message || 'Error desconocido')}</p><p>Abre el proyecto mediante un servidor HTTP (no como archivo local) o comprueba <code>data/cases.json</code>.</p></div></main>`;
    return;
  }

  populateAnatomyFilter();
  populateMirAreaFilter();
  populateTopicFilters();
  populateLibraryTopicControls();
  if ($('#libraryRadformCount')) $('#libraryRadformCount').textContent = String(cases.length);
  setLibrarySource('radform', {run:false});
  populateAtlasQuickTopic();
  renderTopicList();
  renderFeatured();
  renderCaseGrid();
  renderMirGrid();
  if ($('#mirLocalBadge')) $('#mirLocalBadge').textContent = String(mirQuestions.length);
  setMirSource('radform');
  updateStats();
  bindEvents();
  setupPWA();
  renderAccountUI();
  void initCloud();

  const locationState = parseLocation();
  navigate(locationState.route, { updateHash: false });
  if (locationState.caseId) openCase(locationState.caseId);
}

init();
