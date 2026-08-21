const EXAM_ROOT = './data/exams';
const examState = { manifest: null, imageCache: new Map(), current: null };

const exam$ = (sel, root=document) => root.querySelector(sel);
const exam$$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const examEsc = (v='') => String(v)
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'","&#039;");

async function examLoadJson(url){
  const response = await fetch(url, { cache: 'no-store' });
  if(!response.ok) throw new Error(`No se pudo cargar ${url}`);
  return response.json();
}

function examScrollTop(){
  window.requestAnimationFrame(() => {
    const view = exam$('.exam-prep-view.is-active');
    if(!view) return;
    const offset = (exam$('.topbar')?.offsetHeight || 0) + 8;
    const y = Math.max(0, view.getBoundingClientRect().top + window.scrollY - offset);
    window.scrollTo({ top: y, left: 0, behavior: 'auto' });
  });
}

function examCloseDrawer(){
  const drawer = exam$('#mobileNav');
  const overlay = exam$('#navOverlay');
  drawer?.classList.remove('is-open','open');
  drawer?.setAttribute('aria-hidden','true');
  if(overlay) overlay.hidden = true;
  exam$('#menuBtn')?.setAttribute('aria-expanded','false');
  document.body.classList.remove('drawer-open');
}

function examAddNavButton(kind, label, icon){
  const topMir = exam$('.nav [data-route="mir"]');
  if(topMir && !document.querySelector(`[data-exam-route="${kind}"].nav-link`)){
    const button = document.createElement('button');
    button.className = 'nav-link exam-nav-link';
    button.type = 'button';
    button.dataset.examRoute = kind;
    button.textContent = label;
    topMir.before(button);
  }
  const drawerMir = exam$('#mobileNav .drawer-nav [data-route="mir"]');
  if(drawerMir && !document.querySelector(`[data-exam-route="${kind}"].drawer-nav-link`)){
    const button = document.createElement('button');
    button.className = 'drawer-nav-link';
    button.type = 'button';
    button.dataset.examRoute = kind;
    button.innerHTML = `<span class="exam-menu-glyph">${examEsc(icon)}</span><span>${examEsc(label)}</span>`;
    drawerMir.before(button);
  }
}

function examEnsureViews(){
  const main = exam$('#main');
  if(!main) return;
  for(const kind of ['ebir','edir']){
    if(exam$(`[data-view="${kind}"]`)) continue;
    const section = document.createElement('section');
    section.className = 'view exam-prep-view';
    section.dataset.view = kind;
    section.innerHTML = `<div class="container exam-prep-container" id="${kind}ExamRoot"></div>`;
    main.append(section);
  }
}

function examShowView(kind){
  exam$$('.view').forEach(v => v.classList.remove('is-active'));
  exam$(`[data-view="${kind}"]`)?.classList.add('is-active');
  exam$$('.nav-link').forEach(b => b.classList.toggle('is-active', b.dataset.examRoute === kind));
  exam$$('.drawer-nav-link').forEach(b => b.classList.toggle('is-active', b.dataset.examRoute === kind));
  examCloseDrawer();
  examScrollTop();
}

function examResourceButtons(links=[]){
  return links.map(item => `<a class="exam-resource-link" href="${examEsc(item.url)}" target="_blank" rel="noreferrer">${examEsc(item.label)} ↗</a>`).join('');
}

function examRenderLanding(kind){
  const cfg = examState.manifest?.[kind];
  const root = exam$(`#${kind}ExamRoot`);
  if(!cfg || !root) return;
  const isEbir = kind === 'ebir';
  root.innerHTML = `
    <div class="exam-hero">
      <div>
        <span class="exam-kicker">${examEsc(cfg.scope)}</span>
        <h1>${examEsc(cfg.name)}</h1>
        <p class="exam-fullname">${examEsc(cfg.fullName)}</p>
        <p class="exam-intro">${isEbir
          ? 'Preparación específica de radiología intervencionista, con escenarios clínicos secuenciales y práctica clínica general.'
          : 'Preparación de radiodiagnóstico general con MRQ, Short Cases y CORE Cases.'}</p>
      </div>
      <div class="exam-badge">${isEbir ? 'IR' : 'RAD'}</div>
    </div>

    <section class="exam-info-card">
      <div class="exam-info-head">
        <div><span class="exam-eyebrow">FORMATO OFICIAL</span><h2>Cómo es el examen</h2></div>
        <span class="exam-official-pill">Fuente oficial</span>
      </div>
      <ul>${(cfg.officialSummary || []).map(x => `<li>${examEsc(x)}</li>`).join('')}</ul>
      <div class="exam-language-note"><strong>Idioma de los simulacros Radform: English</strong><span>${examEsc(cfg.languageNote || '')}</span></div>
      <div class="exam-resource-row">${examResourceButtons(cfg.officialLinks || [])}</div>
    </section>

    <section class="exam-notice">
      <strong>Material de entrenamiento, no banco oficial</strong>
      <p>${examEsc(examState.manifest.legalNotice || '')}</p>
    </section>

    <div class="exam-list-head">
      <div><span class="exam-eyebrow">PRACTICE SETS</span><h2>Simulacros Radform</h2></div>
      <span class="exam-no-ranking">No afectan a la clasificación</span>
    </div>
    <div class="exam-list" id="${kind}ExamList"><div class="exam-loading">Cargando simulacros…</div></div>`;
  void examRenderCards(kind);
}

async function examRenderCards(kind){
  const cfg = examState.manifest?.[kind];
  const target = exam$(`#${kind}ExamList`);
  if(!cfg || !target) return;
  const loaded = [];
  const failed = [];
  for(const file of cfg.examFiles || []){
    try{
      const exam = await examLoadJson(`${EXAM_ROOT}/${file}`);
      loaded.push({ exam, file });
    }catch(error){
      failed.push(file);
      console.error(error);
    }
  }
  target.innerHTML = loaded.map(({exam,file}, i) => `
    <button class="exam-card" type="button" data-start-exam="${examEsc(exam.id)}" data-file="${examEsc(file)}">
      <span class="exam-number">${String(i + 1).padStart(2,'0')}</span>
      <span class="exam-card-copy"><strong>${examEsc(exam.title)}</strong><small>${examEsc(exam.subtitle)}</small></span>
      <span class="exam-arrow">→</span>
    </button>`).join('');
  if(!loaded.length){
    target.innerHTML = '<div class="exam-loading exam-load-error">No se pudieron cargar los simulacros. Recarga la página e inténtalo de nuevo.</div>';
  }else if(failed.length){
    target.insertAdjacentHTML('beforeend', `<div class="exam-loading exam-load-error">Hay ${failed.length} simulacro(s) temporalmente no disponible(s).</div>`);
  }
}

function examFlatten(exam){
  const items = [];
  for(const section of exam.sections || []){
    if(section.type === 'standalone'){
      (section.questions || []).forEach((question, questionIndex) => items.push({ section, question, caseObj: null, caseIndex: null, questionIndex }));
    }else{
      (section.cases || []).forEach((caseObj, caseIndex) => {
        (caseObj.questions || []).forEach((question, questionIndex) => items.push({ section, question, caseObj, caseIndex, questionIndex }));
      });
    }
  }
  return items;
}

function examQuestionImage(question){
  const meta = examState.imageCache.get(question.imageKey || question.id);
  if(meta?.imageUrl){
    return `<figure class="exam-image">
      <img src="${examEsc(meta.imageUrl)}" alt="${examEsc(meta.description || 'Radiology image')}" loading="eager" />
      <figcaption>${examEsc(meta.author || 'Open source')} · ${examEsc(meta.license || 'Open licence')}${meta.sourcePage ? ` · <a href="${examEsc(meta.sourcePage)}" target="_blank" rel="noreferrer">source ↗</a>` : ''}</figcaption>
    </figure>`;
  }
  if(question.imageFile || question.imageQuery){
    return '<div class="exam-image-missing">La imagen abierta de esta pregunta aún no está en la caché local. Ejecuta “Actualizar biblioteca médica” después de instalar esta versión.</div>';
  }
  return '';
}

function examRenderOptions(question, answer){
  if(question.type === 'order'){
    const order = answer?.order || question.options.map((_,i) => i);
    return `<div class="exam-order-list">${order.map((idx,pos) => `
      <div class="exam-order-row" data-order-index="${idx}">
        <span class="exam-order-num">${pos + 1}</span>
        <span>${examEsc(question.options[idx])}</span>
        <span class="exam-order-actions">
          <button type="button" data-order-move="up" ${pos === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button type="button" data-order-move="down" ${pos === order.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
        </span>
      </div>`).join('')}</div>`;
  }
  const multiple = question.type === 'multiple';
  return `<div class="exam-options">${question.options.map((option,i) => `
    <label class="exam-option">
      <input type="${multiple ? 'checkbox' : 'radio'}" name="exam-answer" value="${i}" ${answer?.selected?.includes(i) ? 'checked' : ''} />
      <span class="exam-option-letter">${String.fromCharCode(65 + i)}</span>
      <span>${examEsc(option)}</span>
    </label>`).join('')}</div>`;
}

function examReadAnswer(question){
  if(question.type === 'order'){
    const order = exam$$('.exam-order-row').map(row => Number(row.dataset.orderIndex));
    return order.length ? { order } : null;
  }
  const selected = exam$$('input[name="exam-answer"]:checked').map(input => Number(input.value));
  return selected.length ? { selected } : null;
}

function examExactCorrect(question, answer){
  if(!answer) return false;
  const got = question.type === 'order' ? (answer.order || []) : (answer.selected || []);
  const expected = question.correct || [];
  return got.length === expected.length && got.every((value, i) => value === expected[i]);
}

function examProportionalScore(question, answer){
  if(!answer) return 0;
  if(question.type !== 'multiple') return examExactCorrect(question, answer) ? 1 : 0;
  const correct = new Set(question.correct || []);
  const selected = new Set(answer.selected || []);
  const totalCorrect = Math.max(1, correct.size);
  const totalIncorrect = Math.max(1, (question.options || []).length - correct.size);
  let selectedCorrect = 0;
  let selectedIncorrect = 0;
  selected.forEach(index => correct.has(index) ? selectedCorrect++ : selectedIncorrect++);
  return Math.max(0, Math.min(1, selectedCorrect / totalCorrect - selectedIncorrect / totalIncorrect));
}

function examQuestionScore(item, answer, examKind){
  if(examKind === 'edir' && ['standalone','shortcases','core'].includes(item.section.type)){
    return examProportionalScore(item.question, answer);
  }
  return examExactCorrect(item.question, answer) ? 1 : 0;
}

function examUnsafeSelected(question, answer){
  const unsafe = new Set(question.unsafeOptions || []);
  return (answer?.selected || []).some(index => unsafe.has(index));
}

function examCanGoBack(current, previous){
  if(!previous || !current) return false;
  if(current.section.id !== previous.section.id) return false;
  if(current.section.type === 'sequential' || current.section.type === 'core') return false;
  return true;
}

function examRenderRunner(){
  const current = examState.current;
  if(!current) return;
  const item = current.items[current.index];
  if(!item){ examRenderFinal(); return; }
  const question = item.question;
  const answer = current.answers[current.index] || null;
  const previous = current.items[current.index - 1];
  const canBack = current.index > 0 && examCanGoBack(item, previous);
  const sequential = item.section.type === 'sequential' || item.section.type === 'core';
  const progress = Math.round(((current.index + 1) / current.items.length) * 100);
  const root = exam$(`#${current.exam.kind}ExamRoot`);
  if(!root) return;

  root.innerHTML = `
    <div class="exam-runner-top">
      <button type="button" class="exam-back-link" data-exit-exam>← Salir del simulacro</button>
      <span class="exam-progress-label">${current.index + 1}/${current.items.length}</span>
    </div>
    <div class="exam-progress"><span style="width:${progress}%"></span></div>
    <div class="exam-runner-grid">
      <aside class="exam-context-card">
        <span class="exam-eyebrow">${examEsc(item.section.title)}</span>
        ${item.caseObj ? `<h3>${examEsc(item.caseObj.title)}</h3><p>${examEsc(item.caseObj.stem)}</p>` : `<h3>${examEsc(current.exam.title)}</h3>`}
        ${sequential ? '<div class="exam-sequential-note">Secuencial: al pulsar <strong>Confirm and continue</strong> no podrás volver a esta pregunta.</div>' : '<div class="exam-sequential-note is-neutral">En esta sección puedes volver a preguntas anteriores del mismo bloque.</div>'}
      </aside>
      <article class="exam-question-card">
        ${question.newInfo ? `<div class="exam-new-info"><strong>Additional information</strong><p>${examEsc(question.newInfo)}</p></div>` : ''}
        <div class="exam-question-meta">
          <span>${question.type === 'single' ? 'Single best answer' : question.type === 'multiple' ? 'Choose all that apply' : 'Place in the correct order'}</span>
          ${item.caseObj ? `<span>Question ${item.questionIndex + 1}/${item.caseObj.questions.length}</span>` : ''}
        </div>
        <h2>${examEsc(question.question)}</h2>
        ${examQuestionImage(question)}
        <div id="examAnswerArea">${examRenderOptions(question, answer)}</div>
        <div class="exam-runner-actions">
          ${canBack ? '<button type="button" class="exam-secondary" data-prev-question>← Previous</button>' : '<span></span>'}
          <button type="button" class="exam-primary" data-confirm-answer>Confirm and continue →</button>
        </div>
        <div class="exam-error" id="examError" hidden></div>
      </article>
    </div>`;
  examScrollTop();
}

function examFormatSelected(question, answer){
  if(!answer) return 'No answer';
  if(question.type === 'order') return (answer.order || []).map(i => question.options[i]).join(' → ');
  return (answer.selected || []).map(i => question.options[i]).join(' · ') || 'No answer';
}

function examFormatCorrect(question){
  if(question.type === 'order') return (question.correct || []).map(i => question.options[i]).join(' → ');
  return (question.correct || []).map(i => question.options[i]).join(' · ');
}

function examEdirScores(current){
  const mrqItems = current.items.map((item,index) => ({item,index})).filter(x => x.item.section.id === 'mrq');
  const mrq = mrqItems.length ? 100 * mrqItems.reduce((sum,x) => sum + examQuestionScore(x.item,current.answers[x.index],'edir'),0) / mrqItems.length : 0;

  const shortSection = (current.exam.sections || []).find(s => s.id === 'short-cases');
  const shortCaseScores = (shortSection?.cases || []).map(caseObj => {
    const rows = current.items.map((item,index) => ({item,index})).filter(x => x.item.caseObj?.id === caseObj.id);
    if(!rows.length) return 0;
    return 100 * rows.reduce((sum,x) => sum + examQuestionScore(x.item,current.answers[x.index],'edir'),0) / rows.length;
  });
  const shortCases = shortCaseScores.length ? shortCaseScores.reduce((a,b) => a + b,0) / shortCaseScores.length : 0;
  const written = 0.7 * mrq + 0.3 * shortCases;

  const coreSection = (current.exam.sections || []).find(s => s.id === 'core');
  const coreCases = (coreSection?.cases || []).map(caseObj => {
    const rows = current.items.map((item,index) => ({item,index})).filter(x => x.item.caseObj?.id === caseObj.id);
    const unsafe = rows.some(x => examUnsafeSelected(x.item.question,current.answers[x.index]));
    if(unsafe) return { id: caseObj.id, title: caseObj.title, score: 0, unsafe: true };
    const defaultWeight = rows.length ? 10 / rows.length : 0;
    const raw = rows.reduce((sum,x) => sum + examQuestionScore(x.item,current.answers[x.index],'edir') * Number(x.item.question.weight || defaultWeight),0);
    return { id: caseObj.id, title: caseObj.title, score: Math.min(10, raw), unsafe: false };
  });
  const coreAverage = coreCases.length ? coreCases.reduce((sum,x) => sum + x.score,0) / coreCases.length : 0;
  return { mrq, shortCases, written, coreCases, coreAverage, unsafeCount: coreCases.filter(x => x.unsafe).length };
}

function examRenderFinal(){
  const current = examState.current;
  if(!current) return;
  const root = exam$(`#${current.exam.kind}ExamRoot`);
  if(!root) return;
  const rows = current.items.map((item,index) => ({ item, index, score: examQuestionScore(item,current.answers[index],current.exam.kind) }));
  let scoreHtml = '';
  let noteHtml = '';

  if(current.exam.kind === 'edir'){
    const scores = examEdirScores(current);
    scoreHtml = `
      <div class="exam-score-grid">
        <div><strong>${scores.mrq.toFixed(1)}%</strong><span>MRQ</span></div>
        <div><strong>${scores.shortCases.toFixed(1)}%</strong><span>Short Cases</span></div>
        <div><strong>${scores.written.toFixed(1)}%</strong><span>Weighted written</span></div>
        <div><strong>${scores.coreAverage.toFixed(1)}/10</strong><span>CORE training avg.</span></div>
      </div>
      ${scores.unsafeCount ? `<div class="exam-unsafe-summary">⚠ ${scores.unsafeCount} CORE case(s) con una respuesta marcada como potencialmente <em>unsafe</em>.</div>` : ''}`;
    noteHtml = '<p class="exam-final-note">La fórmula MRQ y el peso 70% MRQ + 30% Short Cases reproducen la metodología publicada por EBR. El CORE de Radform es solo una aproximación educativa: en el EDiR real lo puntúan examinadores sobre 10 y el umbral de aprobado depende de la convocatoria. Radform no declara “aprobado/suspenso”.</p>';
  }else{
    const pct = rows.length ? 100 * rows.reduce((sum,x) => sum + x.score,0) / rows.length : 0;
    scoreHtml = `<div class="exam-score-ring"><strong>${pct.toFixed(0)}%</strong><span>${rows.filter(x => x.score === 1).length}/${rows.length}</span></div>`;
    noteHtml = '<p class="exam-final-note">Resultado orientativo de entrenamiento. Radform no reproduce el proceso oficial de estandarización/corrección de CIRSE y no emite un resultado oficial de aprobado/suspenso.</p>';
  }

  root.innerHTML = `
    <div class="exam-final">
      <span class="exam-eyebrow">SIMULACRO COMPLETADO</span>
      <h1>${examEsc(current.exam.title)}</h1>
      ${scoreHtml}
      ${noteHtml}
      <div class="exam-review-list">
        ${rows.map((row,n) => {
          const q = row.item.question;
          const answer = current.answers[row.index];
          const exact = examExactCorrect(q,answer);
          const partial = current.exam.kind === 'edir' && row.score > 0 && row.score < 1;
          const unsafe = examUnsafeSelected(q,answer);
          const cls = unsafe ? 'is-unsafe' : exact ? 'is-correct' : partial ? 'is-partial' : 'is-wrong';
          const label = unsafe ? 'Potentially unsafe' : exact ? 'Correct' : partial ? `${Math.round(row.score * 100)}% partial credit` : 'Incorrect';
          return `<article class="exam-review-item ${cls}">
            <strong>${n + 1}. ${examEsc(q.question)}</strong>
            <span>${examEsc(label)}</span>
            <p><b>Your answer:</b> ${examEsc(examFormatSelected(q,answer))}</p>
            <p><b>Best answer:</b> ${examEsc(examFormatCorrect(q))}</p>
            <p>${examEsc(q.explanation || '')}</p>
          </article>`;
        }).join('')}
      </div>
      <div class="exam-final-actions">
        <button type="button" class="exam-secondary" data-restart-exam>Repetir simulacro</button>
        <button type="button" class="exam-primary" data-back-to-exams>Volver a simulacros</button>
      </div>
    </div>`;
  examScrollTop();
}

async function examStart(file){
  try{
    const exam = await examLoadJson(`${EXAM_ROOT}/${file}`);
    const items = examFlatten(exam);
    if(!items.length) throw new Error('El simulacro no contiene preguntas.');
    examState.current = { exam, file, items, index: 0, answers: [] };
    examShowView(exam.kind);
    examRenderRunner();
  }catch(error){
    console.error(error);
    const kind = file?.startsWith('edir-') ? 'edir' : 'ebir';
    examShowView(kind);
    const root = exam$(`#${kind}ExamRoot`);
    if(root) root.innerHTML = '<div class="exam-review-shell"><span class="exam-eyebrow">ERROR DE CARGA</span><h1>No se pudo abrir el simulacro</h1><p class="exam-final-note">Recarga la página e inténtalo de nuevo.</p><button type="button" class="exam-primary" data-back-to-exams>Volver</button></div>';
  }
}

document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-exam-route]');
  if(nav){
    event.preventDefault();
    event.stopImmediatePropagation();
    const kind = nav.dataset.examRoute;
    examShowView(kind);
    if(examState.manifest?.[kind]) examRenderLanding(kind);
    else exam$(`#${kind}ExamRoot`).innerHTML = '<div class="exam-loading">Cargando preparación de examen…</div>';
    return;
  }

  const start = event.target.closest('[data-start-exam]');
  if(start){ await examStart(start.dataset.file); return; }

  if(event.target.closest('[data-exit-exam]')){
    const kind = examState.current?.exam.kind || 'ebir';
    examState.current = null;
    examRenderLanding(kind);
    return;
  }

  const move = event.target.closest('[data-order-move]');
  if(move){
    const row = move.closest('.exam-order-row');
    const list = row?.parentElement;
    if(!row || !list) return;
    if(move.dataset.orderMove === 'up' && row.previousElementSibling) list.insertBefore(row,row.previousElementSibling);
    if(move.dataset.orderMove === 'down' && row.nextElementSibling) list.insertBefore(row.nextElementSibling,row);
    exam$$('.exam-order-row',list).forEach((r,i) => {
      r.querySelector('.exam-order-num').textContent = i + 1;
      const up = r.querySelector('[data-order-move="up"]');
      const down = r.querySelector('[data-order-move="down"]');
      if(up) up.disabled = i === 0;
      if(down) down.disabled = i === exam$$('.exam-order-row',list).length - 1;
    });
    return;
  }

  if(event.target.closest('[data-prev-question]')){
    if(examState.current?.index > 0){ examState.current.index--; examRenderRunner(); }
    return;
  }

  if(event.target.closest('[data-confirm-answer]')){
    const current = examState.current;
    if(!current) return;
    const item = current.items[current.index];
    const answer = examReadAnswer(item.question);
    if(!answer){
      const error = exam$('#examError');
      if(error){ error.hidden = false; error.textContent = 'Select an answer before continuing.'; }
      return;
    }
    current.answers[current.index] = answer;
    current.index += 1;
    if(current.index >= current.items.length) examRenderFinal();
    else examRenderRunner();
    return;
  }

  if(event.target.closest('[data-restart-exam]')){
    if(examState.current?.file) await examStart(examState.current.file);
    return;
  }

  if(event.target.closest('[data-back-to-exams]')){
    const kind = examState.current?.exam.kind || (exam$('.exam-prep-view.is-active')?.dataset.view || 'ebir');
    examState.current = null;
    examRenderLanding(kind);
    return;
  }

  if(event.target.closest('[data-route],[data-quiz-route]')){
    exam$$('.exam-prep-view').forEach(v => v.classList.remove('is-active'));
    exam$$('[data-exam-route]').forEach(b => b.classList.remove('is-active'));
  }
}, true);

async function examInit(){
  examEnsureViews();
  examAddNavButton('ebir','EBIR','IR');
  examAddNavButton('edir','EDiR','E');
  try{
    examState.manifest = await examLoadJson(`${EXAM_ROOT}/manifest.json`);
    const cache = await examLoadJson(`${EXAM_ROOT}/image-cache.json`).catch(() => ({results:[]}));
    (cache.results || []).forEach(item => examState.imageCache.set(item.key,item));
  }catch(error){ console.error(error); }
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void examInit(), {once:true});
else void examInit();
