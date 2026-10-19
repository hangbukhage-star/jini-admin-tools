import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {day,publicURL,koreaToday,horizon,parseDetail,linksFrom,listingURLs,fetchPage,dateRange,recommendCategory,priceInfo,venueGroup} from '../src/news-collectors.js';
import {newsRequest} from '../src/news.js';
import {siteVisitors,cleanupVisitors} from '../src/site-visitors.js';
import {collectSite} from '../src/news-collection.js';
import handler from '../../api/news-collect.mjs';

export class TestD1 {
  constructor(){this.db=new DatabaseSync(':memory:');for(const name of ['0004_create_news.sql','0005_news_views.sql','0006_news_bulk_management.sql','0009_news_reactions.sql','0010_news_price_search.sql','0011_venues_and_site_visitors.sql'])this.db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));}
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

test('같은 건물의 홀·회의실·층을 한 장소로 묶고 원래 장소는 보존한다',async()=>{
  for(const name of ['한국소리문화의전당 모악당','한국소리문화의 전당 연지홀','소리문화의전당 국제회의장'])assert.equal(venueGroup(name),'한국소리문화의전당');
  assert.equal(venueGroup('국립극장 해오름극장'),'국립극장');assert.equal(venueGroup('전주 우진문화공간 예술극장'),'우진문화공간');
  assert.equal(venueGroup('1층 동아리실','[완산]완산독서','library'),'완산도서관');
  assert.equal(venueGroup('지하 강당','[문화가 있는 날]강연','library'),'');
  assert.equal(venueGroup('서학예술마을도서관 은행나무동 1층 강의실'),'서학예술마을도서관');
  const e=env();for(const venue of ['한국소리문화의전당 모악당','한국소리문화의전당 연지홀'])await call(e,'/admin/post','POST',{title:'건물별 공연',venue,status:'published'});
  const options=await(await call(e,'/venues')).json();assert.deepEqual(options.venues,['한국소리문화의전당']);
  const filtered=await(await call(e,'?venue='+encodeURIComponent('소리문화의 전당'))).json();assert.equal(filtered.total,2);assert.ok(filtered.posts.every(p=>p.venueGroup==='한국소리문화의전당'));assert.ok(filtered.posts.some(p=>p.venue.endsWith('연지홀')));
});

test('방문자는 한국 날짜별 브라우저 중복을 막고 누적은 일별 합계로 보존한다',async()=>{
  const e=env(),visitorId=crypto.randomUUID(),second=crypto.randomUUID();
  const visit=async(id,stamp,method='POST')=>siteVisitors(new Request('https://api.example.org/site/visits',{method,...(method==='POST'?{body:JSON.stringify({visitorId:id})}:{})}),e,'https://example.org',new Date(stamp));
  let data=await(await visit(visitorId,'2026-10-18T14:59:59Z')).json();assert.equal(data.total,0);
  const day='2026-10-18T15:00:00Z';
  await Promise.all(Array.from({length:8},()=>visit(visitorId,day)));
  data=await(await visit(visitorId,day)).json();assert.deepEqual([data.today,data.total,data.date,data.startDate],[1,1,'2026-10-19','2026-10-19']);
  data=await(await visit(second,day)).json();assert.equal(data.today,2);
  data=await(await visit(null,day,'GET')).json();assert.equal(data.total,2);
  data=await(await visit(visitorId,'2026-10-19T15:00:00Z')).json();assert.deepEqual([data.today,data.total],[1,3]);
  assert.equal((await visit('invalid',day)).status,400);
  const stored=e.DB.db.prepare('SELECT visitor_hash FROM site_visit_days').all();assert.ok(stored.every(x=>x.visitor_hash.length===64&&x.visitor_hash!==visitorId));assert.equal(new Set(stored.map(x=>x.visitor_hash)).size,3);
  await cleanupVisitors(e,new Date('2026-11-01T00:00:00Z'));assert.equal(e.DB.db.prepare('SELECT COUNT(*) AS n FROM site_visit_days').get().n,0);
  data=await(await visit(null,'2026-11-01T00:00:00Z','GET')).json();assert.deepEqual([data.today,data.total],[0,3]);
});

test('요금 검색은 무료·초대·유료·미정과 좌석별 금액을 구분하며 나이와 할인을 금액으로 삼지 않는다',()=>{
  for(const value of ['무료','전석 초대','0원','0'])assert.deepEqual(priceInfo(value),{type:'free',amounts:[0]});
  assert.deepEqual(priceInfo('R석 20,000원 / S석 15,000원'),{type:'paid',amounts:[15000,20000]});
  assert.deepEqual(priceInfo('VIP_70,000 / R_60,000'),{type:'paid',amounts:[60000,70000]});
  assert.deepEqual(priceInfo('성인 1만5천원 / 어린이 5천원'),{type:'paid',amounts:[5000,15000]});
  assert.deepEqual(priceInfo('무료 / 체험비 7,000원'),{type:'mixed',amounts:[0,7000]});
  for(const value of ['', '관람료 추후 공지','주최 문화원','8세 이상 / 50% 할인'])assert.deepEqual(priceInfo(value),{type:'unknown',amounts:[]});
  assert.deepEqual(priceInfo('유료 · 금액은 원문 확인'),{type:'paid',amounts:[]});
});

test('제목·장소·요금 조합을 전체 글에서 검색하고 동일 좌석 금액·페이지·비공개 경계를 지킨다',async()=>{
  const e=env();
  const add=async p=>(await(await call(e,'/admin/post','POST',{category:'공연',status:'published',...p})).json()).id;
  for(let i=0;i<32;i++)await add({title:`다른 공연 ${i}`,venue:'다른 공연장',price:'무료'});
  const paid=await add({title:'가을 Jazz 음악회',venue:'소리문화의전당 연지홀',price:'R석 20,000원 / S석 10,000원'});
  await add({title:'봄 음악회',venue:'소리문화의전당 명인홀',price:'무료'});
  await add({title:'후원 음악회',venue:'소리문화의전당 명인홀',price:'무료 / 특별석 7,000원'});
  await add({title:'미정 음악회',venue:'작은 극장',price:'관람료 추후 공지'});
  await add({title:'유료 음악회',venue:'작은 극장',price:'유료 · 금액은 원문 확인'});
  await add({title:'비공개 음악회',venue:'비밀 장소',price:'10000',status:'pending'});
  const deleted=await add({title:'삭제 음악회',venue:'삭제 장소',price:'10000'});await call(e,'/admin/bulk','POST',{ids:[deleted],action:'delete'});
  const list=async query=>(await(await call(e,'?'+new URLSearchParams(query))).json());
  let result=await list({q:'jazz',venue:'소리문화',fee:'paid',minPrice:'10000',maxPrice:'10000'});assert.equal(result.total,1);assert.equal(result.posts[0].id,paid);
  assert.equal((await list({q:'음악회',minPrice:'12000',maxPrice:'18000'})).total,0);
  assert.equal((await list({q:'음악회',fee:'free',minPrice:'7000',maxPrice:'7000'})).total,0);
  assert.equal((await list({q:'음악회',fee:'free'})).total,2);assert.equal((await list({q:'음악회',fee:'paid'})).total,3);
  assert.equal((await list({q:'음악회',fee:'unknown'})).total,1);
  result=await list({fee:'free',limit:'30'});assert.equal(result.total,34);assert.equal(result.posts.length,30);assert.equal(result.hasMore,true);
  const page=await list({fee:'free',limit:'30',offset:'30'});assert.equal(page.posts.length,4);assert.ok(page.posts.every(p=>!result.posts.some(x=>x.id===p.id)));
  for(const q of ['%',"' OR 1=1 --",'非公開'])assert.equal((await list({q})).total,0);
  for(const query of [{minPrice:'-1'},{maxPrice:'NaN'},{minPrice:'2',maxPrice:'1'},{fee:'fake'},{minPrice:'100000001'}])assert.equal((await call(e,'?'+new URLSearchParams(query))).status,400);
  const venues=await(await call(e,'/venues')).json();assert.ok(venues.venues.includes('한국소리문화의전당'));assert.ok(!venues.venues.includes('비밀 장소'));assert.ok(!venues.venues.includes('삭제 장소'));
  await call(e,'/admin/post','POST',{id:paid,title:'가을 Jazz 음악회',venue:'소리문화의전당 연지홀',status:'published',category:'공연',price:'무료'});
  assert.equal((await list({q:'jazz',fee:'paid'})).total,0);assert.equal((await list({q:'jazz',fee:'free'})).total,1);
  await add({title:'지난 음악회',venue:'지난 공연장',price:'5000',startDate:'2020-01-01'});
  assert.equal((await list({q:'지난'})).total,0);assert.equal((await list({q:'지난',archive:'1',maxPrice:'5000'})).total,1);
  assert.ok((await(await call(e,'/venues?archive=1')).json()).venues.includes('지난 공연장'));
});

test('여섯 반응은 브라우저별 하나만 저장하고 재요청·변경·취소·재열기에 일관된다',async()=>{
  const e=env(),{id}=await(await call(e,'/admin/post','POST',{title:'반응 시험',category:'공연',status:'published'})).json();
  const visitorId=crypto.randomUUID(),other=crypto.randomUUID();
  const react=async input=>(await(await call(e,`/posts/${id}/reactions`,'POST',input,false)).json());
  let data=await react({visitorId});assert.equal(data.selected,null);assert.deepEqual(Object.values(data.counts),[0,0,0,0,0,0]);
  for(const kind of ['like','thanks','dislike','excited','cheer','sad']){
    for(let attempt=0;attempt<2;attempt++){
      data=await react({visitorId,reaction:kind});assert.equal(data.selected,kind);assert.equal(data.counts[kind],1);assert.equal(Object.values(data.counts).reduce((a,b)=>a+b,0),1);
    }
  }
  data=await react({visitorId:other,reaction:'sad'});assert.equal(data.counts.sad,2);
  data=await react({visitorId});assert.equal(data.selected,'sad');assert.equal(data.counts.sad,2);
  const stored=e.DB.db.prepare('SELECT visitor_hash FROM news_reactions WHERE post_id=?').all(id);assert.ok(stored.every(x=>x.visitor_hash.length===64&&x.visitor_hash!==visitorId));
  const backup=await(await call(e,'/admin/export')).json();assert.equal(backup.reactions[0].count,2);assert.equal(JSON.stringify(backup.reactions).includes(visitorId),false);
  for(let i=0;i<2;i++){data=await react({visitorId,reaction:null});assert.equal(data.selected,null);assert.equal(data.counts.sad,1);}
  assert.equal((await(await call(e,`/posts/${id}`)).json()).post.views,0);
});

test('비공개 글의 반응을 읽거나 변경할 수 없고 편집·삭제·복구가 반응을 보존한다',async()=>{
  const e=env(),input={title:'숨길 반응',category:'전시',status:'pending'},visitorId=crypto.randomUUID();
  const {id}=await(await call(e,'/admin/post','POST',input)).json();
  const react=b=>call(e,`/posts/${id}/reactions`,'POST',b,false);
  assert.equal((await react({visitorId})).status,404);
  await call(e,'/admin/post','POST',{...input,id,status:'published'});
  for(const b of [{visitorId:'x'},{visitorId,reaction:'invalid'},{visitorId,reaction:''},null])assert.equal((await react(b)).status,400);
  await react({visitorId,reaction:'thanks'});
  await call(e,'/admin/post','POST',{...input,id,title:'수정된 글',status:'published'});
  assert.equal((await(await react({visitorId})).json()).counts.thanks,1);
  await call(e,'/admin/bulk','POST',{ids:[id],action:'hide'});assert.equal((await react({visitorId,reaction:'sad'})).status,404);
  await call(e,'/admin/bulk','POST',{ids:[id],action:'delete'});assert.equal((await react({visitorId})).status,404);
  await call(e,'/admin/bulk','POST',{ids:[id],action:'restore'});assert.equal((await react({visitorId})).status,404);
  await call(e,'/admin/bulk','POST',{ids:[id],action:'publish'});assert.equal((await(await react({visitorId})).json()).selected,'thanks');
});

test('국악원 월별 목록과 도서관 접수 페이지를 행사 운영일·요금으로 추출한다',()=>{
  const kukak={id:'kukak',adapter:'kukak',name:'국악원',url:'https://kukakwon.jb.go.kr/site/menu/MENU_000000000000371'};
  const links=linksFrom(`<a onclick="getViewPage('1912');">상세</a><a onclick="getViewPage('1912');">상세</a><a onclick="alert('1913')">위험</a>`,kukak.url,kukak);
  assert.equal(links.length,1);assert.equal(new URL(links[0].url).searchParams.get('sidx'),'1912');
  const months=listingURLs(kukak,new Date('2026-12-30T22:00:00Z')).map(x=>new URL(x).searchParams.get('searchYearMonth'));assert.deepEqual(months,['202612','202701','202702','202703']);
  const html='<h4><strong>무용단 정기공연</strong></h4><div class="perf_top"><dl><dt>공연일시</dt><dd>2026년 10월 31일 Sat요일15:00</dd><dt>공연장소</dt><dd>모악당</dd><dt>관람료</dt><dd>무료</dd><dt>주의사항</dt><dd>관람료 등 세부 일정은 추후 공지 예정</dd></dl></div>';
  const k=parseDetail(html,links[0].url,kukak);assert.equal(k.startDate,'2026-10-31');assert.equal(k.time,'15:00');assert.equal(k.venue,'모악당');assert.equal(k.price,'관람료 추후 공지');
  const blank=parseDetail(html.replace('<dt>관람료</dt>','<dt>관람연령</dt><dd></dd><dt>예약현황</dt><dd>잔여 1000석</dd><dt>관람료</dt>'),links[0].url,kukak);assert.equal(blank.audience,'');
  const library={id:'library',adapter:'library',name:'도서관',url:'https://lib.jeonju.go.kr/index.jeonju?menuCd=DOM_000000102002000000'};
  const l=parseDetail('<table class="bbs_write"><tr><th>과정명</th><td>그림책 읽어주기</td></tr><tr><th>운영기간</th><td>2026-12-15 ~ 2026-12-15</td><th>접수기간</th><td>2026-05-21 ~ 2026-12-14</td></tr><tr><th>운영시간</th><td>10:00~10:40</td><th>운영장소</th><td>송천도서관</td></tr><tr><th>신청대상</th><td>유아</td><th>수강료</th><td>0원</td></tr></table>',library.url,library);
  assert.equal(l.startDate,'2026-12-15');assert.equal(l.endDate,'2026-12-15');assert.equal(l.venue,'송천도서관');assert.equal(l.price,'0원');assert.equal(l.category,'문화강좌');
  const list='<div class="lib_program_list"><a class="detail" href="?menuCd=DETAIL&reUniqId=RE1&searchWord=x">상세보기</a><a href="?menuCd=APPLY&reUniqId=RE1">신청</a></div>';
  const items=linksFrom(list,library.url,library);assert.equal(items.length,1);assert.equal(new URL(items[0].url).searchParams.has('searchWord'),false);
});

test('추천 분류는 근거와 불확실성을 표시하며 직접 저장한 분류를 덮어쓰지 않는다',async()=>{
  for(const [title,value] of [['음악교육극','공연'],['정기 음악회','공연'],['사진 전시회','전시'],['전시 해설사 양성 교육','문화강좌'],['건축 세미나','세미나'],['그림책 읽어주기','문화강좌']])assert.equal(recommendCategory(title).category,value);
  assert.equal(recommendCategory('알림').needsReview,true);assert.equal(recommendCategory('알림','','library').category,'문화강좌');
  const e=env(),{id}=await(await call(e,'/admin/post','POST',{title:'사진 전시회',category:'공연',status:'pending'})).json();
  const post=(await(await call(e,'/admin')).json()).posts.find(x=>x.id===id);assert.equal(post.category,'공연');assert.equal(post.recommendation.category,'전시');assert.match(post.recommendation.reason,/전시/);
  const sql=readFileSync(new URL('../migrations/0008_add_kukak_library.sql',import.meta.url),'utf8');e.DB.db.exec(sql);e.DB.db.exec(sql);assert.equal(e.DB.db.prepare('SELECT COUNT(*) AS count FROM news_sources').get().count,5);
  assert.equal((await call(e,'/admin/source','POST',{id:'library',name:'도서관',url:'https://lib.jeonju.go.kr',adapter:'library',enabled:true})).status,200);
});

test('새 공연 사이트의 다일 공연 종료일과 좌석별·무료 요금을 정확히 읽는다',()=>{
  assert.deepEqual(dateRange('2026년 11월 12일(목)~14일(토) / 목,금 10:30'),['2026-11-12','2026-11-14']);
  assert.deepEqual(dateRange('2026.12.31 ~ 1.2'),['2026-12-31','2027-01-02']);
  const jj=parseDetail('<meta property="og:title" content="가을 연극"><div class="fr-view"><p>기 간｜2026. 10. 22.(목) ~ 24.(토)</p><p>장 소｜덕진예술회관</p><p>가 격｜R석 20,000원 / S석 15,000원</p></div>','https://jjticketbox.com/performance/?idx=225',{adapter:'jjticket',name:'전주티켓박스'});
  assert.equal(jj.endDate,'2026-10-24');assert.equal(jj.venue,'덕진예술회관');assert.equal(jj.price,'R석 20,000원 / S석 15,000원');
  const wanjuHtml=fee=>`<div class="show_right"><h4>음악교육극</h4><ul><li><span>공연일자</span><span>: 2026-11-13 ~ 2026-11-13</span></li><li><span>공연장소</span><span>: 완주향토예술문화회관</span></li><li><span>요금</span><span>: (성인:${fee}원) 6세이상 관람가</span></li></ul></div>`;
  const w=parseDetail(wanjuHtml(0),'https://culture.wanju.go.kr/index.wanju?dx=448',{adapter:'wanju',name:'완주'});assert.equal(w.price,'무료');assert.equal(w.category,'공연');assert.equal(w.audience,'6세이상 관람가');
  assert.equal(parseDetail(wanjuHtml(10000),'https://culture.wanju.go.kr/index.wanju?dx=448',{adapter:'wanju',name:'완주'}).price,'성인 10,000원');
  const n=parseDetail('<ul><li><span>공 연 명</span> : 어린이 극장</li><li><span>공연일시</span> : 2026년 11월 12일(목)~14일(토) / 목,금 10:30</li><li><span>공연장소</span> : 전북예술회관</li><li><span>티켓금액</span> : S석 : 20,000원</li></ul>','https://www.naruculture.com/sub1_detail.html?concertid=abc',{adapter:'naru',name:'나루'});assert.equal(n.endDate,'2026-11-14');assert.equal(n.time,'목,금 10:30');assert.equal(n.price,'S석 : 20,000원');
});
test('추가 사이트의 상세 링크만 골라내고 신규 세 사이트를 기존 설정 변경 없이 등록한다',()=>{
  assert.equal(linksFrom('<a href="/performance/?idx=1">공연</a><a href="/performance/?idx=1">사진</a><a href="/performance/?page=2">2</a>','https://jjticketbox.com/performance',{adapter:'jjticket'}).length,1);
  assert.equal(linksFrom('<a href="?dx=1&page=1&menuCd=abc">상세</a><a href="?dx=1&page=2&menuCd=abc">상세</a>','https://culture.wanju.go.kr/index.wanju',{adapter:'wanju'}).length,1);
  const e=env();e.DB.db.exec("UPDATE news_sources SET name='내 설정' WHERE id='sori'");const sql=readFileSync(new URL('../migrations/0007_add_culture_sources.sql',import.meta.url),'utf8');e.DB.db.exec(sql);e.DB.db.exec(sql);assert.equal(e.DB.db.prepare('SELECT count(*) AS count FROM news_sources').get().count,6);assert.equal(e.DB.db.prepare("SELECT name FROM news_sources WHERE id='sori'").get().name,'내 설정');
});

test('선택한 글만 일괄 게시·숨김·삭제·복구하고 조회수를 보존한다',async()=>{
  const e=env(),ids=[];
  for(const title of ['첫 글','둘째 글','남길 글'])ids.push((await(await call(e,'/admin/post','POST',{title,status:'pending',category:'공연'})).json()).id);
  assert.equal((await call(e,'/admin/bulk','POST',{action:'publish',ids},false)).status,401);
  const result=await(await call(e,'/admin/bulk','POST',{action:'publish',ids:ids.slice(0,2)})).json();assert.equal(result.count,2);
  assert.equal((await(await call(e,'')).json()).posts.length,2);
  await call(e,`/posts/${ids[0]}/view`,'POST');
  await call(e,'/admin/bulk','POST',{action:'hide',ids:ids.slice(0,2)});assert.equal((await(await call(e,'')).json()).posts.length,0);
  await call(e,'/admin/bulk','POST',{action:'publish',ids:ids.slice(0,2)});
  await call(e,'/admin/bulk','POST',{action:'delete',ids:ids.slice(0,2)});
  assert.equal((await(await call(e,'')).json()).posts.length,0);assert.equal((await call(e,`/posts/${ids[0]}/view`,'POST')).status,404);
  const deleted=await(await call(e,'/admin?status=deleted')).json();assert.equal(deleted.posts.length,2);assert.equal(deleted.counts.find(x=>x.status==='pending').count,1);
  assert.equal((await call(e,'/admin/post','POST',{title:'수정',id:ids[0],status:'published'})).status,409);
  await call(e,'/admin/bulk','POST',{action:'restore',ids:ids.slice(0,2)});
  assert.equal((await(await call(e,'/admin')).json()).posts.length,3);
  assert.equal((await e.DB.prepare('SELECT view_count FROM news_posts WHERE id=?').bind(ids[0]).first()).view_count,1);
});
test('일괄 요청에 없는 글이나 잘못된 선택이 있으면 일부만 게시하지 않는다',async()=>{
  const e=env(),{id}=await(await call(e,'/admin/post','POST',{title:'남길 글',status:'pending'})).json();
  assert.equal((await call(e,'/admin/bulk','POST',{action:'publish',ids:[id,crypto.randomUUID()]})).status,409);
  assert.equal((await(await call(e,'')).json()).posts.length,0);
  for(const input of [{action:'publish',ids:[]},{action:'publish',ids:[id,...Array(100).fill(id)]},{action:'erase',ids:[id]},{action:'publish',ids:['invalid']}])assert.equal((await call(e,'/admin/bulk','POST',input)).status,400);
  assert.equal((await(await call(e,'/admin/bulk','POST',{action:'publish',ids:[id,id]})).json()).count,1);
});
test('삭제한 수집 글은 재수집해도 되살아나지 않으며 원문 변경도 덮어쓰지 않는다',async()=>{
  const e=env(),s=await e.DB.prepare("SELECT * FROM news_sources WHERE id='sori'").first();
  let title='원래 공연';const fetcher=async url=>url.endsWith('/42')?detail(koreaToday(),title):'<a href="/site/1/menu/8/show/performance/42">공연</a>';
  await collectSource(e,s,fetcher);const p=(await(await call(e,'/admin')).json()).posts[0];
  await call(e,'/admin/bulk','POST',{action:'delete',ids:[p.id]});title='바뀐 공연';await collectSource(e,s,fetcher);
  const d=await(await call(e,'/admin?status=deleted')).json();assert.equal(d.posts.length,1);assert.equal(d.posts[0].title,'원래 공연');assert.equal(d.changes.length,0);
  assert.equal((await(await call(e,'/admin')).json()).posts.length,0);
});

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
