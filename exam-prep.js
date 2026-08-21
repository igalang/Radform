const EXAM_ROOT = './data/exams';
const EXAM_STATS_KEY = 'radform-exam-training-v2';
const examState = {
  manifest: null,
  imageCache: new Map(),
  docs: {ebir: [], edir: []},
  bank: {ebir: null, edir: null},
  current: null,
  ui: {
    ebir: {duration: 20, mode: 'practice', topic: 'all'},
    edir: {duration: 20, mode: 'practice', topic: 'all'},
  },
  timerId: null,
};

const exam$ = (sel, root=document) => root.querySelector(sel);
const exam$$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const examEsc = (v='') => String(v)
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&#039;');

async function examLoadJson(url){
  const response = await fetch(url,{cache:'no-store'});
  if(!response.ok) throw new Error(`No se pudo cargar ${url}`);
  return response.json();
}

function examLoadStats(){
  try{
    const raw = JSON.parse(localStorage.getItem(EXAM_STATS_KEY) || '{}');
    return {
      attempts: Array.isArray(raw.attempts) ? raw.attempts : [],
      sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    };
  }catch{
    return {attempts:[],sessions:[]};
  }
}

function examSaveStats(stats){
  try{
    const trimmed = {
      attempts: (stats.attempts || []).slice(-2500),
      sessions: (stats.sessions || []).slice(-250),
    };
    localStorage.setItem(EXAM_STATS_KEY,JSON.stringify(trimmed));
  }catch{}
}

function examScrollTop(){
  window.requestAnimationFrame(() => {
    const view = exam$('.exam-prep-view.is-active');
    if(!view) return;
    const topbar = exam$('.topbar');
    const offset = (topbar?.offsetHeight || 0) + 8;
    const y = Math.max(0,view.getBoundingClientRect().top + window.scrollY - offset);
    window.scrollTo({top:y,left:0,behavior:'auto'});
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

function examAddNavButton(kind,label,icon){
  const topMir = exam$('.nav [data-route="mir"]');
  if(topMir && !exam$(`[data-exam-route="${kind}"].nav-link`)){
    const button = document.createElement('button');
    button.className = 'nav-link exam-nav-link';
    button.type = 'button';
    button.dataset.examRoute = kind;
    button.textContent = label;
    topMir.before(button);
  }
  const drawerMir = exam$('#mobileNav .drawer-nav [data-route="mir"]');
  if(drawerMir && !exam$(`[data-exam-route="${kind}"].drawer-nav-link`)){
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
  ['ebir','edir'].forEach(kind => {
    if(exam$(`[data-view="${kind}"]`)) return;
    const section = document.createElement('section');
    section.className = 'view exam-prep-view';
    section.dataset.view = kind;
    section.innerHTML = `<div class="container exam-prep-container" id="${kind}ExamRoot"></div>`;
    main.append(section);
  });
}

function examShowView(kind){
  exam$$('.view').forEach(v => v.classList.remove('is-active'));
  exam$(`[data-view="${kind}"]`)?.classList.add('is-active');
  exam$$('.nav-link').forEach(b => b.classList.toggle('is-active',b.dataset.examRoute === kind));
  exam$$('.drawer-nav-link').forEach(b => b.classList.toggle('is-active',b.dataset.examRoute === kind));
  examCloseDrawer();
  examScrollTop();
}

function examMediaDescriptors(obj){
  if(!obj) return [];
  const out = [];
  if(Array.isArray(obj.images)) out.push(...obj.images);
  if(obj.imageKey || obj.imageQuery || obj.imageFile){
    out.push({imageKey:obj.imageKey || obj.id,imageQuery:obj.imageQuery,imageFile:obj.imageFile});
  }
  return out.filter(Boolean);
}

function examCachedMedia(obj){
  return examMediaDescriptors(obj)
    .map(meta => examState.imageCache.get(meta.imageKey || meta.id))
    .filter(Boolean);
}

function examItemMedia(item){
  const media = [...examCachedMedia(item.caseObj),...examCachedMedia(item.question)];
  const seen = new Set();
  return media.filter(m => {
    const key = m.key || m.imageUrl;
    if(!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function examMediaHtml(item){
  const media = examItemMedia(item);
  if(!media.length){
    const requested = examMediaDescriptors(item.caseObj).length || examMediaDescriptors(item.question).length;
    return requested ? '<div class="exam-image-missing">Imagen abierta pendiente de caché local. Ejecuta “Actualizar biblioteca médica” en GitHub Actions para intentar recuperarla.</div>' : '';
  }
  return `<div class="exam-media-gallery ${media.length > 1 ? 'is-multiple' : ''}">${media.map(meta => `
    <figure class="exam-image">
      <img src="${examEsc(meta.imageUrl)}" alt="${examEsc(meta.description || 'Medical image')}" loading="eager" />
      <figcaption>${examEsc(meta.author || 'Wikimedia Commons contributor')} · ${examEsc(meta.license || 'Open licence')}${meta.sourcePage ? ` · <a href="${examEsc(meta.sourcePage)}" target="_blank" rel="noreferrer">fuente ↗</a>` : ''}</figcaption>
    </figure>`).join('')}</div>`;
}

function examBuildBank(kind,docs){
  if(kind === 'ebir'){
    const clinicalCases = [];
    const generalQuestions = [];
    docs.forEach(doc => {
      const clinical = doc.sections.find(s => s.id === 'clinical-scenarios');
      const general = doc.sections.find(s => s.id === 'general-practice');
      (clinical?.cases || []).forEach(caseObj => clinicalCases.push({...caseObj,sourceExam:doc.id,component:'clinical'}));
      (general?.questions || []).forEach(question => generalQuestions.push({question,sourceExam:doc.id,component:'general',topic:question.topic || 'Fundamentals & patient safety'}));
    });
    return {clinicalCases,generalQuestions};
  }
  const mrq = [], shortCases = [], coreCases = [];
  docs.forEach(doc => {
    const m = doc.sections.find(s => s.id === 'mrq');
    const sc = doc.sections.find(s => s.id === 'short-cases');
    const core = doc.sections.find(s => s.id === 'core');
    (m?.questions || []).forEach(question => mrq.push({question,sourceExam:doc.id,component:'mrq',topic:question.topic || 'Abdominal'}));
    (sc?.cases || []).forEach(caseObj => shortCases.push({...caseObj,sourceExam:doc.id,component:'short'}));
    (core?.cases || []).forEach(caseObj => coreCases.push({...caseObj,sourceExam:doc.id,component:'core'}));
  });
  return {mrq,shortCases,coreCases};
}

function examQuestionItem(question,{kind,component,caseObj=null,questionIndex=null,groupId=null}={}){
  return {
    type:'question',kind,component,question,caseObj,questionIndex,groupId,
    topic: question.topic || caseObj?.topic || 'General',
    difficulty: question.difficulty || caseObj?.difficulty || 'Intermediate',
  };
}

function examCaseItems(caseObj,kind,component){
  return (caseObj.questions || []).map((question,index) => examQuestionItem(question,{
    kind,component,caseObj,questionIndex:index,groupId:`${component}:${caseObj.id}`,
  }));
}

function examHistoryCount(id){
  const stats = examLoadStats();
  return stats.attempts.reduce((sum,a) => sum + (a.id === id ? 1 : 0),0);
}

function examHistoryLast(id){
  const stats = examLoadStats();
  let last = 0;
  stats.attempts.forEach(a => { if(a.id === id) last = Math.max(last,Number(a.at || 0)); });
  return last;
}

function examLeastSeen(items,count,idFn){
  return [...items]
    .map(item => ({item,seen:examHistoryCount(idFn(item)),last:examHistoryLast(idFn(item)),jitter:Math.random()}))
    .sort((a,b) => a.seen - b.seen || a.last - b.last || a.jitter - b.jitter)
    .slice(0,Math.max(0,count))
    .map(x => x.item);
}

function examFilterTopic(items,topic,getTopic){
  if(!topic || topic === 'all') return items;
  return items.filter(item => getTopic(item) === topic);
}

function examPickQuestions(refs,count,topic='all'){
  if(topic === 'all') return examLeastSeen(refs,Math.min(count,refs.length),x => x.question.id);
  const focused = examFilterTopic(refs,topic,x => x.topic || x.question?.topic);
  const chosen = examLeastSeen(focused,Math.min(count,focused.length),x => x.question.id);
  if(chosen.length < count){
    const used = new Set(chosen.map(x => x.question.id));
    const fill = refs.filter(x => !used.has(x.question.id));
    chosen.push(...examLeastSeen(fill,Math.min(count-chosen.length,fill.length),x => x.question.id));
  }
  return chosen;
}

function examPickCases(cases,count,topic='all'){
  if(topic === 'all') return examLeastSeen(cases,Math.min(count,cases.length),x => x.id);
  const focused = examFilterTopic(cases,topic,x => x.topic);
  const chosen = examLeastSeen(focused,Math.min(count,focused.length),x => x.id);
  if(chosen.length < count){
    const used = new Set(chosen.map(x => x.id));
    const fill = cases.filter(x => !used.has(x.id));
    chosen.push(...examLeastSeen(fill,Math.min(count-chosen.length,fill.length),x => x.id));
  }
  return chosen;
}

function examImageQuestionPool(kind){
  const bank = examState.bank[kind];
  const out = [];
  if(kind === 'ebir'){
    bank.clinicalCases.forEach(caseObj => examCaseItems(caseObj,'ebir','clinical').forEach(item => {
      if(examItemMedia(item).length) out.push(item);
    }));
    bank.generalQuestions.forEach(ref => {
      const item = examQuestionItem(ref.question,{kind:'ebir',component:'general'});
      if(examItemMedia(item).length) out.push(item);
    });
  }else{
    bank.mrq.forEach(ref => {
      const item = examQuestionItem(ref.question,{kind:'edir',component:'mrq'});
      if(examItemMedia(item).length) out.push(item);
    });
    [...bank.shortCases,...bank.coreCases].forEach(caseObj => {
      examCaseItems(caseObj,'edir',caseObj.component).forEach(item => { if(examItemMedia(item).length) out.push(item); });
    });
  }
  return out;
}

function examUniqueImageCount(kind){
  const keys = new Set();
  examImageQuestionPool(kind).forEach(item => examItemMedia(item).forEach(m => keys.add(m.key || m.imageUrl)));
  return keys.size;
}

function examSessionBlueprint(kind,component,duration){
  if(kind === 'ebir'){
    if(component === 'clinical') return {cases:{10:1,20:2,40:4}[duration] || 2};
    if(component === 'general') return {general:{10:6,20:12,40:24}[duration] || 12};
    if(component === 'images') return {images:{10:5,20:10,40:18}[duration] || 10};
    return {cases:{10:1,20:1,40:2}[duration] || 1,general:{10:2,20:8,40:16}[duration] || 8};
  }
  if(component === 'mrq') return {mrq:{10:8,20:16,40:32}[duration] || 16};
  if(component === 'short') return {short:{10:3,20:5,40:10}[duration] || 5};
  if(component === 'core') return {core:{10:1,20:2,40:4}[duration] || 2};
  if(component === 'images') return {images:{10:4,20:8,40:16}[duration] || 8};
  return {mrq:{10:4,20:6,40:10}[duration] || 6,short:{10:1,20:1,40:3}[duration] || 1,core:{10:0,20:1,40:2}[duration] || 1};
}

function examBuildSession(kind,component,{duration=20,mode='practice',topic='all',mini=false,full=false}={}){
  const bank = examState.bank[kind];
  const items = [];
  let label = '';
  let targetMinutes = duration;
  let effectiveMode = mode;

  if(full){
    effectiveMode = 'exam';
    if(kind === 'ebir'){
      examPickCases(bank.clinicalCases,10,'all').forEach(c => items.push(...examCaseItems(c,'ebir','clinical')));
      items.push({type:'break',minutes:30,title:'Pausa entre componentes',text:'El EBIR oficial incluye una pausa de 30 minutos entre las dos secciones.'});
      examPickQuestions(bank.generalQuestions,50,'all').forEach(ref => items.push(examQuestionItem(ref.question,{kind:'ebir',component:'general'})));
      label = 'Full EBIR Mock · Radform original';
      targetMinutes = 210;
    }else{
      examPickQuestions(bank.mrq,78,'all').forEach(ref => items.push(examQuestionItem(ref.question,{kind:'edir',component:'mrq'})));
      items.push({type:'break',minutes:15,title:'Break',text:'The official EDiR includes a 15-minute break between components.'});
      examPickCases(bank.shortCases,24,'all').forEach(c => items.push(...examCaseItems(c,'edir','short')));
      items.push({type:'break',minutes:15,title:'Break',text:'The official EDiR includes a 15-minute break between components.'});
      examPickCases(bank.coreCases,10,'all').forEach(c => items.push(...examCaseItems(c,'edir','core')));
      label = 'Full EDiR Mock · Radform original';
      targetMinutes = 275;
    }
  }else if(mini){
    effectiveMode = 'exam';
    targetMinutes = 40;
    if(kind === 'ebir'){
      examPickCases(bank.clinicalCases,2,topic).forEach(c => items.push(...examCaseItems(c,'ebir','clinical')));
      examPickQuestions(bank.generalQuestions,10,topic).forEach(ref => items.push(examQuestionItem(ref.question,{kind:'ebir',component:'general'})));
      label = 'EBIR Mini Mock · ~40 min';
    }else{
      examPickQuestions(bank.mrq,10,topic).forEach(ref => items.push(examQuestionItem(ref.question,{kind:'edir',component:'mrq'})));
      examPickCases(bank.shortCases,3,topic).forEach(c => items.push(...examCaseItems(c,'edir','short')));
      examPickCases(bank.coreCases,2,topic).forEach(c => items.push(...examCaseItems(c,'edir','core')));
      label = 'EDiR Mini Mock · ~40 min';
    }
  }else if(component === 'images'){
    const n = examSessionBlueprint(kind,'images',duration).images;
    const mediaPool = examImageQuestionPool(kind);
    examLeastSeen(mediaPool,n,x => x.question.id).forEach(item => items.push({...item,component:'images',groupId:null}));
    label = `${kind.toUpperCase()} Image Challenge · ~${duration} min`;
  }else{
    const bp = examSessionBlueprint(kind,component,duration);
    if(kind === 'ebir'){
      if(bp.cases) examPickCases(bank.clinicalCases,bp.cases,topic).forEach(c => items.push(...examCaseItems(c,'ebir','clinical')));
      if(bp.general) examPickQuestions(bank.generalQuestions,bp.general,topic).forEach(ref => items.push(examQuestionItem(ref.question,{kind:'ebir',component:'general'})));
      label = component === 'clinical' ? `Clinical Case Scenarios · ~${duration} min`
        : component === 'general' ? `General Clinical Practice · ~${duration} min`
        : topic !== 'all' ? `${topic} · ~${duration} min`
        : `EBIR Mixed Practice · ~${duration} min`;
    }else{
      if(bp.mrq) examPickQuestions(bank.mrq,bp.mrq,topic).forEach(ref => items.push(examQuestionItem(ref.question,{kind:'edir',component:'mrq'})));
      if(bp.short) examPickCases(bank.shortCases,bp.short,topic).forEach(c => items.push(...examCaseItems(c,'edir','short')));
      if(bp.core) examPickCases(bank.coreCases,bp.core,topic).forEach(c => items.push(...examCaseItems(c,'edir','core')));
      label = component === 'mrq' ? `MRQ · ~${duration} min`
        : component === 'short' ? `Short Cases · ~${duration} min`
        : component === 'core' ? `CORE Cases · ~${duration} min`
        : topic !== 'all' ? `${topic} · ~${duration} min`
        : `EDiR Mixed Practice · ~${duration} min`;
    }
  }

  return {
    kind,component,label,duration:targetMinutes,mode:effectiveMode,topic,items,index:0,
    answers:{},feedbackIndex:null,startedAt:Date.now(),pausedMs:0,breakStartedAt:null,
    recorded:new Set(),sessionId:`${kind}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    full,mini,
  };
}

function examQuestionTotal(session){ return session.items.filter(x => x.type === 'question').length; }
function examQuestionPosition(session,index){ return session.items.slice(0,index+1).filter(x => x.type === 'question').length; }

function examFormatTime(seconds){
  const s = Math.max(0,Math.floor(seconds));
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}

function examElapsedSeconds(session){
  const now = Date.now();
  const currentBreak = session.breakStartedAt ? now - session.breakStartedAt : 0;
  return Math.max(0,(now - session.startedAt - session.pausedMs - currentBreak)/1000);
}

function examUpdateTimer(){
  const session = examState.current;
  const el = exam$('#examTimer');
  if(!session || !el) return;
  const elapsed = examElapsedSeconds(session);
  const target = session.duration * 60;
  const remaining = target - elapsed;
  el.textContent = remaining >= 0 ? `Objetivo ${examFormatTime(remaining)}` : `+${examFormatTime(-remaining)} sobre objetivo`;
  el.classList.toggle('is-over',remaining < 0);
}

function examStartTimer(){
  if(examState.timerId) clearInterval(examState.timerId);
  examState.timerId = setInterval(examUpdateTimer,1000);
  examUpdateTimer();
}

function examStopTimer(){
  if(examState.timerId) clearInterval(examState.timerId);
  examState.timerId = null;
}

function examRenderOptions(question,answer,disabled=false){
  if(question.type === 'order'){
    const order = answer?.order || question.options.map((_,i) => i);
    return `<div class="exam-order-list">${order.map((idx,pos) => `
      <div class="exam-order-row" data-order-index="${idx}">
        <span class="exam-order-num">${pos+1}</span><span>${examEsc(question.options[idx])}</span>
        <span class="exam-order-actions"><button type="button" data-order-move="up" ${disabled || pos===0?'disabled':''}>↑</button><button type="button" data-order-move="down" ${disabled || pos===order.length-1?'disabled':''}>↓</button></span>
      </div>`).join('')}</div>`;
  }
  const multiple = question.type === 'multiple';
  return `<div class="exam-options">${question.options.map((option,index) => `
    <label class="exam-option ${disabled?'is-disabled':''}">
      <input type="${multiple?'checkbox':'radio'}" name="exam-answer" value="${index}" ${answer?.selected?.includes(index)?'checked':''} ${disabled?'disabled':''}/>
      <span class="exam-option-letter">${String.fromCharCode(65+index)}</span><span>${examEsc(option)}</span>
    </label>`).join('')}</div>`;
}

function examReadAnswer(question){
  if(question.type === 'order'){
    const order = exam$$('.exam-order-row').map(row => Number(row.dataset.orderIndex));
    return order.length ? {order} : null;
  }
  const selected = exam$$('input[name="exam-answer"]:checked').map(input => Number(input.value));
  return selected.length ? {selected} : null;
}

function examExactCorrect(question,answer){
  if(!answer) return false;
  const got = question.type === 'order' ? (answer.order || []) : (answer.selected || []);
  const expected = question.correct || [];
  return got.length === expected.length && got.every((v,i) => v === expected[i]);
}

function examProportionalScore(question,answer){
  if(!answer) return 0;
  if(question.type !== 'multiple') return examExactCorrect(question,answer) ? 1 : 0;
  const correct = new Set(question.correct || []);
  const selected = new Set(answer.selected || []);
  const totalCorrect = Math.max(1,correct.size);
  const totalIncorrect = Math.max(1,(question.options || []).length - correct.size);
  let selectedCorrect = 0, selectedIncorrect = 0;
  selected.forEach(i => correct.has(i) ? selectedCorrect++ : selectedIncorrect++);
  return Math.max(0,Math.min(1,selectedCorrect/totalCorrect - selectedIncorrect/totalIncorrect));
}

function examQuestionScore(item,answer){
  if(item.kind === 'edir' && item.component === 'mrq' && item.question.type === 'multiple') return examProportionalScore(item.question,answer);
  return examExactCorrect(item.question,answer) ? 1 : 0;
}

function examUnsafeSelected(question,answer){
  const unsafe = new Set(question.unsafeOptions || []);
  return (answer?.selected || []).some(i => unsafe.has(i));
}

function examFormatAnswer(question,answer){
  if(!answer) return 'No answer';
  if(question.type === 'order') return (answer.order || []).map(i => question.options[i]).join(' → ');
  return (answer.selected || []).map(i => question.options[i]).join(' · ') || 'No answer';
}

function examFormatCorrect(question){
  if(question.type === 'order') return (question.correct || []).map(i => question.options[i]).join(' → ');
  return (question.correct || []).map(i => question.options[i]).join(' · ');
}

function examIsCaseBased(item){ return ['clinical','short','core'].includes(item.component) && Boolean(item.caseObj); }
function examCaseEnds(session,index){
  const item = session.items[index];
  if(!item?.groupId) return false;
  const next = session.items[index+1];
  return !next || next.type !== 'question' || next.groupId !== item.groupId;
}

function examCanGoBack(session,index){
  if(session.mode !== 'exam' || index <= 0) return false;
  const current = session.items[index], previous = session.items[index-1];
  if(!current || !previous || current.type !== 'question' || previous.type !== 'question') return false;
  if(examIsCaseBased(current) || examIsCaseBased(previous)) return false;
  return current.component === previous.component;
}

function examComponentLabel(component){
  return ({clinical:'Clinical Case Scenario',general:'General Clinical Practice',mrq:'MRQ',short:'Short Case',core:'CORE Case',images:'Image Challenge'})[component] || component;
}

function examQuestionTypeLabel(question){
  if(question.type === 'multiple') return 'Choose all that apply';
  if(question.type === 'order') return 'Place in the correct order';
  return 'Single best answer';
}

function examRenderRunner(){
  const session = examState.current;
  if(!session) return;
  const item = session.items[session.index];
  if(!item){ examRenderFinal(); return; }
  if(item.type === 'break'){ examRenderBreak(item); return; }

  const root = exam$(`#${session.kind}ExamRoot`);
  const answer = session.answers[session.index] || null;
  const total = examQuestionTotal(session);
  const position = examQuestionPosition(session,session.index);
  const progress = total ? Math.round(position/total*100) : 0;
  const caseBased = examIsCaseBased(item);
  const practiceStandaloneFeedback = session.mode === 'practice' && !caseBased;
  const media = examMediaHtml(item);
  const visualClass = media ? 'has-media' : '';
  const canBack = examCanGoBack(session,session.index);

  root.innerHTML = `
    <div class="exam-session-bar">
      <button type="button" class="exam-back-link" data-exit-session>← Salir</button>
      <div class="exam-session-title"><strong>${examEsc(session.label)}</strong><span>${session.mode === 'practice' ? 'Practice mode' : 'Exam mode'}</span></div>
      <div class="exam-timer" id="examTimer">—</div>
    </div>
    <div class="exam-progress"><span style="width:${progress}%"></span></div>
    <div class="exam-runner-grid ${visualClass}">
      <aside class="exam-context-card">
        <span class="exam-eyebrow">${examEsc(examComponentLabel(item.component))}</span>
        ${item.caseObj ? `<h3>${examEsc(item.caseObj.title)}</h3><p>${examEsc(item.caseObj.stem)}</p>` : `<h3>${examEsc(session.kind.toUpperCase())}</h3><p>${examEsc(item.topic)}</p>`}
        <div class="exam-context-tags"><span>${examEsc(item.topic)}</span><span>${position}/${total}</span></div>
        ${caseBased ? `<div class="exam-sequential-note">${item.component === 'clinical' ? 'Caso secuencial EBIR: al avanzar no podrás volver a esta pregunta.' : 'Caso agrupado: la revisión aparece al terminar el caso en Practice mode.'}</div>` : session.mode === 'exam' ? '<div class="exam-sequential-note is-neutral">Puedes volver a preguntas independientes anteriores del mismo bloque.</div>' : ''}
      </aside>
      <article class="exam-question-card ${item.component === 'core' ? 'is-core' : ''} ${item.component === 'short' ? 'is-short' : ''}">
        ${item.question.newInfo ? `<div class="exam-new-info"><strong>Additional information</strong><p>${examEsc(item.question.newInfo)}</p></div>` : ''}
        <div class="exam-question-meta"><span>${examEsc(examQuestionTypeLabel(item.question))}</span>${item.question.domain ? `<span>${examEsc(item.question.domain)}</span>` : ''}${item.caseObj ? `<span>Question ${Number(item.questionIndex)+1}/${item.caseObj.questions.length}</span>` : ''}</div>
        ${media}
        <h2>${examEsc(item.question.question)}</h2>
        <div id="examAnswerArea">${examRenderOptions(item.question,answer,false)}</div>
        <div class="exam-runner-actions">
          ${canBack ? '<button type="button" class="exam-secondary" data-prev-question>← Previous</button>' : '<span></span>'}
          <button type="button" class="exam-primary" data-confirm-answer>${practiceStandaloneFeedback ? 'Check answer' : 'Confirm and continue →'}</button>
        </div>
        <div class="exam-error" id="examError" hidden></div>
      </article>
    </div>`;
  examStartTimer();
  examScrollTop();
}

function examRenderInlineFeedback(item,index){
  const session = examState.current;
  const root = exam$(`#${session.kind}ExamRoot`);
  const answer = session.answers[index];
  const score = examQuestionScore(item,answer);
  const exact = examExactCorrect(item.question,answer);
  const partial = item.kind === 'edir' && score > 0 && score < 1;
  const unsafe = examUnsafeSelected(item.question,answer);
  const label = unsafe ? 'Potentially unsafe' : exact ? 'Correct' : partial ? `${Math.round(score*100)}% partial credit` : 'Incorrect';
  const cls = unsafe ? 'is-unsafe' : exact ? 'is-correct' : partial ? 'is-partial' : 'is-wrong';

  root.innerHTML = `
    <div class="exam-session-bar"><button type="button" class="exam-back-link" data-exit-session>← Salir</button><div class="exam-session-title"><strong>${examEsc(session.label)}</strong><span>Practice feedback</span></div><div class="exam-timer" id="examTimer">—</div></div>
    <article class="exam-feedback-card ${cls}">
      <span class="exam-eyebrow">${examEsc(examComponentLabel(item.component))}</span>
      <h1>${examEsc(label)}</h1>
      ${examMediaHtml(item)}
      <div class="exam-feedback-answer"><strong>Your answer</strong><p>${examEsc(examFormatAnswer(item.question,answer))}</p></div>
      <div class="exam-feedback-answer"><strong>Best answer</strong><p>${examEsc(examFormatCorrect(item.question))}</p></div>
      <p class="exam-feedback-explanation">${examEsc(item.question.explanation || '')}</p>
      <button type="button" class="exam-primary" data-continue-feedback>Continue →</button>
    </article>`;
  examStartTimer();
  examScrollTop();
}

function examRenderCaseReview(groupId,endIndex){
  const session = examState.current;
  const root = exam$(`#${session.kind}ExamRoot`);
  const rows = session.items.map((item,index) => ({item,index})).filter(x => x.item.groupId === groupId && x.index <= endIndex);
  const caseObj = rows[0]?.item.caseObj;
  const totalScore = rows.reduce((sum,x) => sum + examQuestionScore(x.item,session.answers[x.index]),0);
  const unsafe = rows.some(x => examUnsafeSelected(x.item.question,session.answers[x.index]));
  root.innerHTML = `
    <div class="exam-session-bar"><button type="button" class="exam-back-link" data-exit-session>← Salir</button><div class="exam-session-title"><strong>${examEsc(session.label)}</strong><span>Case review</span></div><div class="exam-timer" id="examTimer">—</div></div>
    <div class="exam-review-shell">
      <span class="exam-eyebrow">CASE REVIEW</span>
      <h1>${examEsc(caseObj?.title || 'Case')}</h1>
      <p class="exam-review-score">${unsafe ? 'Potentially unsafe response selected · ' : ''}${totalScore.toFixed(1)}/${rows.length} training points</p>
      ${rows[0] ? examMediaHtml(rows[0].item) : ''}
      <div class="exam-review-list">${rows.map((row,n) => {
        const answer = session.answers[row.index];
        const score = examQuestionScore(row.item,answer);
        const exact = examExactCorrect(row.item.question,answer);
        const partial = row.item.kind === 'edir' && score > 0 && score < 1;
        const unsafeRow = examUnsafeSelected(row.item.question,answer);
        const cls = unsafeRow ? 'is-unsafe' : exact ? 'is-correct' : partial ? 'is-partial' : 'is-wrong';
        const label = unsafeRow ? 'Potentially unsafe' : exact ? 'Correct' : partial ? `${Math.round(score*100)}% partial credit` : 'Incorrect';
        return `<article class="exam-review-item ${cls}"><strong>${n+1}. ${examEsc(row.item.question.question)}</strong><span>${examEsc(label)}</span><p><b>Your answer:</b> ${examEsc(examFormatAnswer(row.item.question,answer))}</p><p><b>Best answer:</b> ${examEsc(examFormatCorrect(row.item.question))}</p><p>${examEsc(row.item.question.explanation || '')}</p></article>`;
      }).join('')}</div>
      <button type="button" class="exam-primary" data-continue-case-review>Continue practice →</button>
    </div>`;
  examStartTimer();
  examScrollTop();
}

function examRenderBreak(item){
  const session = examState.current;
  if(!session.breakStartedAt) session.breakStartedAt = Date.now();
  const root = exam$(`#${session.kind}ExamRoot`);
  root.innerHTML = `<div class="exam-break-card"><span class="exam-eyebrow">SIMULATION BREAK</span><h1>${examEsc(item.title)}</h1><div class="exam-break-clock">${item.minutes} min</div><p>${examEsc(item.text || '')}</p><p class="exam-final-note">Radform no te obliga a esperar: continúa cuando quieras.</p><button type="button" class="exam-primary" data-continue-break>Continuar →</button></div>`;
  examStopTimer();
  examScrollTop();
}

function examRecordAttempt(item,answer,session){
  if(!item?.question?.id || session.recorded.has(item.question.id)) return;
  const stats = examLoadStats();
  const score = examQuestionScore(item,answer);
  stats.attempts.push({
    id:item.question.id,kind:item.kind,component:item.component,topic:item.topic,
    score,correct:score === 1,unsafe:examUnsafeSelected(item.question,answer),at:Date.now(),sessionId:session.sessionId,
  });
  examSaveStats(stats);
  session.recorded.add(item.question.id);
}

function examRecordCase(groupId,endIndex){
  const session = examState.current;
  session.items.forEach((item,index) => {
    if(item.type === 'question' && item.groupId === groupId && index <= endIndex) examRecordAttempt(item,session.answers[index],session);
  });
}

function examRecordExamSessionAnswers(){
  const session = examState.current;
  session.items.forEach((item,index) => { if(item.type === 'question' && session.answers[index]) examRecordAttempt(item,session.answers[index],session); });
}

function examAggregateRows(session){
  return session.items.map((item,index) => ({item,index,answer:session.answers[index]})).filter(x => x.item.type === 'question');
}

function examComponentSummary(session){
  const rows = examAggregateRows(session);
  const map = new Map();
  rows.forEach(row => {
    const key = row.item.component;
    if(!map.has(key)) map.set(key,{component:key,score:0,count:0,unsafe:0});
    const x = map.get(key); x.score += examQuestionScore(row.item,row.answer); x.count++; if(examUnsafeSelected(row.item.question,row.answer)) x.unsafe++;
  });
  return [...map.values()].map(x => ({...x,pct:x.count ? 100*x.score/x.count : 0}));
}

function examTopicSummary(session){
  const rows = examAggregateRows(session);
  const map = new Map();
  rows.forEach(row => {
    const key = row.item.topic || 'General';
    if(!map.has(key)) map.set(key,{topic:key,score:0,count:0});
    const x = map.get(key); x.score += examQuestionScore(row.item,row.answer); x.count++;
  });
  return [...map.values()].map(x => ({...x,pct:x.count ? 100*x.score/x.count : 0})).sort((a,b) => a.pct-b.pct);
}

function examEdirOfficialLikeSummary(session){
  const rows = examAggregateRows(session);
  const mrqRows = rows.filter(x => x.item.component === 'mrq');
  const mrq = mrqRows.length ? 100*mrqRows.reduce((s,x) => s+examQuestionScore(x.item,x.answer),0)/mrqRows.length : null;
  const shortGroups = new Map();
  rows.filter(x => x.item.component === 'short').forEach(x => {
    if(!shortGroups.has(x.item.groupId)) shortGroups.set(x.item.groupId,[]);
    shortGroups.get(x.item.groupId).push(x);
  });
  const shortScores = [...shortGroups.values()].map(group => group.reduce((s,x) => s+examQuestionScore(x.item,x.answer),0)/group.length*100);
  const shortCases = shortScores.length ? shortScores.reduce((a,b)=>a+b,0)/shortScores.length : null;
  const written = mrq !== null && shortCases !== null ? 0.7*mrq + 0.3*shortCases : null;
  const coreGroups = new Map();
  rows.filter(x => x.item.component === 'core').forEach(x => {
    if(!coreGroups.has(x.item.groupId)) coreGroups.set(x.item.groupId,[]);
    coreGroups.get(x.item.groupId).push(x);
  });
  const coreScores = [...coreGroups.values()].map(group => {
    if(group.some(x => examUnsafeSelected(x.item.question,x.answer))) return {score:0,unsafe:true};
    return {score:10*group.reduce((s,x)=>s+examQuestionScore(x.item,x.answer),0)/group.length,unsafe:false};
  });
  return {
    mrq,shortCases,written,
    coreAverage: coreScores.length ? coreScores.reduce((s,x)=>s+x.score,0)/coreScores.length : null,
    unsafeCount: coreScores.filter(x=>x.unsafe).length,
  };
}

function examEbirOfficialLikeSummary(session){
  const rows = examAggregateRows(session);
  const clinical = rows.filter(x => x.item.component === 'clinical');
  const general = rows.filter(x => x.item.component === 'general');
  const clinicalPct = clinical.length ? 100*clinical.reduce((s,x)=>s+examQuestionScore(x.item,x.answer),0)/clinical.length : null;
  const generalPct = general.length ? 100*general.reduce((s,x)=>s+examQuestionScore(x.item,x.answer),0)/general.length : null;
  return {clinicalPct,generalPct,combined:clinicalPct!==null && generalPct!==null ? (clinicalPct+generalPct)/2 : null};
}

function examRenderFinal(){
  const session = examState.current;
  if(!session) return;
  examStopTimer();
  if(session.mode === 'exam') examRecordExamSessionAnswers();
  const root = exam$(`#${session.kind}ExamRoot`);
  const rows = examAggregateRows(session);
  const answered = rows.filter(x => x.answer).length;
  const score = rows.length ? 100*rows.reduce((s,x)=>s+examQuestionScore(x.item,x.answer),0)/rows.length : 0;
  const components = examComponentSummary(session);
  const topics = examTopicSummary(session);
  const weakest = topics.filter(x=>x.count>=2).slice(0,3);
  const elapsed = examElapsedSeconds(session);

  const stats = examLoadStats();
  stats.sessions.push({kind:session.kind,component:session.component,topic:session.topic,mode:session.mode,duration:session.duration,score,answered,total:rows.length,at:Date.now(),elapsedSeconds:elapsed});
  examSaveStats(stats);

  let officialLike = '';
  if(session.kind === 'edir' && (session.full || session.mini || session.component === 'mixed')){
    const e = examEdirOfficialLikeSummary(session);
    officialLike = `<div class="exam-score-grid">
      ${e.mrq!==null?`<div><strong>${e.mrq.toFixed(1)}%</strong><span>MRQ</span></div>`:''}
      ${e.shortCases!==null?`<div><strong>${e.shortCases.toFixed(1)}%</strong><span>Short Cases</span></div>`:''}
      ${e.written!==null?`<div><strong>${e.written.toFixed(1)}%</strong><span>70/30 written</span></div>`:''}
      ${e.coreAverage!==null?`<div><strong>${e.coreAverage.toFixed(1)}/10</strong><span>CORE training avg.</span></div>`:''}
    </div>${e.unsafeCount?`<div class="exam-unsafe-summary">⚠ ${e.unsafeCount} CORE case(s) with a potentially unsafe response.</div>`:''}`;
  }else if(session.kind === 'ebir' && (session.full || session.mini || session.component === 'mixed')){
    const e = examEbirOfficialLikeSummary(session);
    officialLike = `<div class="exam-score-grid">${e.clinicalPct!==null?`<div><strong>${e.clinicalPct.toFixed(1)}%</strong><span>Clinical cases</span></div>`:''}${e.generalPct!==null?`<div><strong>${e.generalPct.toFixed(1)}%</strong><span>General practice</span></div>`:''}${e.combined!==null?`<div><strong>${e.combined.toFixed(1)}%</strong><span>50/50 training score</span></div>`:''}</div>`;
  }

  root.innerHTML = `<div class="exam-final">
    <span class="exam-eyebrow">SESSION COMPLETE</span>
    <h1>${examEsc(session.label)}</h1>
    <div class="exam-final-summary"><div><strong>${score.toFixed(0)}%</strong><span>training score</span></div><div><strong>${answered}/${rows.length}</strong><span>answered</span></div><div><strong>${examFormatTime(elapsed)}</strong><span>active time</span></div></div>
    ${officialLike}
    <div class="exam-component-results">${components.map(c=>`<div><strong>${c.pct.toFixed(0)}%</strong><span>${examEsc(examComponentLabel(c.component))}</span></div>`).join('')}</div>
    ${weakest.length?`<section class="exam-weak-box"><span class="exam-eyebrow">FOCUS NEXT</span><h2>Áreas a reforzar en esta sesión</h2><div class="exam-topic-chips">${weakest.map(t=>`<button type="button" data-practice-topic="${examEsc(t.topic)}">${examEsc(t.topic)} · ${t.pct.toFixed(0)}%</button>`).join('')}</div></section>`:''}
    <p class="exam-final-note">Resultado educativo de Radform. No es una calificación oficial de CIRSE/EBIR ni EBR/EDiR y no sustituye sus métodos de estandarización o evaluación por examinadores.</p>
    <div class="exam-final-actions"><button type="button" class="exam-secondary" data-repeat-session>Repetir formato</button><button type="button" class="exam-primary" data-back-to-center>Volver al centro de preparación</button></div>
  </div>`;
  examScrollTop();
}

function examStatsForKind(kind){
  const stats = examLoadStats();
  const attempts = stats.attempts.filter(a => a.kind === kind);
  const sessions = stats.sessions.filter(s => s.kind === kind);
  const score = attempts.length ? 100*attempts.reduce((s,a)=>s+Number(a.score||0),0)/attempts.length : null;
  const topicMap = new Map();
  attempts.forEach(a => {
    if(!topicMap.has(a.topic)) topicMap.set(a.topic,{topic:a.topic,score:0,count:0});
    const x=topicMap.get(a.topic); x.score += Number(a.score||0); x.count++;
  });
  const topics=[...topicMap.values()].map(x=>({...x,pct:100*x.score/x.count})).filter(x=>x.count>=3).sort((a,b)=>a.pct-b.pct);
  return {attempts,sessions,score,weakest:topics[0]||null,strongest:topics.length?[...topics].sort((a,b)=>b.pct-a.pct)[0]:null};
}

function examBankCounts(kind){
  const bank = examState.bank[kind];
  if(kind === 'ebir') return {a:bank.clinicalCases.length,b:bank.generalQuestions.length,aLabel:'clinical cases',bLabel:'general questions'};
  return {a:bank.mrq.length,b:bank.shortCases.length,c:bank.coreCases.length,aLabel:'MRQ',bLabel:'Short Cases',cLabel:'CORE Cases'};
}

function examRecommended(kind){
  const stats = examStatsForKind(kind);
  if(stats.weakest) return {topic:stats.weakest.topic,label:`20 min · ${stats.weakest.topic}`,reason:`Tu rendimiento acumulado en esta área es ${stats.weakest.pct.toFixed(0)}%.`};
  return {topic:'all',label:'20 min · Mixed practice',reason:'Una sesión corta que mezcla los componentes principales del examen.'};
}

function examResourceButtons(links=[]){
  return links.map(link => `<a class="exam-resource-link" href="${examEsc(link.url)}" target="_blank" rel="noreferrer">${examEsc(link.label)} ↗</a>`).join('');
}

function examRenderLanding(kind){
  const cfg = examState.manifest?.[kind];
  const root = exam$(`#${kind}ExamRoot`);
  if(!cfg || !root || !examState.bank[kind]) return;
  examStopTimer();
  const ui = examState.ui[kind];
  const counts = examBankCounts(kind);
  const stats = examStatsForKind(kind);
  const rec = examRecommended(kind);
  const images = examUniqueImageCount(kind);
  const modes = kind === 'ebir'
    ? [
      ['mixed','Mixed Practice','Clinical case + general questions','≈20 min recomendado'],
      ['clinical','Clinical Case Scenarios','Casos secuenciales de 5 preguntas','Sin volver atrás dentro del caso'],
      ['general','General Clinical Practice','Single best answer independientes','Navegación libre en Exam mode'],
      ['images','Image Challenge','Preguntas guiadas por imagen abierta',`${images} imágenes listas`],
    ]
    : [
      ['mixed','Mixed Practice','MRQ + Short Cases + CORE','≈20 min recomendado'],
      ['mrq','MRQ','Multiple Response Questions','Puntuación proporcional'],
      ['short','Short Cases','Casos clínicos visuales agrupados','Mayor peso de imagen'],
      ['core','CORE Cases','Observación, interpretación y seguridad','CORE training score /10'],
      ['images','Image Challenge','Preguntas guiadas por imagen abierta',`${images} imágenes listas`],
    ];

  root.innerHTML = `
    <div class="exam-hero exam-center-hero"><div><span class="exam-kicker">${examEsc(cfg.scope)}</span><h1>${examEsc(cfg.name)}</h1><p class="exam-fullname">${examEsc(cfg.fullName)}</p><p class="exam-intro">${kind==='ebir'?'Reglas y estructura explicadas en español; entrenamiento clínico en inglés. Sesiones cortas fieles a los dos componentes del EBIR.':'Reglas y estructura explicadas en español; preguntas en inglés. Entrena MRQ, Short Cases y CORE por separado o combinados.'}</p></div><div class="exam-badge">${kind==='ebir'?'IR':'RAD'}</div></div>

    <section class="exam-recommended-card">
      <div><span class="exam-eyebrow">RECOMMENDED</span><h2>${examEsc(rec.label)}</h2><p>${examEsc(rec.reason)}</p></div>
      <button type="button" class="exam-primary" data-start-recommended="${examEsc(rec.topic)}">Empezar →</button>
    </section>

    <section class="exam-control-panel">
      <div><span class="exam-eyebrow">DURACIÓN</span><div class="exam-segmented">${[10,20,40].map(min=>`<button type="button" data-exam-duration="${min}" class="${ui.duration===min?'is-active':''}">${min} min</button>`).join('')}</div></div>
      <div><span class="exam-eyebrow">MODO</span><div class="exam-segmented"><button type="button" data-exam-mode="practice" class="${ui.mode==='practice'?'is-active':''}">Practice · feedback</button><button type="button" data-exam-mode="exam" class="${ui.mode==='exam'?'is-active':''}">Exam · sin feedback</button></div></div>
    </section>

    <div class="exam-list-head"><div><span class="exam-eyebrow">PRACTICE BY COMPONENT</span><h2>¿Qué quieres entrenar?</h2></div><span class="exam-no-ranking">No afecta al ranking</span></div>
    <div class="exam-mode-grid">${modes.map(([id,title,desc,meta])=>`<button type="button" class="exam-mode-card ${id==='images'&&images===0?'is-disabled':''}" data-start-practice="${id}" ${id==='images'&&images===0?'disabled':''}><span class="exam-mode-icon">${id==='mixed'?'✦':id==='images'?'◉':id==='clinical'||id==='short'||id==='core'?'▣':'✓'}</span><strong>${examEsc(title)}</strong><p>${examEsc(desc)}</p><small>${examEsc(meta)}</small></button>`).join('')}</div>

    <section class="exam-focus-card"><div><span class="exam-eyebrow">FOCUSED PRACTICE</span><h2>${kind==='ebir'?'Por área del currículo':'Por categoría EDiR'}</h2><p>Radform prioriza el área seleccionada y las preguntas que has visto menos. Si ese tema no cubre todos los formatos, completa la sesión con otros componentes para mantener la duración aproximada.</p></div><div class="exam-topic-control"><select id="examTopicSelect"><option value="all">Todas las áreas</option>${(cfg.topics||[]).map(t=>`<option value="${examEsc(t)}" ${ui.topic===t?'selected':''}>${examEsc(t)}</option>`).join('')}</select><button type="button" class="exam-primary" data-start-topic>Practicar ~${ui.duration} min</button></div></section>

    <section class="exam-simulation-card"><div><span class="exam-eyebrow">SIMULATION · SECONDARY MODE</span><h2>Cuando quieras medir resistencia y navegación</h2><p>Las simulaciones largas no son el núcleo de Radform. Úsalas de forma ocasional; para el día a día recomendamos sesiones de 10–40 minutos.</p></div><div class="exam-simulation-actions"><button type="button" class="exam-secondary" data-start-mini>Mini Mock · ~40 min</button><button type="button" class="exam-secondary" data-start-full>Full Mock · escala oficial</button></div></section>

    <section class="exam-bank-strip"><div><strong>${counts.a}</strong><span>${examEsc(counts.aLabel)}</span></div><div><strong>${counts.b}</strong><span>${examEsc(counts.bLabel)}</span></div>${counts.c!==undefined?`<div><strong>${counts.c}</strong><span>${examEsc(counts.cLabel)}</span></div>`:''}<div><strong>${images}</strong><span>open images ready</span></div></section>

    <section class="exam-personal-stats"><div class="exam-list-head"><div><span class="exam-eyebrow">YOUR TRAINING</span><h2>Progreso privado en este dispositivo</h2></div>${stats.attempts.length?'<button type="button" class="exam-text-danger" data-reset-exam-stats>Reiniciar estadísticas</button>':''}</div><div class="exam-stat-grid"><div><strong>${stats.sessions.length}</strong><span>sesiones</span></div><div><strong>${stats.attempts.length}</strong><span>preguntas</span></div><div><strong>${stats.score===null?'—':stats.score.toFixed(0)+'%'}</strong><span>rendimiento</span></div><div><strong>${stats.weakest?examEsc(stats.weakest.topic):'—'}</strong><span>área a reforzar</span></div></div></section>

    <section class="exam-info-card"><div class="exam-info-head"><div><span class="exam-eyebrow">FORMATO OFICIAL</span><h2>Cómo es el examen real</h2></div><span class="exam-official-pill">Fuentes oficiales</span></div><ul>${cfg.officialSummary.map(x=>`<li>${examEsc(x)}</li>`).join('')}</ul><p class="exam-language-note">${examEsc(cfg.languageNote || '')}</p><div class="exam-resource-row">${examResourceButtons(cfg.officialLinks)}</div></section>
    <section class="exam-notice"><strong>Material Radform</strong><p>${examEsc(examState.manifest.legalNotice)}</p></section>`;
  examScrollTop();
}

async function examStartSession(kind,component,opts={}){
  const ui = examState.ui[kind];
  const session = examBuildSession(kind,component,{duration:ui.duration,mode:ui.mode,topic:ui.topic,...opts});
  if(!session.items.some(x=>x.type==='question')){
    const root=exam$(`#${kind}ExamRoot`);
    root.insertAdjacentHTML('afterbegin','<div class="exam-load-error">No hay suficientes preguntas disponibles para esta combinación. Prueba otra duración, área o ejecuta el workflow de imágenes si elegiste Image Challenge.</div>');
    return;
  }
  examState.current = session;
  examRenderRunner();
}

function examAdvance(){
  const session = examState.current;
  if(!session) return;
  session.index += 1;
  if(session.index >= session.items.length) examRenderFinal();
  else examRenderRunner();
}

async function examInit(){
  examEnsureViews();
  examAddNavButton('ebir','EBIR','IR');
  examAddNavButton('edir','EDiR','E');
  try{
    examState.manifest = await examLoadJson(`${EXAM_ROOT}/manifest.json`);
    const cache = await examLoadJson(`${EXAM_ROOT}/image-cache.json`).catch(()=>({results:[]}));
    (cache.results || []).forEach(item => examState.imageCache.set(item.key,item));
    for(const kind of ['ebir','edir']){
      const files = examState.manifest[kind].examFiles || [];
      examState.docs[kind] = await Promise.all(files.map(file => examLoadJson(`${EXAM_ROOT}/${file}`)));
      examState.bank[kind] = examBuildBank(kind,examState.docs[kind]);
    }
  }catch(error){ console.error('Exam prep init:',error); }
}

// Interaction layer

document.addEventListener('click',async event => {
  const nav = event.target.closest('[data-exam-route]');
  if(nav){
    event.preventDefault(); event.stopImmediatePropagation();
    const kind = nav.dataset.examRoute;
    examState.current = null; examStopTimer(); examShowView(kind);
    if(examState.bank[kind]) examRenderLanding(kind);
    else exam$(`#${kind}ExamRoot`).innerHTML='<div class="exam-loading">Cargando centro de preparación…</div>';
    return;
  }

  const duration = event.target.closest('[data-exam-duration]');
  if(duration){
    const kind = exam$('.exam-prep-view.is-active')?.dataset.view;
    if(kind){ examState.ui[kind].duration = Number(duration.dataset.examDuration); examRenderLanding(kind); }
    return;
  }
  const mode = event.target.closest('[data-exam-mode]');
  if(mode){
    const kind = exam$('.exam-prep-view.is-active')?.dataset.view;
    if(kind){ examState.ui[kind].mode = mode.dataset.examMode; examRenderLanding(kind); }
    return;
  }
  const start = event.target.closest('[data-start-practice]');
  if(start){
    const kind = exam$('.exam-prep-view.is-active')?.dataset.view;
    if(kind) await examStartSession(kind,start.dataset.startPractice,{topic:'all'});
    return;
  }
  if(event.target.closest('[data-start-topic]')){
    const kind = exam$('.exam-prep-view.is-active')?.dataset.view;
    if(kind){ examState.ui[kind].topic = exam$('#examTopicSelect')?.value || 'all'; await examStartSession(kind,'mixed',{topic:examState.ui[kind].topic}); }
    return;
  }
  const rec = event.target.closest('[data-start-recommended]');
  if(rec){
    const kind = exam$('.exam-prep-view.is-active')?.dataset.view;
    if(kind){ examState.ui[kind].duration=20; examState.ui[kind].mode='practice'; examState.ui[kind].topic=rec.dataset.startRecommended || 'all'; await examStartSession(kind,'mixed',{topic:examState.ui[kind].topic}); }
    return;
  }
  if(event.target.closest('[data-start-mini]')){
    const kind = exam$('.exam-prep-view.is-active')?.dataset.view;
    if(kind) await examStartSession(kind,'mixed',{mini:true,mode:'exam',duration:40,topic:'all'});
    return;
  }
  if(event.target.closest('[data-start-full]')){
    const kind = exam$('.exam-prep-view.is-active')?.dataset.view;
    if(kind){
      const ok = window.confirm('El Full Mock es una sesión larga. Radform recomienda usarlo de forma ocasional; para práctica diaria es mejor 10–40 min. ¿Continuar?');
      if(ok) await examStartSession(kind,'mixed',{full:true,mode:'exam',topic:'all'});
    }
    return;
  }

  const move = event.target.closest('[data-order-move]');
  if(move){
    const row = move.closest('.exam-order-row'), list = row?.parentElement;
    if(!row || !list) return;
    if(move.dataset.orderMove==='up' && row.previousElementSibling) list.insertBefore(row,row.previousElementSibling);
    if(move.dataset.orderMove==='down' && row.nextElementSibling) list.insertBefore(row.nextElementSibling,row);
    exam$$('.exam-order-row',list).forEach((r,i)=>{
      r.querySelector('.exam-order-num').textContent=i+1;
      const up=r.querySelector('[data-order-move="up"]'), down=r.querySelector('[data-order-move="down"]');
      if(up) up.disabled=i===0; if(down) down.disabled=i===exam$$('.exam-order-row',list).length-1;
    });
    return;
  }

  if(event.target.closest('[data-prev-question]')){
    const session = examState.current;
    if(session && examCanGoBack(session,session.index)){ session.index -= 1; examRenderRunner(); }
    return;
  }

  if(event.target.closest('[data-confirm-answer]')){
    const session = examState.current;
    const item = session?.items[session.index];
    if(!session || !item || item.type!=='question') return;
    const answer = examReadAnswer(item.question);
    if(!answer){
      const error=exam$('#examError'); if(error){ error.hidden=false; error.textContent='Select an answer before continuing.'; }
      return;
    }
    session.answers[session.index] = answer;
    const caseBased = examIsCaseBased(item);
    if(session.mode === 'practice' && !caseBased){
      examRecordAttempt(item,answer,session);
      session.feedbackIndex = session.index;
      examRenderInlineFeedback(item,session.index);
      return;
    }
    if(session.mode === 'practice' && caseBased && examCaseEnds(session,session.index)){
      examRecordCase(item.groupId,session.index);
      examRenderCaseReview(item.groupId,session.index);
      return;
    }
    examAdvance();
    return;
  }

  if(event.target.closest('[data-continue-feedback]')){
    const session=examState.current; if(!session) return;
    session.feedbackIndex=null; examAdvance(); return;
  }
  if(event.target.closest('[data-continue-case-review]')){ examAdvance(); return; }

  if(event.target.closest('[data-continue-break]')){
    const session=examState.current; if(!session) return;
    if(session.breakStartedAt){ session.pausedMs += Date.now()-session.breakStartedAt; session.breakStartedAt=null; }
    examAdvance(); return;
  }

  if(event.target.closest('[data-exit-session]')){
    const session=examState.current; if(!session) return;
    const kind=session.kind;
    const ok=window.confirm('¿Salir de esta sesión? Las respuestas ya revisadas en Practice mode quedan guardadas en tus estadísticas locales.');
    if(ok){ examState.current=null; examStopTimer(); examRenderLanding(kind); }
    return;
  }
  if(event.target.closest('[data-back-to-center]')){
    const kind=examState.current?.kind || exam$('.exam-prep-view.is-active')?.dataset.view || 'ebir';
    examState.current=null; examStopTimer(); examRenderLanding(kind); return;
  }
  if(event.target.closest('[data-repeat-session]')){
    const old=examState.current; if(!old) return;
    await examStartSession(old.kind,old.component,{duration:old.full?examState.ui[old.kind].duration:old.duration,mode:old.mode,topic:old.topic,mini:old.mini,full:old.full}); return;
  }
  const topicPractice=event.target.closest('[data-practice-topic]');
  if(topicPractice){
    const kind=examState.current?.kind || exam$('.exam-prep-view.is-active')?.dataset.view || 'ebir';
    examState.ui[kind].duration=20; examState.ui[kind].mode='practice'; examState.ui[kind].topic=topicPractice.dataset.practiceTopic;
    await examStartSession(kind,'mixed',{topic:examState.ui[kind].topic}); return;
  }
  if(event.target.closest('[data-reset-exam-stats]')){
    const kind=exam$('.exam-prep-view.is-active')?.dataset.view;
    if(!kind) return;
    const ok=window.confirm(`¿Reiniciar tus estadísticas locales de ${kind.toUpperCase()}? No afecta al Quiz, ranking ni cuenta.`);
    if(ok){
      const stats=examLoadStats(); stats.attempts=stats.attempts.filter(a=>a.kind!==kind); stats.sessions=stats.sessions.filter(s=>s.kind!==kind); examSaveStats(stats); examRenderLanding(kind);
    }
    return;
  }

  if(event.target.closest('[data-route],[data-quiz-route]')){
    examStopTimer(); examState.current=null;
    exam$$('.exam-prep-view').forEach(v=>v.classList.remove('is-active'));
    exam$$('[data-exam-route]').forEach(b=>b.classList.remove('is-active'));
  }
},true);

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>void examInit(),{once:true});
else void examInit();
