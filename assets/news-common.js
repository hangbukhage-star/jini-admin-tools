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
  function row(post,index){const a=el('a',null,'news-row');a.href=`/news/?post=${encodeURIComponent(post.id)}`;a.append(el('strong',`${Number.isInteger(index)?`${index+1}. `:''}${post.pinned?'📌 ':''}${post.cancelled?'[취소] ':''}${post.title}`),el('small',[post.startDate||'일정은 안내 참고',post.venueGroup||'장소 확인 필요',priceLabel(post.price),`조회 ${(Number(post.views)||0).toLocaleString('ko-KR')}회`].filter(Boolean).join(' · ')));return a;}
  window.JiniNews={base,el,safeURL,imageURL,api,row,priceLabel};
})();
