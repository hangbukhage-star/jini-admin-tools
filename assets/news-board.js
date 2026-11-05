(()=>{
  const {api,el,renderListing,safeURL,imageURL,priceLabel}=window.JiniNews,$=s=>document.querySelector(s);
  let archive=false,offset=0,posts=[],generation=0;
  let adminToken='',deleteBusy=false;
  let pendingBulk=false;
  const selected=new Set();
  const reactionCounts=new Map();
  function syncReactionCounts(id,counts){reactionCounts.set(id,counts);render();}
  let filters={},venueGeneration=0;
  const searchForm=$('#news-search');
  async function loadVenues(){const run=++venueGeneration;try{const params=new URLSearchParams({archive:archive?1:0,region:$('#region-select').value});const data=await api(`/news/venues?${params}`);if(run!==venueGeneration)return;const select=$('#venue-select'),selected=select.value,values=[...new Set([...data.venues,...(selected?[selected]:[])])];select.replaceChildren(el('option','전체 장소'));select.firstElementChild.value='';for(const value of values){const option=el('option',value);option.value=value;select.append(option);}select.value=selected;}catch{/* Existing place choices remain available if suggestions fail. */}}
  let detailGeneration=0,visitorId='';
  function visitor(){
    if(visitorId)return visitorId;
    try{visitorId=localStorage.getItem('jini-news-visitor')||'';}catch{}
    if(!/^[a-f0-9-]{36}$/.test(visitorId)){visitorId=crypto.randomUUID();try{localStorage.setItem('jini-news-visitor',visitorId);}catch{}}
    return visitorId;
  }
  function reactions(id){
    const section=el('section',null,'news-reactions'),heading=el('p','이 소식, 어떠셨나요?','reaction-heading'),buttons=el('div',null,'reaction-buttons'),message=el('p','반응을 불러오고 있어요.','muted');
    section.setAttribute('aria-label','소식에 반응하기');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
    let selected=null,busy=false,ready=false;
    const kinds=[['like','👍','좋아요'],['dislike','👎','싫어요']];
    const controls=kinds.map(([kind,emoji,label])=>{
      const b=el('button',null,'reaction-button'),icon=el('span',emoji,'reaction-emoji'),count=el('span','0','reaction-count');b.type='button';icon.setAttribute('aria-hidden','true');b.setAttribute('aria-pressed','false');b.disabled=true;
      b.append(icon,el('span',label),count);buttons.append(b);
      b.onclick=()=>update(selected===kind?null:kind);
      return {kind,label,b,count};
    });
    function render(data){selected=data.selected;syncReactionCounts(id,data.counts);for(const {kind,label,b,count} of controls){count.textContent=Number(data.counts[kind]||0).toLocaleString('ko-KR');b.setAttribute('aria-pressed',String(selected===kind));b.setAttribute('aria-label',`${label} ${count.textContent}명${selected===kind?', 선택됨':''}`);}}
    async function update(reaction){
      if(busy)return;busy=true;controls.forEach(({b})=>b.disabled=true);if(retry)retry.hidden=true;
      try{const data=await api(`/news/posts/${encodeURIComponent(id)}/reactions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visitorId:visitor(),...(reaction!==undefined?{reaction}:{})})});render(data);ready=true;message.textContent=reaction===undefined?'한 글에 하나씩 선택할 수 있어요. 다시 누르면 취소돼요.':selected?'반응을 남겼어요. 다시 누르면 취소할 수 있어요.':'반응을 취소했어요.';}
      catch(e){message.textContent=e.message;if(retry)retry.hidden=false;}
      finally{busy=false;controls.forEach(({b})=>b.disabled=!ready);}
    }
    const retry=el('button','반응 다시 불러오기');retry.type='button';retry.hidden=true;retry.onclick=()=>update();
    section.append(heading,buttons,message,retry);update();return section;
  }
  const status=message=>{$('#status').textContent=message;};
  function updateBulk(){
    $('#archive-bulk').hidden=!archive;
    $('#archive-selection-count').textContent=`${selected.size}개 선택`;
    $('#archive-select-all').checked=posts.length>0&&selected.size===posts.length;
    $('#archive-select-all').indeterminate=selected.size>0&&selected.size<posts.length;
    $('#archive-select-all').disabled=deleteBusy||!posts.length;
    $('#archive-delete-selected').disabled=deleteBusy||!selected.size;
    $('#archive-delete-selected').textContent=adminToken?'선택한 글 삭제':'관리자 비밀번호 입력 후 삭제';
    for(const control of document.querySelectorAll('#upcoming,#archive,#archive-cleanup,#category,#quick-admin,#news-search input,#news-search select,#news-search button'))control.disabled=deleteBusy;
    for(const input of $('#list').querySelectorAll('.news-select input'))input.checked=selected.has(input.value);
  }
  function render(){const category=$('#category').value;const filtered=posts.filter(p=>!category||p.category===category);const options=adminToken?{onDelete:deletePost}:{};if(archive)Object.assign(options,{disabled:deleteBusy,isSelected:p=>selected.has(p.id),onSelect:(p,checked)=>{if(checked)selected.add(p.id);else selected.delete(p.id);updateBulk();}});renderListing($('#list'),filtered.map(p=>({...p,reactions:reactionCounts.get(p.id)||p.reactions})),category,options);for(const b of $('#list').querySelectorAll('.news-delete'))b.disabled=deleteBusy;updateBulk();}
  function loginForSelection(){pendingBulk=true;$('#quick-admin-status').textContent='';$('#quick-admin-dialog').showModal();$('#quick-admin-key').focus();}
  async function deleteSelected(){
    if(deleteBusy||!archive||!selected.size)return;
    if(!adminToken){loginForSelection();return;}
    const ids=[...selected];
    if(!confirm(`체크한 지난 소식 ${ids.length}개를 삭제함으로 옮길까요? 삭제함에서 복구할 수 있습니다.`))return;
    deleteBusy=true;render();let completed=0;
    try{
      for(let start=0;start<ids.length;start+=100){const chunk=ids.slice(start,start+100);const result=await api('/news/admin/bulk',{method:'POST',headers:{Authorization:`Bearer ${adminToken}`,'Content-Type':'application/json'},body:JSON.stringify({action:'delete',ids:chunk,pastOnly:true})});completed+=result.count;chunk.forEach(id=>selected.delete(id));}
      const refreshed=await load();status(`${completed}개 글을 삭제함으로 옮겼습니다.${refreshed?' 삭제함에서 복구할 수 있어요.':' 목록은 새로고침해 주세요.'}`);
    }catch(e){if(completed)await load();status(`${completed?`${completed}개 처리 후 중단했습니다. `:''}${e.message}`);}finally{deleteBusy=false;render();$('#more').disabled=false;}
  }
  async function deletePost(post){
    if(!adminToken||deleteBusy)return;
    if(!confirm(`“${post.title}” 글을 삭제함으로 옮길까요? 관리자 화면에서 복구할 수 있습니다.`))return;
    deleteBusy=true;render();
    try{
      await api('/news/admin/bulk',{method:'POST',headers:{Authorization:`Bearer ${adminToken}`,'Content-Type':'application/json'},body:JSON.stringify({action:'delete',ids:[post.id]})});
      if($('#detail').open)$('#detail').close();await load();status('삭제함으로 옮겼습니다. 관리자 화면에서 복구할 수 있어요.');
    }catch(e){status(e.message);}finally{deleteBusy=false;render();$('#more').disabled=false;}
  }
  async function load(reset=true){
    const run=++generation;
    if(reset){offset=0;posts=[];selected.clear();reactionCounts.clear();render();$('#more').hidden=true;}$('#more').disabled=true;$('#list').setAttribute('aria-busy','true');status('소식을 불러오고 있어요.');
    const params=new URLSearchParams({...filters,archive:archive?1:0,offset,limit:30,category:$('#category').value});
    try{const data=await api('/news?'+params);if(run!==generation)return false;posts.push(...data.posts);offset+=data.posts.length;render();$('#more').hidden=!data.hasMore;status(`검색 결과 ${data.total.toLocaleString('ko-KR')}건 · ${posts.length}건 표시`);return true;}catch(e){if(run===generation)status(e.message);return false;}finally{if(run===generation){$('#more').disabled=deleteBusy;$('#list').setAttribute('aria-busy','false');}}
  }
  async function detail(id){
    const run=++detailGeneration;
    const d=$('#detail'),content=$('#detail-content');content.replaceChildren(el('p','불러오고 있어요.'));if(!d.open)d.showModal();
    try{
      const {post:p}=await api(`/news/posts/${encodeURIComponent(id)}/view`,{method:'POST'});
      if(run!==detailGeneration)return;
      posts=posts.map(item=>item.id===p.id?{...item,views:p.views}:item);render();
      const summary=el('div',null,'detail-summary'),info=el('div',null,'detail-info'),posters=el('div',null,'detail-posters');
      info.append(el('p',`${p.category} · 조회 ${p.views.toLocaleString('ko-KR')}회`,'muted'),el('h2',`${p.cancelled?'[취소] ':''}${p.title}`));
      for(const url of (p.images||[])){const src=imageURL(url);if(!src)continue;const img=el('img',null,'detail-poster');img.src=src;img.alt=`${p.title} 포스터`;img.loading='eager';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>{img.remove();if(!posters.childElementCount)summary.classList.remove('has-posters');});posters.append(img);}
      for(const [label,value] of [['언제',[p.startDate,p.endDate&&p.endDate!==p.startDate?'~ '+p.endDate:'',p.time].filter(Boolean).join(' ')],['지역',p.region],['어디서',p.venue||p.venueGroup],['관람료',priceLabel(p.price)],['관람 대상',p.audience]])info.append(el('div',`${label}  ·  ${value||'공식 안내 확인'}`,'detail-line'));
      summary.append(info);if(posters.childElementCount){summary.classList.add('has-posters');summary.append(posters);}content.replaceChildren(summary);
      if(p.description)content.append(el('p',p.description,'description'));
      content.append(reactions(p.id));
      if(adminToken){const remove=el('button','이 글 삭제','news-delete');remove.type='button';remove.onclick=()=>deletePost(p);content.append(remove);}
      if(safeURL(p.link)){const a=el('a','공식 안내·예매 바로가기 ↗','button');a.href=safeURL(p.link);a.target='_blank';a.rel='noopener noreferrer';content.append(a);}
    }catch(e){if(run===detailGeneration)content.replaceChildren(el('p',e.message));}
  }
  $('#list').addEventListener('click',e=>{const a=e.target.closest('a.news-row');if(!a||e.ctrlKey||e.metaKey)return;e.preventDefault();const id=new URL(a.href).searchParams.get('post');history.replaceState(null,'',`?post=${encodeURIComponent(id)}`);detail(id);});
  $('#upcoming').onclick=()=>{archive=false;$('#upcoming').setAttribute('aria-pressed','true');$('#archive').setAttribute('aria-pressed','false');load();loadVenues();};
  $('#archive').onclick=()=>{archive=true;$('#upcoming').setAttribute('aria-pressed','false');$('#archive').setAttribute('aria-pressed','true');load();loadVenues();};
  $('#archive-cleanup').onclick=()=>{archive=true;$('#category').value='공연';$('#upcoming').setAttribute('aria-pressed','false');$('#archive').setAttribute('aria-pressed','true');load();loadVenues();};
  $('#archive-select-all').onchange=e=>{selected.clear();if(e.target.checked)posts.forEach(p=>selected.add(p.id));updateBulk();};
  $('#archive-delete-selected').onclick=deleteSelected;
  searchForm.onsubmit=e=>{e.preventDefault();const values=Object.fromEntries(new FormData(searchForm));filters=Object.fromEntries(Object.entries(values).filter(([,value])=>String(value).trim()).map(([name,value])=>[name,String(value).trim()]));load();};
  $('#search-reset').onclick=()=>{searchForm.reset();$('#category').value='공연';filters={};load();loadVenues();};
  $('#region-select').onchange=()=>{$('#venue-select').value='';loadVenues();};
  $('#quick-admin').onclick=()=>{
    if(adminToken){adminToken='';$('#quick-admin').textContent='관리자 로그인';render();status('관리자 모드를 종료했습니다.');return;}
    $('#quick-admin-status').textContent='';$('#quick-admin-dialog').showModal();$('#quick-admin-key').focus();
  };
  $('#quick-admin-close').onclick=()=>$('#quick-admin-dialog').close();
  $('#quick-admin-dialog').addEventListener('close',()=>{$('#quick-admin-key').value='';pendingBulk=false;});
  $('#quick-admin-form').onsubmit=async e=>{
    e.preventDefault();const button=e.submitter;button.disabled=true;const supplied=$('#quick-admin-key').value;
    try{await api('/news/admin/session',{headers:{Authorization:`Bearer ${supplied}`}});adminToken=supplied;const continueBulk=pendingBulk;$('#quick-admin-key').value='';$('#quick-admin-dialog').close();$('#quick-admin').textContent='관리자 종료';render();status('관리자 모드입니다. 각 글의 삭제 버튼을 사용할 수 있어요.');if(continueBulk)await deleteSelected();}
    catch(err){$('#quick-admin-key').value='';$('#quick-admin-status').textContent=err.message;}finally{button.disabled=false;}
  };
  $('#category').onchange=()=>load();$('#more').onclick=()=>load(false);$('#detail').addEventListener('close',()=>{detailGeneration++;history.replaceState(null,'',location.pathname+(archive?'?archive=1':''));});
  $('#category').value='공연';
  archive=['cleanup','archive'].some(name=>new URLSearchParams(location.search).get(name)==='1');if(archive){$('#upcoming').setAttribute('aria-pressed','false');$('#archive').setAttribute('aria-pressed','true');}
  load();loadVenues();const id=new URLSearchParams(location.search).get('post');if(id)detail(id);
})();
