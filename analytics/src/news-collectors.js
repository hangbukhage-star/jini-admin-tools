import { parseHTML } from 'linkedom';
import {clean,publicURL,day,category,koreaToday} from './news-core.js';
export * from './news-core.js';

export function decodeHTML(bytes) {
  try { return new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
  catch { return new TextDecoder('euc-kr').decode(bytes); }
}
// Remote HTML is data only; it is never executed or returned as page markup.
export function documentOf(html) {
  const { document } = parseHTML(html);
  document.querySelectorAll('script,style,nav,header,footer').forEach(e => e.remove());
  document.querySelectorAll('br').forEach(e => e.replaceWith('\n'));
  return document;
}
const text = (root, selector) => clean(root.querySelector(selector)?.textContent);
function pairs(root) {
  const values = {};
  for(const row of root.querySelectorAll('.skinlist,li')) {
    const first=row.firstElementChild,second=first?.nextElementSibling;
    if(first && second && !['UL','OL'].includes(second.tagName)) values[clean(first.textContent)]=clean(second.textContent);
  }
  for (const row of root.querySelectorAll('li,dl,tr')) {
    const key = row.querySelector('dt,th,strong,span.tit,span.title');
    const val = row.querySelector('dd,td');
    if (key && val) values[clean(key.textContent)] = clean(val.textContent);
  }
  // Some institutions use div/span rows instead of tables.
  for (const e of root.querySelectorAll('dt,th,.label')) {
    if(e.nextElementSibling) values[clean(e.textContent)] = clean(e.nextElementSibling.textContent);
  }
  return values;
}
function label(root, names) {
  const p = pairs(root);
  for (const n of names) if (Object.hasOwn(p,n)) return p[n];
  const s = clean(root.textContent);
  const labels = '공연대상|일정|기간|공연시간|시간|공연장소|장소|연령|가격|관람료|주최|주관|문의|담당자|접수기간|1인당|신청자';
  for(const n of names) {
    const m = s.match(new RegExp(`(?:^|\\s)${n}\\s*[:：]?\\s*(.*?)(?=\\s(?:${labels})(?:\\s|[:：])|$)`));
    if(m?.[1]) return clean(m[1]);
  }
  return '';
}
function images(root, selector, url) {
  return [...new Set([...root.querySelectorAll(selector)].map(e => publicURL(e.getAttribute('src'), url)).filter(Boolean))].slice(0,3);
}
export function dateRange(value) {
  const raw=String(value),matches=[...raw.matchAll(/20\d{2}\s*[.년/-]\s*\d{1,2}\s*[.월/-]\s*\d{1,2}/g)];
  const dates=matches.map(m=>day(m[0])).filter(Boolean);
  if(dates.length!==1)return [dates[0]||'',dates[1]||dates[0]||''];
  const tail=raw.slice(matches[0].index+matches[0][0].length);
  const short=tail.match(/^[\s.일]*(?:\([^)]*\))?\s*[~～–—]\s*(?:(\d{1,2})\s*[.월/]\s*)?(\d{1,2})\s*(?:[.일]|\(|$)/);
  if(!short)return [dates[0],dates[0]];
  let year=Number(dates[0].slice(0,4));const startMonth=Number(dates[0].slice(5,7)),month=Number(short[1]||startMonth);
  if(short[1]&&month<startMonth)year++;
  const end=day(`${year}-${month}-${short[2]}`);
  return [dates[0],end&&end>=dates[0]?end:dates[0]];
}
function formattedField(root,names){
  for(const name of names){const pattern=name.replace(/\s/g,'').split('').join('\\s*');const re=new RegExp(`^\\s*${pattern}\\s*[:：|｜]\\s*(.+)$`);
    for(const row of root.querySelectorAll('li,p,tr')){const match=clean(row.textContent).match(re);if(match)return clean(match[1]);}
  }
  return '';
}
export function parseDetail(html, url, source, hint = '') {
  const root = documentOf(html);
  const config = JSON.parse(source.config || '{}');
  let title = '', dateText = '', venue = '', time = '', price = '', audience = '', pics = [];
  if (source.adapter === 'sori') {
    const box = root.querySelector('.skinveiw-detail') || root.querySelector('.skinviewtop');
    if (!box) throw new Error('공연 상세 구조가 바뀌었습니다.');
    title = text(box, '.sktit,h2,h3,h4,.tit,.title') || hint;
    dateText = label(box,['기간']); time = label(box,['시간']); venue = label(box,['장소']);
    price = label(box,['가격']); audience = label(box,['연령']);
    if(venue) venue = `한국소리문화의전당 ${venue}`;
    pics = images(root,'.notboximg img,.skinviewdetail img',url);
  } else if (source.adapter === 'culturePerform') {
    const box = root.querySelector('#contents') || root.querySelector('.view') || root.body;
    title = text(box, 'h3') || text(box, '.view-tit, .title') || hint;
    dateText = label(box,['기간','공연기간','공연일시']); time = label(box,['시간','공연시간']); venue = label(box,['장소','공연장소']);
    price = label(box,['가격']); audience = label(box,['관람연령','연령']);
    pics = images(box,'img',url);
  } else if (source.adapter === 'ssac') {
    const box = root.querySelector('.view_wrap,.view_con,.cont_view,#contents') || root.body;
    title = text(root,'meta[property="og:title"]') || text(box,'h3,h2,h4,.title,.tit') || hint;
    dateText = label(box,['기간','공연기간','전시기간','일정']);
    time = label(box,['시간','공연시간']);
    venue = label(box,['장소','공연장소','전시장소']);
    price = label(box,['티켓','티켓가격','관람료','가격']);
    audience = label(box,['관람연령','연령']);
    if(venue) venue = `전북대학교 삼성문화회관 ${venue}`;
    pics = images(box,'img',url);
  } else if (source.adapter === 'nol') {
    const box = root.querySelector('main') || root.body;
    title = text(root,'h1') || root.querySelector('meta[property="og:title"]')?.getAttribute('content') || hint.split(/\s+전북\s*[·・]/)[0];
    dateText = label(box,['기간','공연기간','이용기간']);
    time = label(box,['시간','공연시간']);
    venue = label(box,['장소','공연장소']);
    price = box.querySelector('#prices')?.textContent || '';
    if(!price) price = [...box.querySelectorAll('dt')].filter(e=>/전석|좌석|티켓|성인|청소년|아동|가격/.test(clean(e.textContent))).map(e=>clean(e.parentElement?.textContent)).join(' / ');
    audience = label(box,['연령','관람연령']);
    pics = images(box,'img',url);
  } else if (source.adapter === 'nihc') {
    const box = root.querySelector('.view') || root.querySelector('.board_view') || root.querySelector('#contents') || root.body;
    title = text(root,'.info-tit') || label(box,['제목']) || hint.replace(/20\d{2}[\s\S]*$/,'').trim();
    // The title label sometimes shares a single flat info list with other fields.
    if(title.length > 160) title = hint.replace(/20\d{2}[\s\S]*$/,'').trim();
    dateText = label(box,['일정']); time = label(box,['공연시간']); venue = label(box,['공연장소']);
    audience = label(box,['공연대상']); price = label(box,['관람료','가격']);
    pics = images(root,'.thumbBox3 img,img.smartEdiImg',url);
  } else if (source.adapter === 'woojin') {
    title = text(root,'td.title b') || hint;
    const content = root.querySelector('td.board1');
    const lines = (content?.textContent || '').split('\n').map(clean).filter(Boolean);
    dateText = lines.filter(l => /(?:일시|일정|날짜|^시\s*[:：])/.test(l)).join(' ');
    venue = lines.find(l => /^장\s*소\s*[:：]/.test(l))?.replace(/^장\s*소\s*[:：]\s*/,'') || '';
    time = dateText.match(/(?:오전|오후|am|pm)?\s*\d{1,2}\s*[:시]\s*\d{0,2}(?:분)?/i)?.[0]?.trim() || '';
    price = /무료/.test(title) ? '무료' : /유료/.test(title) ? '유료 · 금액은 원문 확인' : '';
    pics = images(root,'img[name^="IMG"]',url);
  } else if(source.adapter==='jjticket') {
    title=root.querySelector('meta[property="og:title"]')?.getAttribute('content')||hint;
    dateText=formattedField(root,['기간','공연일시','일시']);time=formattedField(root,['시간','공연시간']);venue=formattedField(root,['장소','공연장소']);
    price=formattedField(root,['가격','관람료','티켓가격']);audience=formattedField(root,['관람연령']);
    pics=images(root,'.shop_view img[src*="upload/"],.goods_wrapper img[src*="upload/"],.fr-view img[src*="upload/"]',url);
  } else if(source.adapter==='wanju') {
    const box=root.querySelector('.show_right');if(!box)throw new Error('완주 공연 상세 구조를 확인해 주세요.');
    title=text(box,'h4');dateText=formattedField(box,['공연일자']);time=formattedField(box,['공연시간']);venue=formattedField(box,['공연장소']);
    const fee=formattedField(box,['요금']);audience=fee.match(/\d+세\s*이상\s*관람가/)?.[0]||'';
    const amounts=[...fee.matchAll(/(성인|청소년|어린이)\s*:\s*([\d,]+)\s*원/g)];
    price=amounts.length?(amounts.every(m=>Number(m[2].replace(/,/g,''))===0)?'무료':amounts.map(m=>`${m[1]} ${Number(m[2].replace(/,/g,'')).toLocaleString('ko-KR')}원`).join(' / ')):fee.replace(/\d+세.*$/,'').trim();
    pics=images(root,'.img_box img,.show_info img',url);
  } else if(source.adapter==='naru') {
    title=formattedField(root,['공연명']);dateText=formattedField(root,['공연일시']);venue=formattedField(root,['공연장소']);
    time=dateText.includes(' / ')?dateText.split(' / ').slice(1).join(' / '):dateText.match(/\d{1,2}:\d{2}[\s\S]*$/)?.[0]||'';
    price=formattedField(root,['티켓금액']);audience=formattedField(root,['연령제한']);
    pics=images(root,'.ssimg1 img,.deimg img',url);
  } else if(source.adapter==='kukak') {
    const box=root.querySelector('.perf_top');if(!box)throw new Error('국악원 공연 상세 구조를 확인해 주세요.');
    title=text(root,'h4 strong')||hint;dateText=label(box,['공연일시']);venue=label(box,['공연장소']);
    time=dateText.match(/\d{1,2}:\d{2}/)?.[0]||'';price=label(box,['관람료']);audience=label(box,['관람연령']);
    // Provisional template prices must not override an explicit notice of later confirmation.
    if(/관람료[^\n]{0,100}추후\s*공지/.test(box.textContent))price='관람료 추후 공지';
    pics=images(root,'.perf_top .perf_slider img,.perf_detail .con_area img',url);
  } else if(source.adapter==='library') {
    const box=root.querySelector('table.bbs_write');if(!box)throw new Error('도서관 프로그램 상세 구조를 확인해 주세요.');
    title=label(box,['과정명']);dateText=label(box,['운영기간']);time=label(box,['운영시간']);venue=label(box,['운영장소']);
    price=label(box,['수강료']);audience=label(box,['신청대상']);
    pics=images(box,'td img:not([src*="btn_"])',url);
  } else {
    if(!config.title || !config.date || !config.venue) throw new Error('새 사이트의 수집 항목 설정이 필요합니다.');
    title = text(root,config.title); dateText = text(root,config.date); venue = text(root,config.venue);
    time = config.time ? text(root,config.time) : ''; price = config.price ? text(root,config.price) : '';
    pics = config.images ? images(root,config.images,url) : [];
  }
  const [startDate,endDate] = dateRange(dateText);
  title = clean(title).slice(0,160);
  if(!title) throw new Error('제목을 읽지 못했습니다.');
  const exhibitVenue=/전시실|갤러리|전시장/.test(venue);
  return { title, category: category(title,exhibitVenue?'전시':venue,source.id||source.adapter), startDate, endDate, time:time.slice(0,200), venue:venue.slice(0,200), price:price.slice(0,200), audience:audience.slice(0,100), description:'', images:pics, sourceName:source.name, link:url, imageCredit:source.name, cancelled:/\[취소\]|공연\s*취소|행사\s*취소/.test(title) };
}
export function linksFrom(html, url, source) {
  const root = documentOf(html), config = JSON.parse(source.config || '{}');
  if(source.adapter==='kukak'){
    // Read a numeric identifier from the site's button; never execute its JavaScript.
    return [...new Map([...root.querySelectorAll('[onclick]')].flatMap(a=>{
      const id=a.getAttribute('onclick')?.match(/^getViewPage\('(\d+)'\);?$/)?.[1];if(!id)return [];
      const u=new URL(source.url);u.searchParams.set('showViewType','view');u.searchParams.set('sidx',id);u.searchParams.sort();
      return [[u.href,{url:u.href,hint:clean(a.closest('li')?.textContent)}]];
    })).values()];
  }
  const soriExhibition = source.adapter === 'sori' && /\/show\/exhibition(?:\/|$)/.test(new URL(source.url).pathname);
  const selector = {ssac:'a[href*="concert_id="][href*="do=view"]',nol:'a[href*="/ticket/places/"][href*="/products/"]',sori:soriExhibition?'a[href*="/show/exhibition/"]':'a[href*="/show/performance/"]',culturePerform:'a[href*="/localperform/amateur/perform/view.do"][href*="pblprfrSn="]',woojin:'a[href*="action=read"]',nihc:'a[href*="/board/view.9is"]',jjticket:'a[href*="/performance/"][href*="idx="]',wanju:'a[href*="dx="]',naru:'.eltd-post-text-inner a[href*="sub1_detail.html?concertid="]',library:'.lib_program_list a.detail[href*="reUniqId="]'}[source.adapter] || config.links;
  if (!selector) throw new Error('새 사이트의 목록 링크 설정이 필요합니다.');
  const found = new Map();
  for(const a of root.querySelectorAll(selector)) {
    const href = publicURL(a.getAttribute('href'),url);
    if(!href || new URL(href).hostname !== new URL(url).hostname) continue;
    if(source.adapter === 'sori' && !(soriExhibition ? /\/exhibition\/\d+$/.test(new URL(href).pathname) : /\/performance\/\d+$/.test(new URL(href).pathname))) continue;
    const u = new URL(href);
    if(source.adapter==='culturePerform')for(const k of [...u.searchParams.keys()])if(!['menuNo','pblprfrSn'].includes(k))u.searchParams.delete(k);
    if(source.adapter === 'woojin') ['page','div','key','sword'].forEach(k=>u.searchParams.delete(k));
    if(source.adapter === 'nihc') ['year','month','page','subPath'].forEach(k=>u.searchParams.delete(k));
    if(source.adapter==='wanju')['page','s_word','s_kinds'].forEach(k=>u.searchParams.delete(k));
    if(source.adapter==='library')for(const k of [...u.searchParams.keys()])if(!['menuCd','reUniqId'].includes(k))u.searchParams.delete(k);
    if(source.adapter==='ssac')for(const k of [...u.searchParams.keys()])if(!['gc','concert_id','do'].includes(k))u.searchParams.delete(k);
    if(source.adapter==='nol')u.search='';
    u.searchParams.sort();
    const key = u.href, hint = clean(a.textContent);
    if(!found.has(key) || hint.length > found.get(key).hint.length) found.set(key,{url:key,hint});
  }
  return [...found.values()];
}
export function listingURLs(source, now = new Date()) {
  const urls = [];
  if(['nihc','kukak'].includes(source.adapter)) {
    const d = new Date(`${koreaToday(now)}T00:00:00Z`);
    for(let i=0;i<4;i++) { const u = new URL(source.url); if(source.adapter==='kukak'){u.searchParams.set('searchYearMonth',`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}`);u.searchParams.set('showViewType','list');}else{u.searchParams.set('year',d.getUTCFullYear());u.searchParams.set('month',d.getUTCMonth()+1);}urls.push(u.href);d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1); }
  } else if(source.adapter === 'sori') {
    // Larger list avoids fetching a page for each ten results.
    const u = new URL(source.url);u.pathname = u.pathname.replace(/\/$/,'')+'/';u.searchParams.set('size','100');u.searchParams.set('page','0');urls.push(u.href);
  } else if(source.adapter==='ssac') {
    for(let i=1;i<=3;i++){const u=new URL(source.url);u.searchParams.set('do','list');u.searchParams.set('page',i);urls.push(u.href);}
  } else if(source.adapter==='nol') {
    urls.push(source.url);
  } else if(source.adapter === 'culturePerform') {
    for(let i=1;i<=5;i++){const u=new URL(source.url);u.searchParams.set('pageIndex',i);u.searchParams.set('rgnClctCd2','13');u.searchParams.set('menuNo','400013');if(!u.searchParams.has('sttsNm2'))u.searchParams.set('sttsNm2','');if(!u.searchParams.has('searchKwd'))u.searchParams.set('searchKwd','');urls.push(u.href);}
  } else if(source.adapter === 'woojin') {
    for(let i=1;i<=3;i++) {const u=new URL(source.url);u.searchParams.set('page',i);urls.push(u.href);}
  } else if(source.adapter==='library'){
    for(let i=1;i<=3;i++){const u=new URL(source.url);u.searchParams.set('startPage',i);u.searchParams.set('orderField','RE_SDATE');u.searchParams.set('orderSort','desc');urls.push(u.href);}
  } else if(['jjticket','wanju'].includes(source.adapter)) {
    for(let i=1;i<=3;i++){const u=new URL(source.url);u.searchParams.set('page',i);urls.push(u.href);}
  } else urls.push(source.url);
  return urls;
}
export async function fetchPage(url, fetcher = fetch) {
  if(!publicURL(url)) throw new Error('공개 홈페이지 주소만 수집할 수 있습니다.');
  let current = url;
  for(let i=0;i<4;i++) {
    let r;
    try{r=await fetcher(current,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'User-Agent':'Jini-Culture-News/1.0 (+https://jini-admin-tools.vercel.app/news/)','Accept':'text/html'}});}
    catch(e){throw new Error(`원문 연결 실패 (${clean(e.cause?.code||e.name).slice(0,80)})`);}
    if(r.status >= 300 && r.status < 400) {
      const next = publicURL(r.headers.get('location'),current);
      if(!next || new URL(next).hostname !== new URL(current).hostname) throw new Error('다른 호스트로 이동합니다. 주소를 확인해 주세요.');
      current = next; continue;
    }
    if(!r.ok) throw new Error(`원문 응답 오류 (${r.status})`);
    if(!/text\/html/i.test(r.headers.get('content-type') || '')) throw new Error('HTML 페이지가 아닙니다.');
    const reader = r.body.getReader(); const chunks=[];let size=0;
    try { while(true) {const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1500000)throw new Error('원문 크기가 수집 한도를 넘었습니다.');chunks.push(value);} }
    finally { await reader.cancel(); }
    const bytes=new Uint8Array(size);let p=0;for(const c of chunks){bytes.set(c,p);p+=c.length;}
    return decodeHTML(bytes);
  }
  throw new Error('원문 이동 횟수가 너무 많습니다.');
}
