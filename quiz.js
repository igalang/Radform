import { getSupabaseClient } from './supabase-client.js';

const QUIZ_STORAGE_KEY = 'radform-ranked-quiz-v1';
const quiz$ = (sel, root=document) => root.querySelector(sel);
const quiz$$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const quizEsc = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");

const rankedQuiz = {
  cases: [],
  imageCache: new Map(),
  client: null,
  session: null,
  attempted: new Set(),
  run: null,
};

function quizDifficulty(value){
  const v = String(value || '').toLocaleLowerCase('es');
  if(v.includes('avanz')) return 'advanced';
  if(v.includes('inter')) return 'intermediate';
  return 'basic';
}

function quizLocalAttempted(){
  try{
    const parsed = JSON.parse(localStorage.getItem(QUIZ_STORAGE_KEY) || '{}');
    return Array.isArray(parsed.attempted) ? parsed.attempted : [];
  }catch{ return []; }
}

function quizSaveLocalAttempt(id){
  const attempted = new Set(quizLocalAttempted());
  attempted.add(id);
  try{ localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify({attempted:[...attempted]})); }catch{}
}

function quizClearLocal(){
  try{ localStorage.removeItem(QUIZ_STORAGE_KEY); }catch{}
}

function quizCloseDrawer(){
  const drawer = quiz$('#mobileNav');
  const overlay = quiz$('#navOverlay');
  drawer?.classList.remove('is-open','open');
  drawer?.setAttribute('aria-hidden','true');
  if(overlay) overlay.hidden = true;
  quiz$('#menuBtn')?.setAttribute('aria-expanded','false');
  document.body.classList.remove('drawer-open');
}

function quizTransformNavigation(){
  quiz$$('[data-route="entrenar"]').forEach(button => {
    button.removeAttribute('data-route');
    button.dataset.quizRoute = 'quiz';
    if(button.classList.contains('drawer-nav-link')){
      const span = button.querySelector('span');
      if(span) span.textContent = 'Quiz';
      else button.textContent = 'Quiz';
    }else button.textContent = 'Quiz';
  });
  quiz$$('[data-go="entrenar"]').forEach(button => {
    button.removeAttribute('data-go');
    button.dataset.quizRoute = 'quiz';
    button.textContent = 'Empezar Quiz';
  });
}

function quizUpdateStaticCopy(){
  const hero = quiz$('.hero-copy > p');
  if(hero) hero.textContent = 'Casos clínicos breves, imágenes radiológicas abiertas, Quiz puntuable y preparación específica MIR, EBIR y EDiR para entrenar el razonamiento visual.';

  const rankingIntro = quiz$('[data-view="ranking"] .ranking-head p');
  if(rankingIntro) rankingIntro.textContent = 'La clasificación utiliza exclusivamente el Quiz puntuable. Casos, Preguntas MIR y simulacros EBIR/EDiR son modos de estudio y no modifican puntos, acierto ni número de intentos.';

  quiz$$('[data-view="ranking"] th').forEach(th => {
    if(th.textContent.trim() === 'Primeros intentos') th.textContent = 'Quiz respondidos';
  });
  const attemptsLabel = quiz$('#cloudAttempts')?.nextElementSibling;
  if(attemptsLabel) attemptsLabel.textContent = 'Quiz respondidos';

  const scoringRule = quiz$('.scoring-rule p');
  if(scoringRule) scoringRule.textContent = 'Cada pregunta del Quiz puede puntuar una sola vez por usuario. Después permanece disponible en Casos para estudiar, pero no vuelve a entrar en el banco puntuable.';

  const syncButton = quiz$('#syncProgressBtn');
  if(syncButton) syncButton.textContent = 'Sincronizar progreso de estudio';
  const accountNote = quiz$('.account-note');
  if(accountNote) accountNote.textContent = 'Radform no publica tu email. Casos y MIR pueden sincronizarse como progreso de estudio, pero solo el Quiz determina puntos y clasificación.';

  const installLegal = quiz$('#installDialog .legal');
  if(installLegal) installLegal.textContent = 'Instalar la PWA no obliga a crear una cuenta. Como invitado, favoritos y progreso permanecen en este navegador. Si inicias sesión, el Quiz puede sincronizarse para participar en la clasificación.';

  const aboutList = quiz$('[data-view="acerca"] .clean-list');
  if(aboutList) aboutList.innerHTML = `
    <li><strong>Casos:</strong> estudio libre de casos radiológicos; puedes repetirlos y no modifican la clasificación.</li>
    <li><strong>Quiz:</strong> único modo puntuable. Cada caso cuenta una sola vez por usuario y después desaparece del banco competitivo.</li>
    <li><strong>EBIR:</strong> simulacros originales Radform de radiología intervencionista, en inglés y separados del ranking.</li>
    <li><strong>EDiR:</strong> práctica original de general radiology con MRQ, Short Cases y CORE, en inglés y sin puntos de ranking.</li>
    <li><strong>Preguntas MIR:</strong> práctica específica en español; no afecta a la clasificación.</li>
    <li><strong>Biblioteca y Atlas:</strong> exploración de imagen médica abierta con atribución y licencias.</li>
    <li><strong>Clasificación:</strong> 10, 20 o 30 puntos por respuesta correcta del Quiz según dificultad. Las preguntas incorrectas cuentan en la precisión, pero no restan puntos.</li>`;

  const sourcesOwn = quiz$('[data-view="acerca"] .sources-card p');
  if(sourcesOwn && sourcesOwn.textContent.includes('Contenido propio de Radform')){
    sourcesOwn.innerHTML = '<strong>Contenido propio de Radform.</strong> Las viñetas, preguntas, explicaciones, casos, Quiz y simulacros identificados como Radform son material educativo original. EBIR y EDiR no contienen bancos oficiales ni material de pago reproducido; los recursos oficiales se enlazan por separado.';
  }
}

function quizEnsureView(){
  const main = quiz$('#main');
  if(!main || quiz$('[data-view="quiz"]')) return;
  const section = document.createElement('section');
  section.className = 'view quiz-view';
  section.dataset.view = 'quiz';
  section.innerHTML = '<div class="container quiz-container" id="rankedQuizRoot"></div>';
  main.append(section);
}

function quizEnsureResetButton(){
  const actions = quiz$('#authLoggedIn .account-actions');
  if(!actions || quiz$('#resetQuizBtn')) return;
  const button = document.createElement('button');
  button.id = 'resetQuizBtn';
  button.className = 'btn quiz-reset-btn';
  button.type = 'button';
  button.textContent = 'Reiniciar progreso del Quiz';
  actions.insertBefore(button, quiz$('#signOutBtn'));
}

function quizShow(){
  quiz$$('.view').forEach(v => v.classList.remove('is-active'));
  quiz$('[data-view="quiz"]')?.classList.add('is-active');
  quiz$$('.nav-link,.drawer-nav-link').forEach(b => b.classList.toggle('is-active', b.dataset.quizRoute === 'quiz'));
  quizCloseDrawer();
  quizRenderHome();
  window.scrollTo({top:0,left:0,behavior:'auto'});
}

async function quizLoadData(){
  const [casesResponse, cacheResponse] = await Promise.all([
    fetch('./data/cases.json',{cache:'no-store'}),
    fetch('./data/case-image-cache.json',{cache:'no-store'}).catch(() => null),
  ]);
  if(casesResponse.ok) rankedQuiz.cases = await casesResponse.json();
  if(cacheResponse?.ok){
    const doc = await cacheResponse.json();
    (doc.results || []).forEach(item => rankedQuiz.imageCache.set(item.id,item));
  }
}

async function quizInitCloud(){
  try{
    rankedQuiz.client = await getSupabaseClient();
    const {data} = await rankedQuiz.client.auth.getSession();
    rankedQuiz.session = data?.session || null;
    rankedQuiz.client.auth.onAuthStateChange((_event,session) => {
      rankedQuiz.session = session || null;
      void quizRefreshAttempted().then(() => {
        if(quiz$('[data-view="quiz"]')?.classList.contains('is-active')) quizRenderHome();
      });
    });
  }catch(error){
    console.warn('Quiz cloud:', error);
    rankedQuiz.client = null;
    rankedQuiz.session = null;
  }
  await quizRefreshAttempted();
}

async function quizRefreshAttempted(){
  const merged = new Set(quizLocalAttempted());
  if(rankedQuiz.client && rankedQuiz.session?.user){
    const {data,error} = await rankedQuiz.client.from('quiz_attempts').select('case_id');
    if(!error) (data || []).forEach(row => merged.add(row.case_id));
  }
  rankedQuiz.attempted = merged;
}

function quizRenderHome(){
  const root = quiz$('#rankedQuizRoot');
  if(!root) return;
  const logged = Boolean(rankedQuiz.session?.user);
  const total = rankedQuiz.cases.length;
  const done = rankedQuiz.attempted.size;
  root.innerHTML = `
    <div class="quiz-hero panel">
      <div>
        <span class="eyebrow">QUIZ PUNTUABLE</span>
        <h1>Una pregunta. Un intento. Una clasificación.</h1>
        <p>El Quiz es el único modo que suma puntos. Cada caso puede puntuar una sola vez; después sigue disponible en Casos para repaso, pero no vuelve a entrar en el banco competitivo.</p>
        <div class="quiz-rule-row"><span>✓ Solo una oportunidad puntuable</span><span>↺ Sin repeticiones competitivas</span><span>🏆 Solo Quiz entra en ranking</span></div>
      </div>
      <div class="quiz-counter"><strong>${done}</strong><span>completados</span></div>
    </div>
    <div class="quiz-status-card panel">
      <div><strong>${logged ? 'Cuenta conectada' : 'Modo invitado'}</strong><span>${logged ? 'Tus respuestas del Quiz se registran en tu clasificación.' : 'Puedes practicar, pero necesitas iniciar sesión para aparecer en el ranking.'}</span></div>
      <span>${done} respondidos · ${Math.max(0,total-done)} disponibles</span>
    </div>
    <div class="quiz-settings panel">
      <label><span>Modalidad</span><select id="rankedQuizModality"><option value="all">Todas</option><option value="XR">Radiografía</option><option value="CT">TC</option><option value="MRI">RM</option><option value="US">Ecografía</option></select></label>
      <label><span>Dificultad</span><select id="rankedQuizDifficulty"><option value="all">Todas</option><option value="Básico">Básico</option><option value="Intermedio">Intermedio</option><option value="Avanzado">Avanzado</option></select></label>
      <button class="btn primary" type="button" id="startRankedQuiz">Empezar Quiz · hasta 10 preguntas</button>
    </div>
    <div class="quiz-explain panel"><strong>Fuera de la clasificación</strong><p>Casos, Preguntas MIR, EBIR y EDiR son modos de estudio. Puedes repetirlos libremente sin alterar puntos, precisión, racha ni número de preguntas del ranking.</p></div>`;
}

function quizPool(){
  const modality = quiz$('#rankedQuizModality')?.value || 'all';
  const difficulty = quiz$('#rankedQuizDifficulty')?.value || 'all';
  return rankedQuiz.cases.filter(item => !rankedQuiz.attempted.has(item.id)
    && (modality === 'all' || item.modalityCode === modality)
    && (difficulty === 'all' || item.difficulty === difficulty));
}

function quizShuffle(items){
  const copy = [...items];
  for(let i = copy.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i],copy[j]] = [copy[j],copy[i]];
  }
  return copy;
}

function quizImage(item){
  const cached = rankedQuiz.imageCache.get(item.id);
  if(cached?.imageUrl){
    return `<figure class="quiz-image"><img src="${quizEsc(cached.imageUrl)}" alt="${quizEsc(cached.description || item.title)}" /><figcaption>${quizEsc(cached.author || 'Fuente abierta')} · ${quizEsc(cached.license || 'licencia abierta')}</figcaption></figure>`;
  }
  if(item.image?.file){
    const url = `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(item.image.file)}`;
    return `<figure class="quiz-image"><img src="${quizEsc(url)}" alt="${quizEsc(item.image.alt || item.title)}" /><figcaption>${quizEsc(item.image.author || 'Fuente abierta')} · ${quizEsc(item.image.license || 'consultar licencia')}</figcaption></figure>`;
  }
  return '';
}

function quizRenderQuestion(){
  const run = rankedQuiz.run;
  const root = quiz$('#rankedQuizRoot');
  if(!run || !root) return;
  if(run.index >= run.items.length){ quizRenderResult(); return; }
  const item = run.items[run.index];
  root.innerHTML = `
    <div class="quiz-top"><button type="button" class="text-btn" id="exitRankedQuiz">← Salir</button><span>${run.index + 1}/${run.items.length}</span></div>
    <div class="quiz-progress"><span style="width:${((run.index + 1)/run.items.length) * 100}%"></span></div>
    <article class="quiz-question panel">
      <div class="quiz-meta"><span>${quizEsc(item.modality)}</span><span>${quizEsc(item.anatomy)}</span><span>${quizEsc(item.difficulty)}</span></div>
      <p class="quiz-vignette">${quizEsc(item.vignette)}</p>
      ${quizImage(item)}
      <h2>${quizEsc(item.question)}</h2>
      <div class="quiz-options">${(item.options || []).map((option,index) => `<button type="button" class="quiz-option" data-quiz-answer="${index}"><span>${String.fromCharCode(65 + index)}</span>${quizEsc(option)}</button>`).join('')}</div>
      <div id="quizFeedback"></div>
    </article>`;
  window.scrollTo({top:0,left:0,behavior:'auto'});
}

async function quizRecordAttempt(item, correct){
  rankedQuiz.attempted.add(item.id);
  quizSaveLocalAttempt(item.id);
  if(!rankedQuiz.client || !rankedQuiz.session?.user) return {points:0,cloud:false};
  const {data,error} = await rankedQuiz.client.from('quiz_attempts').insert({
    case_id: item.id,
    difficulty: quizDifficulty(item.difficulty),
    is_correct: Boolean(correct),
  }).select('points').single();
  if(error){
    console.warn('Quiz attempt:', error);
    return {points:0,cloud:true,error:true};
  }
  return {points:Number(data?.points || 0),cloud:true};
}

async function quizAnswer(index){
  const run = rankedQuiz.run;
  if(!run || run.locked) return;
  run.locked = true;
  const item = run.items[run.index];
  const correct = index === item.correctIndex;
  const saved = await quizRecordAttempt(item,correct);
  run.results.push({id:item.id,correct,points:saved.points});
  if(correct) run.correct++;
  run.points += saved.points;
  quiz$$('.quiz-option').forEach((button,i) => {
    button.disabled = true;
    if(i === item.correctIndex) button.classList.add('correct');
    else if(i === index) button.classList.add('incorrect');
  });
  const feedback = quiz$('#quizFeedback');
  if(feedback) feedback.innerHTML = `<div class="quiz-feedback ${correct ? 'good' : 'bad'}">
    <strong>${correct ? 'Correcto' : 'Incorrecto'}</strong>
    <p>${quizEsc(item.explanation || item.keyFinding || '')}</p>
    <small>${saved.cloud ? (saved.points > 0 ? `+${saved.points} puntos` : (saved.error ? 'No se pudo registrar puntuación; esta pregunta queda bloqueada para evitar repeticiones competitivas.' : '0 puntos')) : 'Modo invitado · sin clasificación'}</small>
    <button class="btn primary" type="button" id="nextRankedQuiz">${run.index === run.items.length - 1 ? 'Ver resultado' : 'Siguiente →'}</button>
  </div>`;
}

function quizRenderResult(){
  const run = rankedQuiz.run;
  const root = quiz$('#rankedQuizRoot');
  if(!run || !root) return;
  const pct = run.items.length ? Math.round(run.correct / run.items.length * 100) : 0;
  root.innerHTML = `<div class="quiz-result panel">
    <span class="eyebrow">QUIZ COMPLETADO</span><h1>${pct}%</h1>
    <p>${run.correct}/${run.items.length} correctas · ${run.points} puntos obtenidos en esta sesión.</p>
    <p class="quiz-result-note">Estas preguntas ya no volverán a aparecer en tu Quiz puntuable. Puedes repasarlas libremente en Casos.</p>
    <div class="quiz-result-actions"><button class="btn secondary" type="button" id="quizBackHome">Volver al Quiz</button><button class="btn primary" type="button" data-route-ranking>Ver clasificación</button></div>
  </div>`;
}

function quizStart(){
  const pool = quizShuffle(quizPool());
  if(!pool.length){
    quiz$('#rankedQuizRoot')?.insertAdjacentHTML('beforeend','<div class="quiz-empty panel">No quedan preguntas puntuables con esos filtros. Cambia los filtros o utiliza Casos para repasar.</div>');
    return;
  }
  rankedQuiz.run = {items:pool.slice(0,10),index:0,correct:0,points:0,results:[],locked:false};
  quizRenderQuestion();
}

async function quizResetProgress(){
  if(!rankedQuiz.client || !rankedQuiz.session?.user){
    alert('Inicia sesión para reiniciar el progreso puntuable de tu cuenta.');
    return;
  }
  const ok = window.confirm('¿Reiniciar todo tu progreso del Quiz? Se borrarán únicamente tus intentos y puntos del Quiz. Tu cuenta, perfil, Casos, MIR, EBIR y EDiR no se borrarán.');
  if(!ok) return;
  const button = quiz$('#resetQuizBtn');
  if(button){ button.disabled = true; button.textContent = 'Reiniciando…'; }
  const {error} = await rankedQuiz.client.rpc('reset_my_quiz_progress');
  if(error){
    if(button){ button.disabled = false; button.textContent = 'Reiniciar progreso del Quiz'; }
    alert('No se pudo reiniciar el Quiz. Inténtalo de nuevo.');
    console.warn(error);
    return;
  }
  quizClearLocal();
  window.location.reload();
}

function quizObserveLegacyUI(){
  const toast = quiz$('#toast');
  if(toast){
    const observer = new MutationObserver(() => {
      if(/\+\d+\s+puntos.*primer intento/i.test(toast.textContent || '')){
        toast.textContent = 'Progreso de estudio guardado · no afecta a la clasificación';
      }
    });
    observer.observe(toast,{childList:true,characterData:true,subtree:true});
  }
  const cloudSummary = quiz$('#cloudHomeSummary');
  if(cloudSummary){
    const rewrite = () => {
      const text = cloudSummary.textContent || '';
      if(text.includes('primeros intentos')) cloudSummary.textContent = text.replace('primeros intentos','Quiz respondidos');
    };
    new MutationObserver(rewrite).observe(cloudSummary,{childList:true,characterData:true,subtree:true});
    rewrite();
  }
}

document.addEventListener('click', event => {
  const nav = event.target.closest('[data-quiz-route="quiz"]');
  if(nav){
    event.preventDefault();
    event.stopImmediatePropagation();
    quizShow();
    return;
  }
  if(event.target.closest('#startRankedQuiz')){ quizStart(); return; }
  if(event.target.closest('#exitRankedQuiz')){ rankedQuiz.run = null; quizRenderHome(); return; }
  const answer = event.target.closest('[data-quiz-answer]');
  if(answer){ void quizAnswer(Number(answer.dataset.quizAnswer)); return; }
  if(event.target.closest('#nextRankedQuiz')){
    if(!rankedQuiz.run) return;
    rankedQuiz.run.index++;
    rankedQuiz.run.locked = false;
    quizRenderQuestion();
    return;
  }
  if(event.target.closest('#quizBackHome')){
    rankedQuiz.run = null;
    void quizRefreshAttempted().then(quizRenderHome);
    return;
  }
  if(event.target.closest('[data-route-ranking]')){
    quiz$('[data-route="ranking"]')?.click();
    return;
  }
  if(event.target.closest('#resetQuizBtn')){ void quizResetProgress(); return; }
  if(event.target.closest('[data-route],[data-exam-route]')){
    quiz$('.quiz-view')?.classList.remove('is-active');
    quiz$$('[data-quiz-route]').forEach(b => b.classList.remove('is-active'));
  }
}, true);

async function quizInit(){
  quizTransformNavigation();
  quizUpdateStaticCopy();
  quizEnsureView();
  quizEnsureResetButton();
  quizObserveLegacyUI();
  await quizLoadData();
  await quizInitCloud();
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void quizInit(), {once:true});
else void quizInit();
