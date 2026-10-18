(()=>{
  'use strict';
  const {api,el,imageURL,safeURL,base}=window.JiniNews,$=s=>document.querySelector(s);
  let token='',state='pending',offset=0,posts=[],images=[],current={};
  const selected=new Set();
  let bulkBusy=false;
  const status=(message,error=false)=>{const e=$('#status');e.textContent=message;e.classList.toggle('news-error',error);};
  async function admin(path='',options={}){return api('/news/admin'+path,{...options,headers:{'Content-Type':'application/json',...options.headers,Authorization:`Bearer ${token}`}});}
  const send=(path,data)=>admin(path,{method:'POST',body:JSON.stringify(data)});
  function button(text,fn){const b=el('button',text);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){status(e.message,true);}finally{b.disabled=false;}};return b;}
  function updateSelection(){
    const count=selected.size,all=$('#select-all'),deleted=state==='deleted';
    all.checked=posts.length>0&&count===posts.length;
    all.indeterminate=count>0&&count<posts.length;
    all.disabled=bulkBusy||!posts.length;
    $('#selection-count').textContent=`${count}개 선택`;
    for(const [id,show] of [['bulk-publish',!deleted],['bulk-hide',!deleted],['bulk-delete',!deleted],['bulk-restore',deleted]]){
      $(('#'+id)).hidden=!show;$(('#'+id)).disabled=bulkBusy||count===0;
    }
    for(const input of $('#posts').querySelectorAll('input[type=checkbox]')){input.checked=selected.has(input.value);input.disabled=bulkBusy;input.closest('.post-summary').classList.toggle('is-selected',input.checked);}
    for(const b of document.querySelectorAll('#tabs button,#posts button,#more,#refresh,#new-post'))b.disabled=bulkBusy;
    $('#bulk-help').textContent=deleted?'삭제한 글은 자동 수집으로 다시 게시되지 않습니다. 선택 복구하면 확인 대기 목록으로 돌아갑니다.':'체크한 글만 한 번에 처리합니다. 전체 선택은 현재 불러온 목록에 적용됩니다.';
  }
  async function processBulk(action,ids=[...selected]){
    if(bulkBusy||!ids.length)return;
    bulkBusy=true;updateSelection();
    const names={publish:'게시',hide:'숨김',delete:'삭제',restore:'복구'};
    status(`${ids.length}개 글을 처리하고 있어요.`);
    let completed=0;
    try{
      for(let start=0;start<ids.length;start+=100){const result=await send('/bulk',{action,ids:ids.slice(start,start+100)});completed+=result.count;status(`${completed}/${ids.length}개 글을 처리했어요.`);}
      await load();status(`${completed}개 글을 ${names[action]}했습니다.${action==='restore'?' 확인 대기 목록에서 확인하세요.':''}`);
    }
    catch(e){if(completed){try{await load();}catch{}status(`${completed}개 처리 후 중단했습니다. ${e.message} 남은 글을 다시 선택해 주세요.`,true);}else status(e.message,true);}
    finally{bulkBusy=false;updateSelection();}
  }
  function postRow(p,changed=false,index){
    const row=el('div',null,'post-summary'),copy=el('div',null,'post-summary-copy');
    if(!changed){const checkbox=el('input');checkbox.type='checkbox';checkbox.value=p.id;checkbox.checked=selected.has(p.id);checkbox.setAttribute('aria-label',`${p.title} 선택`);checkbox.addEventListener('change',()=>{if(checkbox.checked)selected.add(p.id);else selected.delete(p.id);updateSelection();});row.append(checkbox);}
    copy.append(el('strong',`${Number.isInteger(index)?`${index+1}. `:''}${p.title}`),el('p',[p.category,p.startDate||'일정 확인 필요',p.venue||'장소 확인 필요',`조회 ${(Number(p.views)||0).toLocaleString('ko-KR')}회`,p.locked?'직접 수정 보호':''].filter(Boolean).join(' · ')));
    if(p.status==='pending'&&p.recommendation)copy.append(el('p',`추천 분류: ${p.recommendation.category}${p.recommendation.needsReview?' · 확인 필요':''}`,'category-recommendation'));
    row.append(copy,state==='deleted'&&!changed?button('복구',()=>processBulk('restore',[p.id])):button(changed?'변경 내용 확인':'확인·수정',()=>editPost(p,changed)));return row;
  }
  async function load(reset=true){
    const data=await admin(`?status=${state}&offset=${reset?0:offset}`);
    if(reset){offset=0;posts=[];selected.clear();}
    posts.push(...data.posts);offset+=data.posts.length;
    $('#posts').replaceChildren(...posts.map((p,index)=>postRow(p,false,index)));if(!posts.length)$('#posts').append(el('p','해당하는 글이 없어요.','muted'));
    $('#more').hidden=!data.hasMore;
    $('#changes').replaceChildren(...data.changes.map((p,index)=>postRow(p,true,index)));if(!data.changes.length)$('#changes').append(el('p','확인할 변경 사항이 없어요.','muted'));
    $('#sources').replaceChildren(...data.sources.map(source=>{
      const e=el('div',null,'source');e.append(el('strong',source.name),el('p',`${source.enabled?'수집 켜짐':'수집 꺼짐'} · ${source.auto_publish?'자동 게시':'확인 후 게시'}`,'muted'),el('p',`마지막 성공: ${source.last_success?new Date(source.last_success).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'아직 없음'} · 최근 ${source.last_count}개 확인`,'muted'));
      if(source.last_error)e.append(el('p',source.last_error,'news-error'));
      const actions=el('div',null,'actions');actions.append(button('설정',()=>editSource(source)),button('지금 확인',async()=>{status(`${source.name} 소식을 확인하고 있어요.`);const r=await send('/collect',{sourceId:source.id});await load();const item=r.results?.[0];status(item?.ok?`${item.count}개 소식을 확인했어요.`:item?.error||'다른 수집이 진행 중이에요.',!item?.ok);}));e.append(actions);return e;
    }));
    for(const b of $('#tabs').querySelectorAll('button')){const c=data.counts.find(x=>x.status===b.dataset.status)?.count||0;const label={pending:'확인 대기',published:'게시 중',hidden:'숨김',deleted:'삭제함'}[b.dataset.status];b.textContent=`${label} ${c}`;b.setAttribute('aria-pressed',String(state===b.dataset.status));}
    updateSelection();
  }
  async function preview(){
    $('#preview').replaceChildren();
    for(const value of images){const src=imageURL(value);if(!src)continue;const img=el('img');img.alt='첨부 사진';
      if(value.startsWith('/news/images/')){const r=await fetch(src,{headers:{Authorization:`Bearer ${token}`}});if(r.ok){img.src=URL.createObjectURL(await r.blob());img.onload=()=>URL.revokeObjectURL(img.src);}}
      else img.src=src;
      $('#preview').append(img);
    }
  }
  function fill(form,data){form.reset();for(const [name,value] of Object.entries(data)){const input=form.elements.namedItem(name);if(!input)continue;if(input.type==='checkbox')input.checked=!!value;else input.value=value??'';}}
  async function editPost(p={},changed=false){
    current={...p};const value=changed?{...p,...p.candidate}:p;
    fill($('#post-form'),{category:'공연',...value});images=[...(value.images||[])];$('#upload').value='';
    $('#editor-title').textContent=changed?'원문 변경 내용 확인':p.id?'소식 확인·수정':'직접 소식 올리기';
    $('#previous-value').hidden=!changed;
    $('#previous-value').textContent=changed?`현재 게시 내용: ${p.title} / ${p.startDate||'일정 없음'} / ${p.time||''} / ${p.venue||'장소 없음'} / ${p.price||'가격 미정'}`:'';
    $('#original-link').hidden=!safeURL(value.link);$('#original-link').href=safeURL(value.link)||'#';
    const suggestion=value.recommendation;
    $('#category-suggestion').hidden=!suggestion;
    $('#category-reason').textContent=suggestion?`추천 분류: ${suggestion.category} · ${suggestion.reason} 직접 수정한 분류는 그대로 유지됩니다.`:'';
    $('#apply-category').onclick=()=>{if(suggestion){$('#post-form').elements.category.value=suggestion.category;$('#category-reason').textContent=`${suggestion.category} 추천을 적용했어요. 저장 버튼을 눌러 반영하세요.`;}};
    $('#post-warning').textContent=changed?'아래는 새로 수집한 내용입니다. 기존 글과 비교해 확인한 후 게시하세요.':(!value.startDate||!value.venue)?'날짜·장소가 없는 항목은 원문을 확인해 채워주세요. 일반 소식은 비워둘 수 있어요.':'';
    $('#editor').showModal();await preview();
  }
  function editSource(s={}){fill($('#source-form'),{...s,enabled:s.enabled??1,autoPublish:!!s.auto_publish,imagesAllowed:!!s.images_allowed,config:s.config||'{}',adapter:s.adapter||'generic'});$('#source-editor').showModal();}
  async function compress(file){
    const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    for(let quality=.82;quality>=.22;quality-=.1){const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=180000)return blob;}
    throw new Error('사진 크기를 더 줄인 후 다시 올려주세요.');
  }
  $('#login').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;token=$('#key').value;try{await load();$('#key').value='';$('#login').hidden=true;$('#workspace').hidden=false;$('#logout').hidden=false;status('관리자 연결이 완료됐어요.');}catch(err){token='';status(err.message,true);}finally{b.disabled=false;}};
  $('#logout').onclick=()=>{token='';location.reload();};
  $('#tabs').onclick=async e=>{if(!e.target.dataset.status)return;state=e.target.dataset.status;try{await load();}catch(err){status(err.message,true);}};
  $('#select-all').onchange=e=>{selected.clear();if(e.target.checked)posts.forEach(p=>selected.add(p.id));updateSelection();};
  for(const [id,action] of [['bulk-publish','publish'],['bulk-hide','hide'],['bulk-delete','delete'],['bulk-restore','restore']])$('#'+id).onclick=()=>processBulk(action);
  $('#new-post').onclick=()=>editPost();$('#new-source').onclick=()=>editSource();
  $('#refresh').onclick=async()=>{try{await load();status('목록을 새로 불러왔어요.');}catch(e){status(e.message,true);}};
  $('#more').onclick=async()=>{try{await load(false);}catch(e){status(e.message,true);}};
  $('#close-editor').onclick=()=>$('#editor').close();$('#close-source').onclick=()=>$('#source-editor').close();
  $('#clear-images').onclick=()=>{images=[];preview();};
  $('#upload').onchange=async e=>{const buttons=[...$('#post-form').querySelectorAll('button[type=submit]')];buttons.forEach(b=>b.disabled=true);try{const files=[...e.target.files];if(files.length+images.length>3)throw new Error('사진은 최대 3장까지 올릴 수 있어요.');for(const file of files){if(file.size>15000000)throw new Error('원본 사진은 15MB 이하로 선택해 주세요.');const blob=await compress(file);const result=await admin('/image',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob});images.push(result.url);}await preview();}catch(err){alert(err.message);}finally{e.target.value='';buttons.forEach(b=>b.disabled=false);}};
  $('#post-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const values=Object.fromEntries(new FormData(e.target));await send('/post',{...values,images,status:b.value,pinned:e.target.elements.pinned.checked,cancelled:e.target.elements.cancelled.checked});$('#editor').close();await load();status('저장했어요.');}catch(err){alert(err.message);}finally{b.disabled=false;}};
  $('#source-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const f=e.target,values=Object.fromEntries(new FormData(f));await send('/source',{...values,enabled:f.elements.enabled.checked,autoPublish:f.elements.autoPublish.checked,imagesAllowed:f.elements.imagesAllowed.checked});$('#source-editor').close();await load();status('사이트 설정을 저장했어요.');}catch(err){alert(err.message);}finally{b.disabled=false;}};
  $('#cleanup').onclick=async()=>{try{const r=await send('/cleanup-images',{});status(`어느 글에서도 사용하지 않는 사진 ${r.removed}개를 정리했어요. 최근 24시간 이내 사진은 보관합니다.`);}catch(e){status(e.message,true);}};
  $('#export').onclick=async()=>{
    $('#export').disabled=true;
    try{
      const data=await admin('/export');
      for(let i=0;i<data.images.length;i++){
        status(`백업 사진 ${i+1}/${data.images.length}개를 가져오고 있어요.`);
        const r=await fetch(`${base}/news/admin/backup-image/${data.images[i].id}`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error('백업 사진을 가져오지 못했어요. 다시 시도해 주세요.');
        data.images[i].hex=[...new Uint8Array(await r.arrayBuffer())].map(v=>v.toString(16).padStart(2,'0')).join('');
      }
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download=`jini-news-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('게시글·사이트 설정·사진이 포함된 백업을 내려받았어요.');
    }catch(e){status(e.message,true);}finally{$('#export').disabled=false;}
  };
})();
