(()=>{
  const {api,el,row,safeURL,imageURL,priceLabel}=window.JiniNews,$=s=>document.querySelector(s);
  let archive=false,offset=0,posts=[],generation=0;
  const reactionCounts=new Map();
  function syncReactionCounts(id,counts){reactionCounts.set(id,counts);render();}
  let filters={},venueGeneration=0;
  const searchForm=$('#news-search');
  async function loadVenues(){const run=++venueGeneration;try{const data=await api(`/news/venues?archive=${archive?1:0}`);if(run!==venueGeneration)return;const select=$('#venue-select'),selected=select.value,values=[...new Set([...data.venues,...(selected?[selected]:[])])];select.replaceChildren(el('option','전체 장소'));select.firstElementChild.value='';for(const value of values){const option=el('option',value);option.value=value;select.append(option);}select.value=selected;}catch{/* Existing place choices remain available if suggestions fail. */}}
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
    const kinds=[['like','👍','좋아요'],['thanks','🙏','고마워요'],['dislike','👎','싫어요'],['excited','😍','기대돼요'],['cheer','🎉','응원해요'],['sad','😢','아쉬워요']];
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
  searchForm.elements.month.addEventListener('change',()=>{if(searchForm.elements.month.value)searchForm.elements.date.value='';});
  searchForm.elements.date.addEventListener('change',()=>{if(searchForm.elements.date.value)searchForm.elements.month.value='';});
  function render(){const category=$('#category').value;const filtered=posts.filter(p=>!category||p.category===category);$('#list').replaceChildren(...filtered.map((p,index)=>row({...p,reactions:reactionCounts.get(p.id)||p.reactions},index)));if(!filtered.length)$('#list').append(el('p','표시할 소식이 없어요.','news-empty'));}
  async function load(reset=true){
    const run=++generation;
    if(reset){offset=0;posts=[];reactionCounts.clear();render();$('#more').hidden=true;}$('#more').disabled=true;$('#list').setAttribute('aria-busy','true');status('소식을 불러오고 있어요.');
    const params=new URLSearchParams({...filters,archive:archive?1:0,offset,limit:30,category:$('#category').value});
    try{const data=await api('/news?'+params);if(run!==generation)return;posts.push(...data.posts);offset+=data.posts.length;render();$('#more').hidden=!data.hasMore;status(`검색 결과 ${data.total.toLocaleString('ko-KR')}건 · ${posts.length}건 표시`);}catch(e){if(run===generation)status(e.message);}finally{if(run===generation){$('#more').disabled=false;$('#list').setAttribute('aria-busy','false');}}
  }
  async function detail(id){
    const run=++detailGeneration;
    const d=$('#detail'),content=$('#detail-content');content.replaceChildren(el('p','불러오고 있어요.'));if(!d.open)d.showModal();
    try{
      const {post:p}=await api(`/news/posts/${encodeURIComponent(id)}/view`,{method:'POST'});
      if(run!==detailGeneration)return;
      posts=posts.map(item=>item.id===p.id?{...item,views:p.views}:item);render();
      content.replaceChildren(el('p',`${p.category} · 조회 ${p.views.toLocaleString('ko-KR')}회`,'muted'),el('h2',`${p.cancelled?'[취소] ':''}${p.title}`));
      for(const [label,value] of [['언제',[p.startDate,p.endDate&&p.endDate!==p.startDate?'~ '+p.endDate:'',p.time].filter(Boolean).join(' ')],['어디서',p.venueGroup],['관람료',priceLabel(p.price)],['관람 대상',p.audience]])content.append(el('div',`${label}  ·  ${value||'공식 안내 확인'}`,'detail-line'));
      if(p.description)content.append(el('p',p.description,'description'));
      content.append(reactions(p.id));
      for(const url of (p.images||[])){const src=imageURL(url);if(!src)continue;const img=el('img');img.src=src;img.alt=`${p.title} 안내 이미지`;img.loading='lazy';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>img.replaceWith(el('p','사진을 불러오지 못했어요. 공식 안내에서 확인해 주세요.','muted')));content.append(img);}
      if(safeURL(p.link)){const a=el('a','공식 안내·예매 바로가기 ↗','button');a.href=safeURL(p.link);a.target='_blank';a.rel='noopener noreferrer';content.append(a);}
    }catch(e){if(run===detailGeneration)content.replaceChildren(el('p',e.message));}
  }
  $('#list').addEventListener('click',e=>{const a=e.target.closest('a.news-row');if(!a||e.ctrlKey||e.metaKey)return;e.preventDefault();const id=new URL(a.href).searchParams.get('post');history.replaceState(null,'',`?post=${encodeURIComponent(id)}`);detail(id);});
  $('#upcoming').onclick=()=>{archive=false;$('#upcoming').setAttribute('aria-pressed','true');$('#archive').setAttribute('aria-pressed','false');load();loadVenues();};
  $('#archive').onclick=()=>{archive=true;$('#upcoming').setAttribute('aria-pressed','false');$('#archive').setAttribute('aria-pressed','true');load();loadVenues();};
  searchForm.onsubmit=e=>{e.preventDefault();const values=Object.fromEntries(new FormData(searchForm));filters=Object.fromEntries(Object.entries(values).filter(([,value])=>String(value).trim()).map(([name,value])=>[name,String(value).trim()]));load();};
  $('#search-reset').onclick=()=>{searchForm.reset();$('#category').value='';filters={};load();};
  $('#category').onchange=()=>load();$('#more').onclick=()=>load(false);$('#detail').addEventListener('close',()=>{detailGeneration++;history.replaceState(null,'',location.pathname);});
  load();loadVenues();const id=new URLSearchParams(location.search).get('post');if(id)detail(id);
})();
