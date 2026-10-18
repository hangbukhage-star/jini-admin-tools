(()=>{
  const {api,el,row,safeURL,imageURL,priceLabel}=window.JiniNews,$=s=>document.querySelector(s);
  let archive=false,offset=0,posts=[],generation=0;
  const status=message=>{$('#status').textContent=message;};
  function render(){const category=$('#category').value;const filtered=posts.filter(p=>!category||p.category===category);$('#list').replaceChildren(...filtered.map(row));if(!filtered.length)$('#list').append(el('p','표시할 소식이 없어요.','news-empty'));}
  async function load(reset=true){
    const run=++generation;
    if(reset){offset=0;posts=[];}$('#more').disabled=true;status('소식을 불러오고 있어요.');
    try{const data=await api(`/news?archive=${archive?1:0}&offset=${offset}&limit=30&category=${encodeURIComponent($('#category').value)}`);if(run!==generation)return;posts.push(...data.posts);offset+=data.posts.length;render();$('#more').hidden=!data.hasMore;status('');}catch(e){if(run===generation)status(e.message);}finally{if(run===generation)$('#more').disabled=false;}
  }
  async function detail(id){
    const d=$('#detail'),content=$('#detail-content');content.replaceChildren(el('p','불러오고 있어요.'));if(!d.open)d.showModal();
    try{
      const {post:p}=await api(`/news/posts/${encodeURIComponent(id)}/view`,{method:'POST'});
      posts=posts.map(item=>item.id===p.id?{...item,views:p.views}:item);render();
      content.replaceChildren(el('p',`${p.category} · 조회 ${p.views.toLocaleString('ko-KR')}회`,'muted'),el('h2',`${p.cancelled?'[취소] ':''}${p.title}`));
      for(const [label,value] of [['언제',[p.startDate,p.endDate&&p.endDate!==p.startDate?'~ '+p.endDate:'',p.time].filter(Boolean).join(' ')],['어디서',p.venue],['관람료',priceLabel(p.price)],['관람 대상',p.audience]])content.append(el('div',`${label}  ·  ${value||'공식 안내 확인'}`,'detail-line'));
      if(p.description)content.append(el('p',p.description,'description'));
      for(const url of (p.images||[])){const src=imageURL(url);if(!src)continue;const img=el('img');img.src=src;img.alt=`${p.title} 안내 이미지`;img.loading='lazy';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>img.replaceWith(el('p','사진을 불러오지 못했어요. 공식 안내에서 확인해 주세요.','muted')));content.append(img);}
      if(safeURL(p.link)){const a=el('a','공식 안내·예매 바로가기 ↗','button');a.href=safeURL(p.link);a.target='_blank';a.rel='noopener noreferrer';content.append(a);}
    }catch(e){content.replaceChildren(el('p',e.message));}
  }
  $('#list').addEventListener('click',e=>{const a=e.target.closest('a.news-row');if(!a||e.ctrlKey||e.metaKey)return;e.preventDefault();const id=new URL(a.href).searchParams.get('post');history.replaceState(null,'',`?post=${encodeURIComponent(id)}`);detail(id);});
  $('#upcoming').onclick=()=>{archive=false;$('#upcoming').setAttribute('aria-pressed','true');$('#archive').setAttribute('aria-pressed','false');load();};
  $('#archive').onclick=()=>{archive=true;$('#upcoming').setAttribute('aria-pressed','false');$('#archive').setAttribute('aria-pressed','true');load();};
  $('#category').onchange=()=>load();$('#more').onclick=()=>load(false);$('#detail').addEventListener('close',()=>history.replaceState(null,'',location.pathname));
  load();const id=new URLSearchParams(location.search).get('post');if(id)detail(id);
})();
