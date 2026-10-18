import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {day,publicURL,koreaToday,horizon,parseDetail,linksFrom,listingURLs,fetchPage} from '../src/news-collectors.js';
import {newsRequest} from '../src/news.js';
import {collectSite} from '../src/news-collection.js';
import handler from '../../api/news-collect.mjs';

export class TestD1 {
  constructor(){this.db=new DatabaseSync(':memory:');for(const name of ['0004_create_news.sql','0005_news_views.sql'])this.db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));}
  prepare(sql){const stmt=this.db.prepare(sql);let args=[];const values=()=>args.map(x=>x instanceof ArrayBuffer?new Uint8Array(x):x);return {bind(...a){args=a;return this;},async first(){return stmt.get(...values())||null;},async all(){return {results:stmt.all(...values())};},async run(){const r=stmt.run(...values());return {meta:{changes:Number(r.changes)}};}};}
}
const key='local-test-admin-key-at-least-32-characters';
const env=()=>({DB:new TestD1(),NEWS_ADMIN_KEY:key});
const req=(path,method='GET',body,auth=true)=>new Request(`https://api.example.org/news${path}`,{method,headers:{Origin:'http://127.0.0.1:8765',...(auth?{Authorization:`Bearer ${key}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
const call=(e,path,method='GET',body,auth=true)=>newsRequest(req(path,method,body,auth),e,'http://127.0.0.1:8765');
const collectSource=(e,s,fetcher)=>collectSite(s,async data=>{
  const response=await call(e,'/admin/collection','POST',data);const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
},fetcher);
const source={id:'sori',adapter:'sori',name:'한국소리문화의전당',config:'{}'};
const detail=(date='2026-10-21',title='가을 음악회')=>`<html><body><div class="skinveiw-detail"><div class="sktit">${title}</div><div class="skinlist"><p>기간</p><p>${date}~${date}</p></div><div class="skinlist"><p>시간</p><p>19:30</p></div><div class="skinlist"><p>장소</p><p>연지홀</p></div></div><div class="notboximg"><img src="/poster.jpg"></div></body></html>`;

test('게시글 열기와 새로고침마다 조회수를 올리며 목록·관리·숨김은 집계하지 않는다',async()=>{
  const e=env(),input={title:'조회수 확인',category:'공연',status:'published'};
  const {id}=await(await call(e,'/admin/post','POST',input)).json();
  assert.equal((await(await call(e,'')).json()).posts[0].views,0);
  assert.equal((await(await call(e,`/posts/${id}`)).json()).post.views,0);
  for(let count=1;count<=3;count++)assert.equal((await(await call(e,`/posts/${id}/view`,'POST',null,false)).json()).post.views,count);
  assert.equal((await(await call(e,'/admin?status=published')).json()).posts[0].views,3);
  await call(e,'/admin/post','POST',{...input,id,title:'제목 수정'});
  assert.equal((await(await call(e,`/posts/${id}`)).json()).post.views,3);
  await call(e,'/admin/post','POST',{...input,id,status:'hidden'});
  assert.equal((await call(e,`/posts/${id}/view`,'POST',null,false)).status,404);
  assert.equal((await e.DB.prepare('SELECT view_count FROM news_posts WHERE id=?').bind(id).first()).view_count,3);
});

test('한국 날짜·3개월 범위·잘못된 날짜를 구분한다',()=>{
  assert.equal(koreaToday(new Date('2026-10-17T22:00:00Z')),'2026-10-18');assert.equal(day('2026. 2. 30'),'');assert.equal(day('2026년 10월 21일'),'2026-10-21');assert.equal(horizon(new Date('2026-11-30T00:00:00Z')),'2027-02-28');
});
test('내부 주소·위험 링크를 차단하고 원문 목록 링크를 중복 제거한다',()=>{
  for(const u of ['http://127.0.0.1','http://[::1]','file:///tmp/a','javascript:alert(1)','https://user:pass@example.org','http://a.local'])assert.equal(publicURL(u),'');
  const list='<a href="/site/1/menu/8/show/performance/42">공연</a><a href="/site/1/menu/8/show/performance/42">상세보기</a><a href="/site/1/menu/8/show/performance/calendar">달력</a>';
  assert.equal(linksFrom(list,'https://www.sori21.co.kr',source).length,1);assert.equal(listingURLs({...source,adapter:'nihc',url:'https://example.org/list'},new Date('2026-12-31')).length,4);
});
test('기관별 공연일을 추출하며 우진 게시일을 공연일로 사용하지 않는다',()=>{
  const p=parseDetail(detail(),'https://example.org/42',source);assert.equal(p.venue,'한국소리문화의전당 연지홀');assert.equal(p.startDate,'2026-10-21');assert.equal(p.images.length,1);
  const w=parseDetail('<td class="title"><b>공연</b>2026-10-01</td><td class="board1">시 : 2026. 10. 25 (일) pm4:00<br>장소 : 우진 예술극장</td>','https://www.woojin.or.kr/detail',{...source,adapter:'woojin'});assert.equal(w.startDate,'2026-10-25');assert.equal(w.venue,'우진 예술극장');
  const n=parseDetail('<div id="contents"><ul><li><strong>제목</strong><span class="info-tit">가을 전시</span></li><li><strong>일정</strong><span>2026-10-24 ~ 2026-10-25</span></li><li><strong>공연장소</strong><span>소공연장</span></li></ul></div>','https://www.nihc.go.kr/detail',{...source,adapter:'nihc'});assert.equal(n.endDate,'2026-10-25');assert.equal(n.category,'전시');
});
test('관리자 인증·대기 비공개·게시·숨김·기간 종료·백업을 실제 SQLite로 확인한다',async()=>{
  const e=env();assert.equal((await call(e,'/admin','GET',null,false)).status,401);
  const input={title:'테스트 소식',category:'공연',startDate:'2099-01-01',endDate:'2099-01-02',venue:'공연장',status:'pending'};
  const {id}=await (await call(e,'/admin/post','POST',input)).json();assert.ok(id);
  assert.equal((await (await call(e,'')).json()).posts.length,0);assert.equal((await call(e,`/posts/${id}`)).status,404);
  await call(e,'/admin/post','POST',{...input,id,status:'published'});assert.equal((await (await call(e,'')).json()).posts.length,1);
  await call(e,'/admin/post','POST',{...input,id,status:'hidden'});assert.equal((await (await call(e,'')).json()).posts.length,0);
  await call(e,'/admin/post','POST',{...input,id,status:'published',startDate:'2020-01-01',endDate:'2020-01-02'});assert.equal((await (await call(e,'')).json()).posts.length,0);assert.equal((await (await call(e,'?archive=1')).json()).posts.length,1);
  const backup=await (await call(e,'/admin/export')).json();assert.equal(backup.posts.length,1);assert.equal(backup.sources.length,3);
});
test('새 사이트 설정을 저장하고 기존 사이트와 독립적으로 껐다 켤 수 있다',async()=>{
  const e=env();assert.equal((await call(e,'/admin/source','POST',{name:'새 문화관',url:'https://culture.example.org/list',adapter:'generic',enabled:true,config:'{}'})).status,200);
  const data=await (await call(e,'/admin')).json();assert.equal(data.sources.length,4);assert.equal(data.sources.find(s=>s.name==='새 문화관').auto_publish,0);
  assert.equal((await call(e,'/admin/source','POST',{name:'로컬',url:'http://127.0.0.1',adapter:'generic'})).status,400);
});
test('수집 중복 방지·수정 보호·변경 대기·숨김 유지와 실패 상태를 기록한다',async()=>{
  const e=env(),s=await e.DB.prepare("SELECT * FROM news_sources WHERE id='sori'").first();const today=koreaToday();
  let title='첫 공연';const fetcher=async u=>u.endsWith('/42')?detail(today,title):'<a href="/site/1/menu/8/show/performance/42">첫 공연</a>';
  assert.equal((await collectSource(e,s,fetcher)).ok,true);await collectSource(e,s,fetcher);
  let data=await (await call(e,'/admin')).json();assert.equal(data.posts.length,1);assert.equal(data.posts[0].images.length,0);
  const p=data.posts[0];await call(e,'/admin/post','POST',{...p,title:'내가 고친 공연',status:'published'});
  title='원문 변경';await collectSource(e,s,fetcher);data=await (await call(e,'/admin?status=published')).json();assert.equal(data.posts[0].title,'내가 고친 공연');assert.equal(data.changes[0].candidate.title,'원문 변경');
  await call(e,'/admin/post','POST',{...data.posts[0],status:'hidden'});await collectSource(e,s,fetcher);assert.equal((await (await call(e,'')).json()).posts.length,0);
  const failed=await collectSource(e,s,async()=>{throw new Error('접속 실패');});assert.equal(failed.ok,false);const saved=await e.DB.prepare("SELECT * FROM news_sources WHERE id='sori'").first();assert.ok(saved.last_success);assert.match(saved.last_error,/접속 실패/);
});
test('예정 범위 밖의 글도 확인 시각을 기록해 이후 글의 수집을 막지 않는다',async()=>{
  const e=env(),s=await e.DB.prepare("SELECT * FROM news_sources WHERE id='sori'").first();
  await collectSource(e,s,async u=>u.endsWith('/42')?detail('2020-01-01'):'<a href="/site/1/menu/8/show/performance/42">지난 공연</a>');
  assert.ok(await e.DB.prepare('SELECT * FROM news_seen').first());assert.equal((await (await call(e,'/admin')).json()).posts.length,0);
});
test('다른 호스트 리다이렉트는 따라가지 않는다',async()=>{await assert.rejects(fetchPage('https://example.org',async()=>new Response(null,{status:302,headers:{Location:'http://127.0.0.1'}})),/다른 호스트/);});

test('비공개 사진 보호·게시 후 표시·숨긴 후 보호·미사용 사진 정리를 확인한다',async()=>{
  const e=env();const jpg=new Uint8Array([255,216,255,217]);
  const request=new Request('https://api.example.org/news/admin/image',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:jpg});
  const response=await newsRequest(request,e,'*'),{url}=await response.json();assert.equal(response.status,200);
  assert.equal((await call(e,url.slice(5),'GET',null,false)).status,404);
  assert.equal((await call(e,url.slice(5))).status,200);
  const data={title:'사진 소식',status:'published',category:'기타 소식',images:[url]};
  const {id}=await (await call(e,'/admin/post','POST',data)).json();assert.equal((await call(e,url.slice(5),'GET',null,false)).status,200);
  await call(e,'/admin/post','POST',{...data,id,status:'hidden'});assert.equal((await call(e,url.slice(5),'GET',null,false)).status,404);
  await e.DB.prepare("UPDATE news_images SET created_at='2020-01-01T00:00:00Z'").run();
  assert.equal((await (await call(e,'/admin/cleanup-images','POST',{})).json()).removed,0);
  await call(e,'/admin/post','POST',{...data,id,images:[],status:'hidden'});
  assert.equal((await (await call(e,'/admin/cleanup-images','POST',{})).json()).removed,1);
});

test('Vercel 수집 함수에서 저장 API와 연결해 수집·대기 저장·잠금 해제까지 수행한다',async()=>{
  const e=env();await e.DB.prepare("UPDATE news_sources SET enabled=0 WHERE id<>'sori'").run();
  const oldFetch=globalThis.fetch,oldAdmin=process.env.NEWS_ADMIN_KEY,oldCollector=process.env.NEWS_COLLECTOR_KEY;
  process.env.NEWS_ADMIN_KEY=key;process.env.NEWS_COLLECTOR_KEY=key+'-collector';
  globalThis.fetch=async(url,options={})=>{
    if(String(url).includes('workers.dev'))return newsRequest(new Request(url,options),e,'*');
    return new Response(String(url).endsWith('/42')?detail(koreaToday()):'<a href="/site/1/menu/8/show/performance/42">첫 공연</a>',{headers:{'Content-Type':'text/html;charset=UTF-8'}});
  };
  let result,status;
  const res={status(code){status=code;return this;},json(value){result=value;return this;}};
  try{
    await handler({method:'POST',headers:{authorization:`Bearer ${key}-collector`},body:{}},res);
    assert.equal(status,200);assert.equal(result.results[0].count,1);
    assert.equal((await (await call(e,'/admin')).json()).posts.length,1);
    assert.equal(await e.DB.prepare('SELECT * FROM news_locks').first(),null);
    await handler({method:'POST',headers:{authorization:'Bearer wrong'},body:{}},res);assert.equal(status,401);
  }finally{globalThis.fetch=oldFetch;if(oldAdmin===undefined)delete process.env.NEWS_ADMIN_KEY;else process.env.NEWS_ADMIN_KEY=oldAdmin;if(oldCollector===undefined)delete process.env.NEWS_COLLECTOR_KEY;else process.env.NEWS_COLLECTOR_KEY=oldCollector;}
});
