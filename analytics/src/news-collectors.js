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
  for (const n of names) if (p[n]) return p[n];
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
function dateRange(value) {
  const dates = [...String(value).matchAll(/20\d{2}\s*[.년/-]\s*\d{1,2}\s*[.월/-]\s*\d{1,2}/g)].map(m => day(m[0])).filter(Boolean);
  return [dates[0] || '', dates[1] || dates[0] || ''];
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
  } else {
    if(!config.title || !config.date || !config.venue) throw new Error('새 사이트의 수집 항목 설정이 필요합니다.');
    title = text(root,config.title); dateText = text(root,config.date); venue = text(root,config.venue);
    time = config.time ? text(root,config.time) : ''; price = config.price ? text(root,config.price) : '';
    pics = config.images ? images(root,config.images,url) : [];
  }
  const [startDate,endDate] = dateRange(dateText);
  title = clean(title).slice(0,160);
  if(!title) throw new Error('제목을 읽지 못했습니다.');
  return { title, category: category(title), startDate, endDate, time:time.slice(0,200), venue:venue.slice(0,200), price:price.slice(0,200), audience:audience.slice(0,100), description:'', images:pics, sourceName:source.name, link:url, imageCredit:source.name, cancelled:/\[취소\]|공연\s*취소|행사\s*취소/.test(title) };
}
export function linksFrom(html, url, source) {
  const root = documentOf(html), config = JSON.parse(source.config || '{}');
  const selector = {sori:'a[href*="/show/performance/"]',woojin:'a[href*="action=read"]',nihc:'a[href*="/board/view.9is"]'}[source.adapter] || config.links;
  if (!selector) throw new Error('새 사이트의 목록 링크 설정이 필요합니다.');
  const found = new Map();
  for(const a of root.querySelectorAll(selector)) {
    const href = publicURL(a.getAttribute('href'),url);
    if(!href || new URL(href).hostname !== new URL(url).hostname) continue;
    if(source.adapter === 'sori' && !/\/performance\/\d+$/.test(new URL(href).pathname)) continue;
    const u = new URL(href);
    if(source.adapter === 'woojin') ['page','div','key','sword'].forEach(k=>u.searchParams.delete(k));
    if(source.adapter === 'nihc') ['year','month','page','subPath'].forEach(k=>u.searchParams.delete(k));
    u.searchParams.sort();
    const key = u.href, hint = clean(a.textContent);
    if(!found.has(key) || hint.length > found.get(key).hint.length) found.set(key,{url:key,hint});
  }
  return [...found.values()];
}
export function listingURLs(source, now = new Date()) {
  const urls = [];
  if(source.adapter === 'nihc') {
    const d = new Date(`${koreaToday(now)}T00:00:00Z`);
    for(let i=0;i<4;i++) { const u = new URL(source.url); u.searchParams.set('year',d.getUTCFullYear());u.searchParams.set('month',d.getUTCMonth()+1);urls.push(u.href);d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1); }
  } else if(source.adapter === 'sori') {
    // Larger list avoids fetching a page for each ten results.
    const u = new URL(source.url);u.pathname = u.pathname.replace(/\/$/,'')+'/';u.searchParams.set('size','100');u.searchParams.set('page','0');urls.push(u.href);
  } else if(source.adapter === 'woojin') {
    for(let i=1;i<=3;i++) {const u=new URL(source.url);u.searchParams.set('page',i);urls.push(u.href);}
  } else urls.push(source.url);
  return urls;
}
export async function fetchPage(url, fetcher = fetch) {
  if(!publicURL(url)) throw new Error('공개 홈페이지 주소만 수집할 수 있습니다.');
  let current = url;
  for(let i=0;i<4;i++) {
    const r = await fetcher(current,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'User-Agent':'Jini-Culture-News/1.0 (+https://jini-admin-tools.vercel.app/news/)','Accept':'text/html'}});
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
