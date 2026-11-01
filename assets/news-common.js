(() => {
  'use strict';
  const base=String(window.JINI_NEWS_CONFIG?.apiBase||window.JINI_STATS_CONFIG?.apiBase||'').replace(/\/$/,'');
  const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
  const safeURL=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}};
  const imageURL=value=>/^\/news\/images\/[a-f0-9-]+$/.test(value)?base+value:safeURL(value);
  function priceLabel(value){
    const price=String(value||'').trim();
    if(!price)return '요금 확인 필요';
    if(/^[\d,]+\s*원?$/.test(price)){const amount=Number(price.replace(/[^\d]/g,''));return amount===0?'무료':`유료 · ${amount.toLocaleString('ko-KR')}원`;}
    if(/무료|유료|초대/.test(price))return price;
    return /\d/.test(price)?`유료 · ${price}`:price;
  }
  async function api(path,options={}){if(!base)throw new Error('게시판 연결을 준비하고 있어요.');const r=await fetch(base+path,options);const data=await r.json();if(!r.ok)throw new Error(data.error||'요청을 처리하지 못했어요.');return data;}
  function row(post,index,card=false){
    const a=el('a',null,'news-row'),main=el('span',null,'news-row-main');a.href=`/news/?post=${encodeURIComponent(post.id)}`;
    main.append(el('strong',`${!card&&Number.isInteger(index)?`${index+1}. `:''}${post.pinned?'📌 ':''}${post.cancelled?'[취소] ':''}${post.title}`));
    const reactions=el('span',null,'news-row-reactions');
    for(const [kind,emoji,label] of [['like','👍','좋아요'],['dislike','👎','싫어요']]){
      const count=Number(post.reactions?.[kind])||0;if(!count)continue;
      const badge=el('span',`${emoji} ${count.toLocaleString('ko-KR')}`,'news-reaction-badge');badge.title=`${label} ${count.toLocaleString('ko-KR')}명`;badge.setAttribute('aria-label',badge.title);reactions.append(badge);
    }
    if(reactions.childElementCount)main.append(reactions);
    if(card){
      a.classList.add('news-card');
      const cover=el('span',null,'news-card-cover'),src=(post.images||[]).map(imageURL).find(Boolean);
      const fallback=()=>{cover.querySelector('img')?.remove();if(!cover.querySelector('.news-card-placeholder'))cover.prepend(el('span',post.category||'문화 소식','news-card-placeholder'));};
      if(src){const img=el('img');img.src=src;img.alt='';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.addEventListener('error',fallback,{once:true});cover.append(img);}else fallback();
      cover.append(el('span',post.category||'소식','news-card-category'));a.append(cover);
    }
    a.append(main,el('small',[post.startDate||'일정은 안내 참고',post.region,post.venueGroup||post.venue||'장소 확인 필요',priceLabel(post.price),`조회 ${(Number(post.views)||0).toLocaleString('ko-KR')}회`].filter(Boolean).join(' · ')));return a;
  }
  function renderListing(container,posts,category){
    const isCard=p=>['공연','전시'].includes(p.category);
    container.replaceChildren();
    if(category){
      const cards=['공연','전시'].includes(category);
      container.className=cards?'news-card-grid':'panel news-board-list';
      container.append(...posts.map((post,index)=>row(post,index,cards)));
    }else{
      container.className='news-mixed-list';
      for(const [heading,items,cards] of [['공연·전시',posts.filter(isCard),true],['평생·문화교육 / AI·디지털 교육',posts.filter(p=>!isCard(p)),false]]){
        if(!items.length)continue;
        const section=el('section',null,'news-list-section'),list=el('div',null,cards?'news-card-grid':'panel news-board-list');
        section.append(el('h2',heading));list.append(...items.map((post,index)=>row(post,index,cards)));section.append(list);container.append(section);
      }
    }
    if(!posts.length)container.append(el('p','표시할 소식이 없어요.','news-empty'));
  }
  window.JiniNews={base,el,safeURL,imageURL,api,row,priceLabel,renderListing};
})();
