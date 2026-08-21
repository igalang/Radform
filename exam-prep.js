const EXAM_ROOT = './data/exams';
const state = { manifest: null, imageCache: new Map(), current: null };

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const esc = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");

function scrollExamTop(){
  window.requestAnimationFrame(() => {
    const view = $('.exam-prep-view.is-active');
    if(!view) return;
    const topbar = $('.topbar');
    const offset = (topbar?.offsetHeight || 0) + 8;
    const y = Math.max(0, view.getBoundingClientRect().top + window.scrollY - offset);
    window.scrollTo({top:y, left:0, behavior:'auto'});
  });
}

async function loadJson(url){
  const r = await fetch(url, {cache:'no-store'});
  if(!r.ok) throw new Error(`No se pudo cargar ${url}`);
  return r.json();
}

function addNavButton(kind, label, icon){
  const topMir = $('.nav [data-route="mir"]');
  if(topMir && !document.querySelector(`[data-exam-route="${kind}"].nav-link`)){
    const b=document.createElement('button');
    b.className='nav-link exam-nav-link';
    b.type='button';
    b.dataset.examRoute=kind;
    b.textContent=label;
    topMir.before(b);
  }
  const drawerMir = $('#mobileNav .drawer-nav [data-route="mir"]');
  if(drawerMir && !document.querySelector(`[data-exam-route="${kind}"].drawer-nav-link`)){
    const b=document.createElement('button');
    b.className='drawer-nav-link';
    b.type='button';
    b.dataset.examRoute=kind;
    b.innerHTML=`<span class="exam-menu-glyph">${esc(icon)}</span><span>${esc(label)}</span>`;
    drawerMir.before(b);
  }
}

function closeDrawer(){
  const drawer=$('#mobileNav');
  const overlay=$('#navOverlay');
  drawer?.classList.remove('is-open','open');
  drawer?.setAttribute('aria-hidden','true');
  if(overlay) overlay.hidden=true;
  $('#menuBtn')?.setAttribute('aria-expanded','false');
  // app.js locks page scrolling with body.drawer-open while the mobile menu is open.
  // Exam navigation is injected outside app.js, so we must release that lock here too.
  document.body.classList.remove('drawer-open');
}

function ensureViews(){
  const main=$('#main');
  if(!main) return;
  for(const kind of ['ebir','edir']){
    if($(`[data-view="${kind}"]`)) continue;
    const s=document.createElement('section');
    s.className='view exam-prep-view';
    s.dataset.view=kind;
    s.innerHTML=`<div class="container exam-prep-container" id="${kind}ExamRoot"></div>`;
    main.append(s);
  }
}

function showView(kind){
  $$('.view').forEach(v=>v.classList.remove('is-active'));
  const view=$(`[data-view="${kind}"]`);
  view?.classList.add('is-active');
  $$('.nav-link').forEach(b=>b.classList.toggle('is-active', b.dataset.examRoute===kind));
  $$('.drawer-nav-link').forEach(b=>b.classList.toggle('is-active', b.dataset.examRoute===kind));
  closeDrawer();
  scrollExamTop();
}

function resourceButtons(links=[]){
  return links.map(x=>`<a class="exam-resource-link" href="${esc(x.url)}" target="_blank" rel="noreferrer">${esc(x.label)} ↗</a>`).join('');
}

function renderLanding(kind){
  const cfg=state.manifest[kind];
  const root=$(`#${kind}ExamRoot`);
  if(!root) return;
  const isEbir=kind==='ebir';
  root.innerHTML=`
    <div class="exam-hero">
      <div>
        <span class="exam-kicker">${esc(cfg.scope)}</span>
        <h1>${esc(cfg.name)}</h1>
        <p class="exam-fullname">${esc(cfg.fullName)}</p>
        <p class="exam-intro">${isEbir
          ? 'Entrenamiento específico de radiología intervencionista con escenarios secuenciales y preguntas de práctica clínica.'
          : 'Entrenamiento de radiodiagnóstico general con MRQ, Short Cases y CORE Cases.'}</p>
      </div>
      <div class="exam-badge">${isEbir?'IR':'RAD'}</div>
    </div>

    <section class="exam-info-card">
      <div class="exam-info-head">
        <div><span class="exam-eyebrow">FORMATO OFICIAL</span><h2>Cómo es el examen</h2></div>
        <span class="exam-official-pill">Fuente oficial</span>
      </div>
      <ul>${cfg.officialSummary.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>
      <div class="exam-resource-row">${resourceButtons(cfg.officialLinks)}</div>
    </section>

    <section class="exam-notice">
      <strong>Importante</strong>
      <p>${esc(state.manifest.legalNotice)}</p>
    </section>

    <div class="exam-list-head">
      <div><span class="exam-eyebrow">ENTRENAMIENTO</span><h2>Simulacros Radform</h2></div>
      <span class="exam-no-ranking">No dan puntos de ranking</span>
    </div>
    <div class="exam-list" id="${kind}ExamList"><div class="exam-loading">Cargando simulacros…</div></div>`;
  renderExamCards(kind);
}

async function renderExamCards(kind){
  const cfg=state.manifest?.[kind];
  const target=$(`#${kind}ExamList`);
  if(!cfg || !target) return;

  const exams=[];
  const failed=[];
  for(const file of cfg.examFiles){
    try{
      const exam=await loadJson(`${EXAM_ROOT}/${file}`);
      exams.push({exam,file});
    }catch(err){
      failed.push(file);
      console.error(err);
    }
  }

  target.innerHTML=exams.map(({exam,file},i)=>`
    <button class="exam-card" type="button" data-start-exam="${esc(exam.id)}" data-file="${esc(file)}">
      <span class="exam-number">${String(i+1).padStart(2,'0')}</span>
      <span class="exam-card-copy">
        <strong>${esc(exam.title)}</strong>
        <small>${esc(exam.subtitle)}</small>
      </span>
      <span class="exam-arrow">→</span>
    </button>`).join('');

  if(!exams.length){
    target.innerHTML='<div class="exam-loading exam-load-error">No se pudieron cargar los simulacros. Recarga la página e inténtalo de nuevo.</div>';
  }else if(failed.length){
    target.insertAdjacentHTML('beforeend',
      `<div class="exam-loading exam-load-error">Hay ${failed.length} simulacro(s) temporalmente no disponible(s).</div>`);
  }
}

function flattenExam(exam){
  const items=[];
  exam.sections.forEach(section=>{
    if(section.type==='standalone'){
      section.questions.forEach(q=>items.push({kind:'question',section,question:q,caseObj:null,caseIndex:null,questionIndex:null}));
    }else{
      section.cases.forEach((c,ci)=>{
        c.questions.forEach((q,qi)=>items.push({kind:'question',section,question:q,caseObj:c,caseIndex:ci,questionIndex:qi}));
      });
    }
  });
  return items;
}

function questionImage(q){
  const meta=state.imageCache.get(q.imageKey || q.id);
  if(meta?.imageUrl){
    return `<figure class="exam-image"><img src="${esc(meta.imageUrl)}" alt="${esc(meta.description||'Imagen radiológica de apoyo')}" loading="eager">
      <figcaption>${esc(meta.author||'Wikimedia Commons')} · ${esc(meta.license||'Licencia abierta')}${meta.sourcePage?` · <a href="${esc(meta.sourcePage)}" target="_blank" rel="noreferrer">fuente ↗</a>`:''}</figcaption></figure>`;
  }
  if(q.imageQuery){
    return `<div class="exam-image-missing">Imagen de apoyo pendiente de caché local. El caso puede resolverse sin salir de Radform.</div>`;
  }
  return '';
}

function renderOptions(q, answer){
  if(q.type==='order'){
    const order=answer?.order || q.options.map((_,i)=>i);
    return `<div class="exam-order-list">${order.map((idx,pos)=>`
      <div class="exam-order-row" data-order-pos="${pos}">
        <span class="exam-order-num">${pos+1}</span>
        <span>${esc(q.options[idx])}</span>
        <span class="exam-order-actions">
          <button type="button" data-order-move="up" ${pos===0?'disabled':''}>↑</button>
          <button type="button" data-order-move="down" ${pos===order.length-1?'disabled':''}>↓</button>
        </span>
      </div>`).join('')}</div>`;
  }
  const multi=q.type==='multiple';
  return `<div class="exam-options">${q.options.map((opt,i)=>`
    <label class="exam-option">
      <input type="${multi?'checkbox':'radio'}" name="exam-answer" value="${i}" ${answer?.selected?.includes(i)?'checked':''}>
      <span class="exam-option-letter">${String.fromCharCode(65+i)}</span>
      <span>${esc(opt)}</span>
    </label>`).join('')}</div>`;
}

function currentAnswer(){
  const s=state.current;
  return s.answers[s.index] || null;
}

function renderRunner(){
  const s=state.current;
  const item=s.items[s.index];
  const q=item.question;
  const root=$(`#${s.exam.kind}ExamRoot`);
  const sequential=item.section.type==='sequential';
  const caseStart=sequential && item.questionIndex===0;
  const progress=Math.round(((s.index+1)/s.items.length)*100);
  const answer=currentAnswer();
  const previous=s.items[s.index-1];
  const canGoPrevious=Boolean(
    !sequential &&
    s.index>0 &&
    previous &&
    previous.section?.id===item.section?.id &&
    previous.section?.type==='standalone'
  );

  root.innerHTML=`
    <div class="exam-runner-top">
      <button type="button" class="exam-back-link" data-exit-exam>← Salir del simulacro</button>
      <span class="exam-progress-label">${s.index+1}/${s.items.length}</span>
    </div>
    <div class="exam-progress"><span style="width:${progress}%"></span></div>

    <div class="exam-runner-grid">
      <aside class="exam-context-card">
        <span class="exam-eyebrow">${esc(item.section.title)}</span>
        ${item.caseObj?`<h3>${esc(item.caseObj.title)}</h3><p>${esc(item.caseObj.stem)}</p>`:`<h3>${esc(s.exam.title)}</h3>`}
        ${sequential?`<div class="exam-sequential-note">Caso secuencial: al confirmar y avanzar, esta pregunta queda bloqueada.</div>`:''}
      </aside>

      <article class="exam-question-card">
        ${q.newInfo?`<div class="exam-new-info"><strong>Nueva información</strong><p>${esc(q.newInfo)}</p></div>`:''}
        <div class="exam-question-meta">
          <span>${q.type==='single'?'Mejor respuesta única':q.type==='multiple'?'Selecciona todas las correctas':'Ordena los pasos'}</span>
          ${item.caseObj?`<span>Pregunta ${item.questionIndex+1}/${item.caseObj.questions.length}</span>`:''}
        </div>
        <h2>${esc(q.question)}</h2>
        ${questionImage(q)}
        <div id="examAnswerArea">${renderOptions(q, answer)}</div>
        <div class="exam-runner-actions">
          ${canGoPrevious?'<button type="button" class="exam-secondary" data-prev-question>← Anterior</button>':'<span></span>'}
          <button type="button" class="exam-primary" data-confirm-answer>${answer?.confirmed?'Siguiente →':'Confirmar respuesta'}</button>
        </div>
        <div class="exam-error" id="examError" hidden></div>
      </article>
    </div>`;
  scrollExamTop();
}

function readAnswerFromUI(q){
  if(q.type==='order'){
    const order=$$('.exam-order-row').map(row=>{
      const text=row.querySelector('span:nth-child(2)')?.textContent||'';
      return q.options.indexOf(text);
    });
    return {order,confirmed:true};
  }
  const selected=$$('input[name="exam-answer"]:checked').map(x=>Number(x.value));
  if(!selected.length) return null;
  return {selected,confirmed:true};
}

function isCorrect(q,a){
  if(!a) return false;
  const got=(q.type==='order'?a.order:a.selected)||[];
  return got.length===q.correct.length && got.every((v,i)=>v===q.correct[i]);
}

function selectedUnsafe(q,a){
  const unsafe=new Set(q.unsafeOptions||[]);
  return (a?.selected||[]).some(x=>unsafe.has(x));
}

function caseFinished(item, nextItem){
  return item.caseObj && (!nextItem || nextItem.caseObj?.id!==item.caseObj.id);
}

function renderCaseReview(caseObj, uptoIndex){
  const s=state.current;
  const root=$(`#${s.exam.kind}ExamRoot`);
  const relevant=s.items.map((x,i)=>({x,i})).filter(z=>z.x.caseObj?.id===caseObj.id && z.i<=uptoIndex);
  const good=relevant.filter(z=>isCorrect(z.x.question,s.answers[z.i])).length;
  root.innerHTML=`
    <div class="exam-review-shell">
      <span class="exam-eyebrow">REVISIÓN DEL CASO</span>
      <h1>${esc(caseObj.title)}</h1>
      <p class="exam-review-score">${good}/${relevant.length} respuestas correctas</p>
      <div class="exam-review-list">
        ${relevant.map((z,n)=>{
          const ok=isCorrect(z.x.question,s.answers[z.i]);
          return `<article class="exam-review-item ${ok?'is-correct':'is-wrong'}">
            <strong>${n+1}. ${esc(z.x.question.question)}</strong>
            <span>${ok?'Correcta':'Incorrecta'}</span>
            <p>${esc(z.x.question.explanation)}</p>
          </article>`;
        }).join('')}
      </div>
      <button type="button" class="exam-primary" data-continue-after-case>Continuar simulacro →</button>
    </div>`;
  scrollExamTop();
}

function renderFinal(){
  const s=state.current;
  const root=$(`#${s.exam.kind}ExamRoot`);
  let correct=0, unsafeCount=0;
  const rows=s.items.map((item,i)=>{
    const ok=isCorrect(item.question,s.answers[i]);
    if(ok) correct++;
    if(selectedUnsafe(item.question,s.answers[i])) unsafeCount++;
    return {item,i,ok};
  });
  const pct=Math.round(correct/s.items.length*100);
  root.innerHTML=`
    <div class="exam-final">
      <span class="exam-eyebrow">SIMULACRO COMPLETADO</span>
      <h1>${esc(s.exam.title)}</h1>
      <div class="exam-score-ring"><strong>${pct}%</strong><span>${correct}/${s.items.length}</span></div>
      ${unsafeCount?`<div class="exam-unsafe-summary">⚠ ${unsafeCount} respuesta(s) marcada(s) como potencialmente insegura(s) en casos CORE. Este aviso es educativo y no replica el scoring oficial del EDiR.</div>`:''}
      <p class="exam-final-note">Este resultado es orientativo. No equivale a una nota oficial y no suma puntos al ranking de Radform.</p>
      <div class="exam-review-list">
        ${rows.map((z,n)=>`<article class="exam-review-item ${z.ok?'is-correct':'is-wrong'}">
          <strong>${n+1}. ${esc(z.item.question.question)}</strong>
          <span>${z.ok?'Correcta':'Incorrecta'}</span>
          <p>${esc(z.item.question.explanation)}</p>
        </article>`).join('')}
      </div>
      <div class="exam-final-actions">
        <button type="button" class="exam-secondary" data-restart-exam>Repetir simulacro</button>
        <button type="button" class="exam-primary" data-back-to-exams>Volver a simulacros</button>
      </div>
    </div>`;
  scrollExamTop();
}

async function startExam(file){
  try{
    const exam=await loadJson(`${EXAM_ROOT}/${file}`);
    const items=flattenExam(exam);
    if(!items.length) throw new Error('El simulacro no contiene preguntas.');
    state.current={exam,file,items,index:0,answers:[]};
    showView(exam.kind);
    renderRunner();
  }catch(err){
    console.error(err);
    const kind=file?.startsWith('edir-')?'edir':'ebir';
    showView(kind);
    const root=$(`#${kind}ExamRoot`);
    if(root){
      root.innerHTML=`<div class="exam-review-shell">
        <span class="exam-eyebrow">ERROR DE CARGA</span>
        <h1>No se pudo abrir el simulacro</h1>
        <p class="exam-final-note">Recarga la página e inténtalo de nuevo.</p>
        <button type="button" class="exam-primary" data-back-to-exams>Volver a simulacros</button>
      </div>`;
    }
    scrollExamTop();
  }
}

document.addEventListener('click', async (e)=>{
  const nav=e.target.closest('[data-exam-route]');
  if(nav){
    e.preventDefault(); e.stopPropagation();
    const kind=nav.dataset.examRoute;
    showView(kind);
    if(state.manifest?.[kind]){
      renderLanding(kind);
    }else{
      const root=$(`#${kind}ExamRoot`);
      if(root) root.innerHTML='<div class="exam-loading">Cargando preparación de examen…</div>';
    }
    return;
  }
  const start=e.target.closest('[data-start-exam]');
  if(start){ await startExam(start.dataset.file); return; }

  if(e.target.closest('[data-exit-exam]')){
    const kind=state.current?.exam.kind||'ebir'; state.current=null; renderLanding(kind); return;
  }

  if(e.target.closest('[data-order-move]')){
    const btn=e.target.closest('[data-order-move]');
    const row=btn.closest('.exam-order-row');
    const pos=Number(row.dataset.orderPos);
    const area=$('.exam-order-list');
    const rows=$$('.exam-order-row',area);
    const target=btn.dataset.orderMove==='up'?pos-1:pos+1;
    if(target<0||target>=rows.length) return;
    if(btn.dataset.orderMove==='up') area.insertBefore(row,rows[target]);
    else area.insertBefore(rows[target],row);
    $$('.exam-order-row',area).forEach((r,i)=>{r.dataset.orderPos=i;r.querySelector('.exam-order-num').textContent=i+1;});
    return;
  }

  if(e.target.closest('[data-prev-question]')){
    if(state.current.index>0){state.current.index--;renderRunner();} return;
  }

  if(e.target.closest('[data-confirm-answer]')){
    const s=state.current, item=s.items[s.index], q=item.question;
    if(s.answers[s.index]?.confirmed){
      const next=s.items[s.index+1];
      if(caseFinished(item,next)){ renderCaseReview(item.caseObj,s.index); return; }
      s.index++;
      if(s.index>=s.items.length) renderFinal(); else renderRunner();
      return;
    }
    const ans=readAnswerFromUI(q);
    if(!ans){
      const er=$('#examError'); er.hidden=false; er.textContent='Selecciona una respuesta antes de continuar.'; return;
    }
    s.answers[s.index]=ans;
    const btn=$('[data-confirm-answer]'); if(btn) btn.textContent='Siguiente →';
    $$('#examAnswerArea input, #examAnswerArea button').forEach(x=>x.disabled=true);
    return;
  }

  if(e.target.closest('[data-continue-after-case]')){
    const s=state.current; s.index++;
    if(s.index>=s.items.length) renderFinal(); else renderRunner();
    return;
  }

  if(e.target.closest('[data-restart-exam]')){
    const file=state.current.file; await startExam(file); return;
  }

  if(e.target.closest('[data-back-to-exams]')){
    const kind=state.current.exam.kind; state.current=null; renderLanding(kind); return;
  }

  const normalRoute=e.target.closest('[data-route]');
  if(normalRoute && !normalRoute.dataset.examRoute){
    $$('.exam-prep-view').forEach(v=>v.classList.remove('is-active'));
  }
}, true);

async function init(){
  ensureViews();
  addNavButton('ebir','EBIR','IR');
  addNavButton('edir','EDiR','E');
  try{
    state.manifest=await loadJson(`${EXAM_ROOT}/manifest.json`);
    const cache=await loadJson(`${EXAM_ROOT}/image-cache.json`).catch(()=>({results:[]}));
    (cache.results||[]).forEach(x=>state.imageCache.set(x.key,x));
  }catch(err){ console.error(err); }
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
