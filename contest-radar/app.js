'use strict';
const main = document.querySelector('main');
document.body.classList.toggle('radar-in-portal', window.self !== window.top);
const tags = ['AI 활용','행정업무','국민 누구나 참여'];
const types = ['사례','아이디어','슬로건','영상','이미지','앱','웹서비스','기타'];
const statuses = {open:'접수 중',upcoming:'접수 예정',closed:'마감'};
const sorts = {priority:'우선순위별 마감 임박순',deadline:'전체 마감 임박순',latest:'전체 공고일 최신순'};
const labels = {announced:'공고일',start:'접수 시작일',end:'접수 마감일',time:'마감 시각'};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const href = value => { try { return /^https?:$/.test(new URL(value).protocol) ? escape(value) : '#'; } catch { return '#'; } };
const official = (value, label='공식 공고 보기') => '<a class="btn" href="'+href(value)+'" target="_blank" rel="noopener noreferrer">'+escape(label)+'</a>';
const dateText = value => escape(value?.replaceAll('-', '. '));
function stamp(value) {
  return value ? new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Seoul'}).format(new Date(value)) : '미확인';
}
async function api(path, options={}) {
  const url = new URL(path, location.origin);
  if (url.pathname.startsWith('/api/admin')) {
    const action = {'/api/admin':'admin','/api/admin/collect':'admin-collect','/api/admin/remove':'admin-remove'}[url.pathname];
    const response = await fetch('/api/contest-cloud?action='+action,options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '클라우드 관리자 요청에 실패했습니다.');
    return result;
  }
  return window.radarPublicFallback(path);
}
function badges(item) {
  return item.tags.map(tag=>'<span class="pill '+(tag===tags[1]?'admin':tag===tags[2]?'public':'')+'">'+escape(tag)+'</span>').join('');
}
function deadline(item) {
  if (item.status === 'closed') return '접수 마감';
  if (item.days === 0) return '오늘 마감 · '+(escape(item.time)||'시각 미공개');
  return 'D-'+item.days;
}
function card(item) {
  return '<article class="card tone-'+tags.indexOf(item.primary)+'"><div class="card-cover"><div class="card-top"><span class="status-chip">'+statuses[item.status]+'</span><span class="deadline '+(item.days<=2&&item.status==='open'?'urgent':'')+'">'+deadline(item)+'</span></div>'+
    '<h4><a href="/contest-radar/?id='+item.id+'">'+escape(item.title)+'</a></h4></div><div class="card-body"><p class="meta">'+escape(item.host)+' · '+escape(item.types.join(', ')||'제출 유형 미확인')+'</p>'+
    '<p class="eligibility"><strong>참가</strong> '+escape(item.eligibility)+'</p><div class="tag-row">'+badges(item)+'</div><div class="card-bottom"><span class="meta">'+dateText(item.end)+' 마감'+(item.time?' '+escape(item.time):'')+'</span>'+official(item.url)+'</div></div></article>';
}
function choices(entries, key, active) {
  return entries.map(([value,label])=>'<button type="button" class="choice" data-key="'+key+'" data-value="'+escape(value)+'" aria-pressed="'+String(value===active)+'">'+escape(label)+'</button>').join('');
}
function options(entries, active) {
  return entries.map(([key,label])=>'<option value="'+escape(key)+'" '+(key===active?'selected':'')+'>'+escape(label)+'</option>').join('');
}
function home() {
  const query = Object.fromEntries(new URLSearchParams(location.search));
  const state = {q:query.q||'',tag:tags.includes(query.tag)?query.tag:'',status:Object.hasOwn(statuses,query.status)?query.status:'open',
                 type:types.includes(query.type)?query.type:'',sort:Object.hasOwn(sorts,query.sort)?query.sort:'priority',education:query.education==='1'?'1':''};
  main.innerHTML = '<section class="hero"><span class="hero-radar" aria-hidden="true"></span><h1>지니의 공모전 레이더</h1><p>AI 활용부터 행정업무 개선까지.<br class="mobile-break"> 내게 맞는 국내 공모전을 찾아보세요.</p></section>'+
    '<div class="filter-stack"><form class="panel" id="filters" role="search"><div class="search"><input name="q" type="search" aria-label="공모전 검색" placeholder="제목, 주최기관, 주제, 태그" value="'+escape(state.q)+'"><button class="btn main">검색</button></div>'+
    '<fieldset><legend>접수 상태</legend><div class="choices">'+choices(Object.entries(statuses),'status',state.status)+'</div></fieldset>'+
    '<fieldset><legend>공모전 범주</legend><div class="choices">'+choices([['','전체'],...tags.map(t=>[t,t])],'tag',state.tag)+'</div></fieldset>'+
    '<div class="options"><label>제출 유형<select name="type">'+options([['','전체 유형'],...types.map(t=>[t,t])],state.type)+'</select></label>'+
    '<label>정렬<select name="sort">'+options(Object.entries(sorts),state.sort)+'</select></label><label class="switch"><input type="checkbox" name="education" '+(state.education?'checked':'')+'> 교육행정직 맞춤</label></div></form></div>'+
    '<div class="result-head"><h2 id="result-heading">공모전</h2><span id="count" class="note" role="status"></span></div><div id="results" aria-labelledby="result-heading"></div>';
  const form = document.querySelector('#filters');
  const list = document.querySelector('#results');
  let request = 0;
  async function update() {
    const current = ++request;
    const params = new URLSearchParams(Object.entries(state).filter(([,value])=>value));
    const back = '/contest-radar/?'+params;
    history.replaceState(null,'',back);
    list.setAttribute('aria-busy','true');
    try {
      const result = await api('/api/contests?'+params);
      if (current !== request) return;
      document.querySelector('#result-heading').textContent = statuses[state.status]+' 공모전';
      document.querySelector('#count').textContent = result.items.length+'건'+(result.source==='snapshot'?' · 저장된 공고':'');
      if (!result.items.length) {
        list.innerHTML='<p class="panel empty">조건에 맞는 공모전이 없습니다. 검색어나 필터를 바꿔 보세요.</p>';
        return;
      }
      if (state.sort === 'priority' && !state.tag) {
        list.innerHTML=tags.map(tag=>{
          const cards=result.items.filter(item=>item.primary===tag);
          return cards.length?'<section class="group"><h3>'+tag+'</h3><div class="cards">'+cards.map(card).join('')+'</div></section>':'';
        }).join('');
      } else {
        list.innerHTML='<div class="cards">'+result.items.map(card).join('')+'</div>';
      }
      list.querySelectorAll('h4 a').forEach(link=>link.addEventListener('click',()=>sessionStorage.setItem('radarBack',back)));
    } catch (error) {
      if (current===request) list.textContent = '공고를 불러오지 못했습니다. '+error.message;
    } finally {
      if (current===request) list.removeAttribute('aria-busy');
    }
  }
  form.addEventListener('submit',event=>{event.preventDefault();state.q=form.elements.q.value.trim();update();});
  form.addEventListener('change',event=>{
    const {name,value,checked}=event.target;
    if (!['type','sort','education'].includes(name)) return;
    state[name]=name==='education'?(checked?'1':''):value;
    state.q=form.elements.q.value.trim();
    update();
  });
  form.addEventListener('click',event=>{
    const button=event.target.closest('[data-key]');
    if (!button) return;
    state[button.dataset.key]=button.dataset.value;
    state.q=form.elements.q.value.trim();
    form.querySelectorAll('[data-key="'+button.dataset.key+'"]').forEach(choice=>
      choice.setAttribute('aria-pressed',String(choice===button)));
    update();
  });
  update();
}
function section(label,value) {
  return value ? '<section><h2>'+escape(label)+'</h2><p>'+escape(value)+'</p></section>' : '';
}
async function detail() {
  const item = await api('/api/contests/'+new URLSearchParams(location.search).get('id'));
  const back=sessionStorage.getItem('radarBack')||'/contest-radar/';
  const changes=item.history.map(entry=>'<li>'+escape(stamp(entry.checked))+' · '+Object.entries(entry.changes).map(([key,change])=>escape(labels[key]+' '+(change.before||'미공개')+' → '+(change.after||'미공개'))).join(', ')+' · <a href="'+href(entry.url)+'" target="_blank" rel="noopener noreferrer">변경 근거</a></li>').join('');
  main.innerHTML='<article class="detail"><a href="'+escape(/^\/contest-radar\/(?:\?|$)/.test(back)?back:'/contest-radar/')+'">공모전 목록</a>'+
    '<h1>'+escape(item.title)+'</h1><p class="meta">'+escape(item.host)+' · '+statuses[item.status]+' · '+deadline(item)+'</p><div>'+badges(item)+'</div>'+official(item.url)+
    section('공모 주제',item.topic)+section('참가 자격',item.eligibility)+section('공고일',item.announced)+
    section('접수기간',item.start+' ~ '+item.end+(item.time?' '+item.time:' · 마감 시각 미공개'))+
    section('제출 형식',item.format||item.types.join(', '))+section('시상',item.prize)+
    (item.attachments.length?'<h2>공식 첨부파일</h2><ul>'+item.attachments.map(a=>'<li>'+official(a.url,a.label)+'</li>').join('')+'</ul>':'')+
    '<h2>일정 변경 이력</h2>'+(changes?'<ul>'+changes+'</ul>':'<p class="note">기록된 변경 없음</p>')+section('마지막 확인',stamp(item.checked))+'</article>';
}
const fields = {title:'제목',host:'주최기관',url:'공식 공고 URL',candidateUrl:'후보 출처 URL',number:'공고번호',edition:'회차',...labels,
                eligibility:'참가 자격 및 제한',eligibilityEvidence:'참가 자격의 공식 근거',deadlineEvidence:'마감일의 공식 근거',topic:'공모 주제',format:'제출 형식',
                prize:'시상·상금',correctionUrl:'정정 공고 URL',reviewReason:'검토 메모',attachments:'공식 첨부파일 (줄마다 이름 | URL)'};
function admin() {
  main.innerHTML='<article class="detail"><a href="/">공모전 목록</a><h1>공고 관리</h1><form id="auth" class="editor"><label>관리자 토큰<input type="password" name="token" autocomplete="current-password" required></label><label>관리번호<input type="password" inputmode="numeric" name="pin"></label><button class="btn main">접속</button></form><p id="message" role="status"></p><div id="admin-data"></div></article>';
  const area=document.querySelector('#admin-data');
  const message=document.querySelector('#message');
  let token='';
  let pin='';
  const request = (path='/api/admin',data) => api(path,{method:data===undefined?'GET':'POST',
    headers:{Authorization:'Bearer '+token,'X-Radar-Pin':pin,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  async function load() {
    const result=await request();
    area.innerHTML='<h2>출처 수집 상태</h2><button type="button" class="btn" id="collect">지금 수집</button>'+
      result.sources.map(s=>'<div class="admin-row"><div><strong>'+escape(s.name)+' · '+escape(s.status)+'</strong><p>'+escape(s.method)+'</p><p class="note">마지막 성공 '+escape(stamp(s.lastSuccess))+'</p><p class="error">'+escape(s.error||'')+'</p></div>'+official(s.url,'출처 보기')+'</div>').join('')+
      '<h2>최근 실행</h2>'+result.runs.map(r=>'<p>'+escape(stamp(r.started))+' · '+escape(r.mode)+' · '+escape(r.status)+'</p>').join('')+
      '<h2>등록 및 검토</h2><button type="button" class="btn" id="new">직접 등록</button><div id="editor"></div>'+
      result.items.map(i=>'<div class="admin-row"><div><strong>'+escape(i.title)+'</strong><p class="note">'+(i.published?'공개':'검토 대기')+' · '+escape(i.host)+'</p><p>'+escape(i.reviewReason)+'</p></div><div><button type="button" class="btn" data-edit="'+i.id+'">편집</button> <button type="button" class="btn" data-remove="'+i.id+'">삭제</button></div></div>').join('');
    area.querySelector('#new').onclick=()=>editor({});
    area.querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>editor(result.items.find(i=>i.id===Number(button.dataset.edit))));
    area.querySelectorAll('[data-remove]').forEach(button=>button.onclick=async()=>{
      const item=result.items.find(i=>i.id===Number(button.dataset.remove));
      if (!window.confirm(item.title+' 공고를 목록에서 삭제하시겠습니까?')) return;
      try {
        await request('/api/admin/remove',{id:item.id});
        await load();
        message.textContent='공고를 삭제했습니다.';
      } catch(error) {message.textContent=error.message;}
    });
    area.querySelector('#collect').onclick=async event=>{
      event.target.disabled=true;
      message.textContent='수집 중…';
      try {await request('/api/admin/collect',{});message.textContent='수집을 마쳤습니다.';await load();}
      catch(error){message.textContent=error.message;event.target.disabled=false;}
    };
  }
  function editor(item) {
    const container=area.querySelector('#editor');
    const attachments=(item.attachments||[]).map(a=>a.label+' | '+a.url).join('\n');
    const fieldsHtml=Object.entries(fields).map(([key,label])=>{
      const value=key==='attachments'?attachments:item[key];
      return '<label>'+label+(['eligibility','topic','format','prize','attachments'].includes(key)?
        '<textarea name="'+key+'">'+escape(value)+'</textarea>':
        '<input name="'+key+'" value="'+escape(value)+'" '+(key==='title'?'required':'')+' '+(['announced','start','end'].includes(key)?'type="date"':'')+'>')+'</label>';
    }).join('');
    const checks=(name,values)=>'<div class="checks">'+values.map(value=>'<label><input type="checkbox" name="'+name+'" value="'+escape(value)+'" '+(item[name]?.includes(value)?'checked':'')+'>'+escape(value)+'</label>').join('')+'</div>';
    container.innerHTML='<form class="editor panel">'+(item.candidateUrl?official(item.candidateUrl,'후보 출처 열기'):'')+
      '<div class="grid">'+fieldsHtml+'</div><fieldset><legend>분류</legend>'+checks('tags',tags)+'</fieldset><fieldset><legend>제출 유형</legend>'+checks('types',types)+'</fieldset>'+
      '<label class="switch"><input type="checkbox" name="education" '+(item.education?'checked':'')+'> 교육행정직 맞춤</label>'+
      '<label class="switch"><input type="checkbox" name="published" '+(item.published?'checked':'')+'> 공식 원문에서 참가 자격과 접수기간을 확인했고 공개합니다.</label><button class="btn main">공고 저장</button><p role="status"></p></form>';
    container.querySelector('input[name=title]').focus();
    container.querySelector('form').onsubmit=async event=>{
      event.preventDefault();
      const form=new FormData(event.target);
      const record=Object.fromEntries(form);
      const status=event.target.querySelector('[role=status]');
      try {
        record.id=item.id;
        record.tags=form.getAll('tags');
        record.types=form.getAll('types');
        record.education=form.has('education');
        record.published=form.has('published');
        record.attachments=record.attachments.split('\n').filter(line=>line.trim()).map(line=>{
          const [label,url]=line.split('|').map(value=>value.trim());
          if (!label||!url) throw new Error('첨부파일은 이름 | URL 형식으로 입력해 주세요.');
          return {label,url};
        });
        await request('/api/admin',record);
        message.textContent='공고를 저장했습니다.';
        await load();
      } catch(error) {status.textContent=error.message;}
    };
  }
  document.querySelector('#auth').onsubmit=async event=>{
    event.preventDefault();
    token=event.target.elements.token.value;
    pin=event.target.elements.pin.value;
    try {await load();event.target.reset();message.textContent='관리자 인증이 완료되었습니다.';}
    catch(error){area.textContent='';token='';pin='';message.textContent=error.message;}
  };
}
if (new URLSearchParams(location.search).get('admin')==='1') admin();
else if (/^\d+$/.test(new URLSearchParams(location.search).get('id')||'')) detail().catch(error=>{
  main.textContent=error.message;
  const back=document.createElement('a');back.href='/contest-radar/';back.textContent=' 공모전 목록';main.append(back);
});
else home();
