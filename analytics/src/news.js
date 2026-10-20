import {clean,day,publicURL,koreaToday,horizon,recommendCategory,priceInfo,venueGroup} from './news-core.js';

const MAX_SOURCES = 12;
const nowISO = () => new Date().toISOString();
const parse = value => JSON.parse(value || '{}');
async function sha(value) {const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function fail(message,status=400) {throw Object.assign(new Error(message),{status});}
async function authorized(request,env) {
  if(!env.NEWS_ADMIN_KEY || env.NEWS_ADMIN_KEY.length < 32) return false;
  const supplied = request.headers.get('Authorization')?.replace(/^Bearer /,'') || '';
  const a = await sha(supplied), b = await sha(env.NEWS_ADMIN_KEY);let diff=0;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
async function body(request) {
  if(Number(request.headers.get('Content-Length'))>32000) fail('입력 내용이 너무 큽니다.',413);
  const text=await request.text();if(text.length>32000)fail('입력 내용이 너무 큽니다.',413);
  try{return JSON.parse(text);}catch{fail('입력 형식을 확인해 주세요.');}
}
export function validatePost(input) {
  const data = {};
  for(const [key,max] of Object.entries({title:160,category:20,time:200,venue:200,price:200,audience:100,description:2000,sourceName:100,imageCredit:200})) data[key]=clean(input[key]).slice(0,max);
  if(!data.title) fail('제목을 입력해 주세요.');
  const allowedCategories=['공연','전시','AI·디지털 교육','평생·문화교육'];
  if(['문화강좌','세미나'].includes(data.category))data.category='평생·문화교육';
  else if(data.category==='기타 소식'||!allowedCategories.includes(data.category))data.category=recommendCategory(data.title,input.description,input.sourceId).category;
  for(const key of ['startDate','endDate']) { data[key]=day(input[key]);if(input[key] && !data[key])fail('날짜를 확인해 주세요.'); }
  if(data.startDate && !data.endDate)data.endDate=data.startDate;
  if(data.startDate && data.endDate && data.endDate<data.startDate)fail('종료일이 시작일보다 빠릅니다.');
  data.link=input.link ? publicURL(input.link) : '';
  if(input.link && !data.link)fail('공식 안내 링크를 확인해 주세요.');
  data.images=(Array.isArray(input.images)?input.images:[]).slice(0,3).map(x=>clean(x)).filter(x=>/^\/news\/images\/[a-f0-9-]+$/.test(x) || publicURL(x));
  data.cancelled=!!input.cancelled;
  return data;
}
function hydrate(row,admin=false) {
  const out={...parse(row.data),id:row.id,pinned:!!row.pinned,views:Number(row.view_count)||0,venueGroup:row.venue_group||'',checkedAt:row.checked_at,updatedAt:row.updated_at};
  if(admin) {
    const candidate=row.candidate?parse(row.candidate):null;
    Object.assign(out,{status:row.status,locked:!!row.locked,sourceId:row.source_id,feeType:parse(row.price_info).type||'unknown',candidate,recommendation:recommendCategory(out.title,out.description,row.source_id)});
    if(candidate)candidate.recommendation=recommendCategory(candidate.title,candidate.description,row.source_id);
  }
  return out;
}
async function fingerprint(data) {return sha([data.title.replace(/\s/g,''),data.startDate,data.venue.replace(/\s/g,'')].join('|'));}
function duplicateTitle(value) {return clean(value).normalize('NFKC').toLowerCase().replace(/\s*[-–—]\s*(?:전주|전북)\s*$/,'').replace(/[^\p{L}\p{N}]/gu,'');}
async function findDuplicate(env,data,source,excludeId=''){
  const fp=await fingerprint(data);
  const exact=await env.DB.prepare('SELECT id FROM news_posts WHERE fingerprint=? AND deleted_at IS NULL AND id<>? LIMIT 1').bind(fp,excludeId).first();
  if(exact)return exact;
  if(!data.startDate)return null;
  const candidates=await rows(env,"SELECT id,data,venue_group FROM news_posts WHERE start_date=? AND deleted_at IS NULL AND id<>?",data.startDate,excludeId);
  const title=duplicateTitle(data.title);
  return candidates.find(row=>{
    const previous=parse(row.data),previousTitle=duplicateTitle(previous.title||'');
    return title && title===previousTitle;
  })||null;
}
async function rows(env,sql,...values) {return (await env.DB.prepare(sql).bind(...values).all()).results || [];}
async function withReactions(env,posts) {
  if(!posts.length)return posts;
  const counts=new Map(posts.map(post=>[post.id,{like:0,thanks:0,dislike:0,excited:0,cheer:0,sad:0}]));
  const totals=await rows(env,'SELECT post_id,reaction,COUNT(*) AS count FROM news_reactions WHERE post_id IN (SELECT value FROM json_each(?)) GROUP BY post_id,reaction',JSON.stringify(posts.map(post=>post.id)));
  for(const row of totals)counts.get(row.post_id)[row.reaction]=Number(row.count);
  return posts.map(post=>({...post,reactions:counts.get(post.id)}));
}
export async function ingestPost(env,source,url,raw) {
  const data=validatePost(raw);
  const canonical=publicURL(url);
  if(!canonical || new URL(canonical).hostname!==new URL(source.url).hostname)fail('수집 원문 주소가 등록된 사이트와 다릅니다.');
  const stamp=nowISO();
  await env.DB.prepare('INSERT INTO news_seen VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET checked_at=excluded.checked_at').bind(canonical,source.id,stamp).run();
  const current=await env.DB.prepare('SELECT * FROM news_posts WHERE source_url=?').bind(canonical).first();
  if(current?.deleted_at)return {skipped:true};
  if(!current && data.endDate && (data.endDate<koreaToday() || data.startDate>horizon()))return {skipped:true};
  const fp=await fingerprint(data);
  data.sourceName=source.name;data.link=canonical;
  if(!source.images_allowed)data.images=[];
  if(current) {
    if(current.status==='pending'&&!current.locked){
      const duplicate=await findDuplicate(env,data,source,current.id);
      if(duplicate){await env.DB.prepare('UPDATE news_posts SET deleted_at=?,checked_at=? WHERE id=?').bind(stamp,stamp,current.id).run();return {skipped:true,duplicate:true};}
    }
    const changed=JSON.stringify(parse(current.data))!==JSON.stringify(data);
    if(changed && (current.locked || current.status==='published')) {
      await env.DB.prepare('UPDATE news_posts SET candidate=?,checked_at=? WHERE id=?').bind(JSON.stringify(data),stamp,current.id).run();
    }else if(changed && current.status!=='hidden'){
      await env.DB.prepare('UPDATE news_posts SET data=?,start_date=?,end_date=?,fingerprint=?,checked_at=?,updated_at=?,price_info=?,venue_group=? WHERE id=?').bind(JSON.stringify(data),data.startDate,data.endDate,fp,stamp,stamp,JSON.stringify(priceInfo(data.price)),venueGroup(data.venue,data.title,source.adapter),current.id).run();
    }else await env.DB.prepare('UPDATE news_posts SET checked_at=?,candidate=NULL WHERE id=?').bind(stamp,current.id).run();
  }else{
    const duplicate=await findDuplicate(env,data,source);
    if(duplicate)return {skipped:true,duplicate:true};
    const ready=data.startDate&&data.endDate&&data.venue&&!data.cancelled&&!duplicate;
    const status=source.auto_publish&&ready?'published':'pending';
    await env.DB.prepare('INSERT INTO news_posts(id,source_id,source_url,status,data,start_date,end_date,fingerprint,checked_at,created_at,updated_at,price_info,venue_group) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),source.id,canonical,status,JSON.stringify(data),data.startDate,data.endDate,fp,stamp,stamp,stamp,JSON.stringify(priceInfo(data.price)),venueGroup(data.venue,data.title,source.adapter)).run();
  }
  return {ok:true};
}
export async function runCollection(env,sourceId) {
  if(!env.NEWS_COLLECTOR_KEY || !env.NEWS_COLLECTOR_URL)fail('수집기 연결 전입니다. Vercel 수집 함수와 연결 키를 먼저 설정해 주세요.',503);
  const result=await fetch(env.NEWS_COLLECTOR_URL,{method:'POST',headers:{Authorization:`Bearer ${env.NEWS_COLLECTOR_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({sourceId:sourceId||null})});
  const data=await result.json();if(!result.ok)fail(data.error||'수집기 연결을 확인해 주세요.',result.status);
  return data;
}
export async function newsRequest(request,env,origin) {
  const url=new URL(request.url),path=url.pathname;
  const headers={'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  try{
    const admin=path.startsWith('/news/admin');
    if(admin && !await authorized(request,env))return json({error:env.NEWS_ADMIN_KEY?'관리자 비밀번호를 확인해 주세요.':'관리자 연결 전입니다. 운영 안내에 따라 관리자 키를 설정해 주세요.'},401);
    if(request.method==='GET' && path==='/news/venues'){
      const archive=url.searchParams.get('archive')==='1';
      const venues=await rows(env,`SELECT DISTINCT venue_group AS venue FROM news_posts WHERE status='published' AND deleted_at IS NULL AND ${archive?"end_date<>'' AND end_date<?":"(end_date='' OR end_date>=?)"} AND venue_group<>'' ORDER BY venue LIMIT 500`,koreaToday());
      return json({venues:venues.map(x=>x.venue)});
    }
    if(request.method==='GET' && path==='/news') {
      const archive=url.searchParams.get('archive')==='1',today=koreaToday();
      const limit=Math.min(50,Math.max(1,Number(url.searchParams.get('limit'))||20));
      const offset=Math.min(10000,Math.max(0,Number(url.searchParams.get('offset'))||0));
      const filter=archive?"end_date<>'' AND end_date<?":"(end_date='' OR end_date>=?)";
      const category=clean(url.searchParams.get('category')).slice(0,20),q=clean(url.searchParams.get('q')).slice(0,160),venue=clean(url.searchParams.get('venue')).slice(0,200),fee=url.searchParams.get('fee')||'';
      if(!['','free','paid','unknown'].includes(fee))fail('요금 구분을 확인해 주세요.');
      const month=url.searchParams.get('month')||'',sort=url.searchParams.get('sort')||'';
      if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('월별 검색 기간을 확인해 주세요.');
      if(sort&&!['asc','desc'].includes(sort))fail('날짜 정렬 방법을 확인해 주세요.');
      const amount=name=>{const raw=url.searchParams.get(name);if(raw===null||raw==='')return null;if(!/^\d{1,9}$/.test(raw)||Number(raw)>100000000)fail('금액은 0~100,000,000원 사이의 정수로 입력해 주세요.');return Number(raw);};
      const min=amount('minPrice'),max=amount('maxPrice');if(min!==null&&max!==null&&min>max)fail('최소 금액이 최대 금액보다 큽니다.');
      const clauses=["status='published'","deleted_at IS NULL",filter],params=[today];
      if(category){clauses.push("json_extract(data,'$.category')=?");params.push(category);}
      if(q){clauses.push("instr(lower(COALESCE(json_extract(data,'$.title'),'')),lower(?))>0");params.push(q);}
      if(venue){clauses.push("instr(replace(lower(venue_group),' ',''),replace(lower(?),' ',''))>0");params.push(venue);}
      if(fee){clauses.push(fee==='unknown'?"json_extract(price_info,'$.type')='unknown'":"json_extract(price_info,'$.type') IN (?, 'mixed')");if(fee!=='unknown')params.push(fee);}
      if(month){const [year,monthNumber]=month.split('-').map(Number),lastDay=new Date(Date.UTC(year,monthNumber,0)).getUTCDate(),first=`${month}-01`,last=`${month}-${String(lastDay).padStart(2,'0')}`;clauses.push("COALESCE(NULLIF(start_date,''),NULLIF(end_date,''))<=? AND COALESCE(NULLIF(end_date,''),NULLIF(start_date,''))>=?");params.push(last,first);}
      if(min!==null||max!==null){clauses.push(`EXISTS(SELECT 1 FROM json_each(news_posts.price_info,'$.amounts') a WHERE CAST(a.value AS INTEGER) BETWEEN ? AND ?${fee==='free'?' AND CAST(a.value AS INTEGER)=0':fee==='paid'?' AND CAST(a.value AS INTEGER)>0':''})`);params.push(min??0,max??100000000);}
      const where=clauses.join(' AND ');
      const total=await env.DB.prepare(`SELECT COUNT(*) AS count FROM news_posts WHERE ${where}`).bind(...params).first();
      const dateOrder=sort|| (archive?'desc':'asc');
      const posts=await rows(env,`SELECT * FROM news_posts WHERE ${where} ORDER BY pinned DESC, CASE WHEN start_date='' THEN 1 ELSE 0 END, start_date ${dateOrder==='desc'?'DESC':'ASC'},created_at DESC,id ASC LIMIT ? OFFSET ?`,...params,limit+1,offset);
      return json({posts:await withReactions(env,posts.slice(0,limit).map(x=>hydrate(x))),hasMore:posts.length>limit,total:Number(total.count)});
    }
    const imageMatch=path.match(/^\/news\/images\/([a-f0-9-]+)$/);
    if(request.method==='GET' && imageMatch) {
      // Uploaded drafts remain private until a published post references the image.
      const row=await env.DB.prepare("SELECT i.body FROM news_images i WHERE i.id=? AND EXISTS(SELECT 1 FROM news_posts p WHERE p.status='published' AND p.deleted_at IS NULL AND p.data LIKE '%' || ? || '%')").bind(imageMatch[1],`/news/images/${imageMatch[1]}`).first();
      if(!row && await authorized(request,env)) {
        const draft=await env.DB.prepare('SELECT body FROM news_images WHERE id=?').bind(imageMatch[1]).first();
        if(draft)return new Response(draft.body,{headers:{...headers,'Content-Type':'image/jpeg','Cache-Control':'no-store'}});
      }
      if(!row)return json({error:'사진을 찾을 수 없습니다.'},404);
      return new Response(row.body,{headers:{...headers,'Content-Type':'image/jpeg','Content-Security-Policy':"default-src 'none'"}});
    }
    const detail=path.match(/^\/news\/posts\/([a-f0-9-]+)$/);
    const view=path.match(/^\/news\/posts\/([a-f0-9-]+)\/view$/);
    const reactionMatch=path.match(/^\/news\/posts\/([a-f0-9-]+)\/reactions$/);
    if(request.method==='POST' && reactionMatch) {
      const id=reactionMatch[1],b=await body(request);
      // One anonymous browser identifier, hashed separately for each post. No IP or login is stored.
      if(typeof b?.visitorId!=='string'||!/^[a-f0-9-]{36}$/.test(b.visitorId))fail('반응 연결 정보를 확인해 주세요.');
      const kinds=['like','thanks','dislike','excited','cheer','sad'];
      const changing=Object.hasOwn(b,'reaction');
      if(changing && b.reaction!==null && !kinds.includes(b.reaction))fail('반응을 선택해 주세요.');
      const post=await env.DB.prepare("SELECT id FROM news_posts WHERE id=? AND status='published' AND deleted_at IS NULL").bind(id).first();
      if(!post)return json({error:'게시글을 찾을 수 없습니다.'},404);
      const visitor=await sha(`${id}:${b.visitorId}`);
      if(changing){
        if(b.reaction===null)await env.DB.prepare('DELETE FROM news_reactions WHERE post_id=? AND visitor_hash=?').bind(id,visitor).run();
        else await env.DB.prepare("INSERT INTO news_reactions(post_id,visitor_hash,reaction) SELECT id,?,? FROM news_posts WHERE id=? AND status='published' AND deleted_at IS NULL ON CONFLICT(post_id,visitor_hash) DO UPDATE SET reaction=excluded.reaction").bind(visitor,b.reaction,id).run();
      }
      const counts=Object.fromEntries(kinds.map(kind=>[kind,0]));
      for(const row of await rows(env,'SELECT reaction,COUNT(*) AS count FROM news_reactions WHERE post_id=? GROUP BY reaction',id))counts[row.reaction]=Number(row.count);
      const selected=await env.DB.prepare('SELECT reaction FROM news_reactions WHERE post_id=? AND visitor_hash=?').bind(id,visitor).first();
      return json({counts,selected:selected?.reaction||null});
    }
    if(request.method==='POST' && view) {
      const row=await env.DB.prepare("UPDATE news_posts SET view_count=view_count+1 WHERE id=? AND status='published' AND deleted_at IS NULL RETURNING *").bind(view[1]).first();
      return row?json({post:hydrate(row)}):json({error:'게시글을 찾을 수 없습니다.'},404);
    }
    if(request.method==='GET' && detail) {
      const row=await env.DB.prepare("SELECT * FROM news_posts WHERE id=? AND status='published' AND deleted_at IS NULL").bind(detail[1]).first();
      return row?json({post:hydrate(row)}):json({error:'게시글을 찾을 수 없습니다.'},404);
    }
    if(admin && request.method==='GET' && path==='/news/admin') {
      const status=url.searchParams.get('status')||'pending';
      if(!['pending','published','hidden','deleted'].includes(status))fail('상태를 확인해 주세요.');
      const category=url.searchParams.get('category')||'';
      if(category&&!['공연','전시','AI·디지털 교육','평생·문화교육'].includes(category))fail('분야를 확인해 주세요.');
      const q=clean(url.searchParams.get('q')).slice(0,160),fee=url.searchParams.get('fee')||'';
      if(!['','free','paid','unknown'].includes(fee))fail('금액 구분을 확인해 주세요.');
      const month=url.searchParams.get('month')||'';
      if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('월별 검색 기간을 확인해 주세요.');
      const offset=Math.max(0,Number(url.searchParams.get('offset'))||0);
      const clauses=status==='deleted'?['deleted_at IS NOT NULL']:['status=?','deleted_at IS NULL'];
      const params=status==='deleted'?[]:[status];
      if(category){clauses.push("json_extract(data,'$.category')=?");params.push(category);}
      if(q){clauses.push("instr(lower(data),lower(?))>0");params.push(q);}
      if(fee){clauses.push(`COALESCE(json_extract(price_info,'$.type'),'unknown') ${fee==='paid'?"IN ('paid','mixed')":'= ?'}`);if(fee!=='paid')params.push(fee);}
      if(month){const [year,monthNumber]=month.split('-').map(Number),lastDay=new Date(Date.UTC(year,monthNumber,0)).getUTCDate(),first=`${month}-01`,last=`${month}-${String(lastDay).padStart(2,'0')}`;clauses.push("COALESCE(NULLIF(start_date,''),NULLIF(end_date,''))<=? AND COALESCE(NULLIF(end_date,''),NULLIF(start_date,''))>=?");params.push(last,first);}
      params.push(offset);
      const where=clauses.join(' AND ');
      const posts=status==='deleted'
        ? await rows(env,`SELECT * FROM news_posts WHERE ${where} ORDER BY deleted_at DESC LIMIT 51 OFFSET ?`,...params)
        : await rows(env,`SELECT * FROM news_posts WHERE ${where} ORDER BY updated_at DESC LIMIT 51 OFFSET ?`,...params);
      const changes=await rows(env,"SELECT * FROM news_posts WHERE candidate IS NOT NULL AND status<>'hidden' AND deleted_at IS NULL ORDER BY checked_at DESC LIMIT 50");
      const counts=await rows(env,"SELECT CASE WHEN deleted_at IS NOT NULL THEN 'deleted' ELSE status END AS status,COUNT(*) AS count FROM news_posts GROUP BY CASE WHEN deleted_at IS NOT NULL THEN 'deleted' ELSE status END");
      return json({sources:await rows(env,'SELECT * FROM news_sources ORDER BY name'),posts:posts.slice(0,50).map(x=>hydrate(x,true)),hasMore:posts.length>50,changes:changes.map(x=>hydrate(x,true)),counts});
    }
    if(admin && request.method==='GET' && path==='/news/admin/export') {
      return json({version:1,exportedAt:nowISO(),sources:await rows(env,'SELECT * FROM news_sources'),posts:await rows(env,'SELECT * FROM news_posts'),images:await rows(env,'SELECT id,created_at FROM news_images'),reactions:await rows(env,'SELECT post_id,reaction,COUNT(*) AS count FROM news_reactions GROUP BY post_id,reaction')});
    }
    if(admin && request.method==='POST' && path==='/news/admin/bulk') {
      const b=await body(request);
      if(!['publish','hide','delete','restore','category'].includes(b.action))fail('처리 방법을 선택해 주세요.');
      if(!Array.isArray(b.ids)||!b.ids.length||b.ids.length>100||b.ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))fail('게시글을 1~100개 선택해 주세요.');
      const allowedCategories=['공연','전시','AI·디지털 교육','평생·문화교육'];
      if(b.action==='category'&&!allowedCategories.includes(b.category))fail('변경할 분야를 선택해 주세요.');
      const ids=[...new Set(b.ids)],encodedIds=JSON.stringify(ids),stamp=nowISO();
      const records=await rows(env,'SELECT id,deleted_at FROM news_posts WHERE id IN (SELECT value FROM json_each(?))',encodedIds);
      if(records.length!==ids.length)fail('일부 글을 찾을 수 없습니다. 목록을 새로고침해 주세요.',409);
      const restoring=b.action==='restore';
      if(records.some(r=>restoring?!r.deleted_at:!!r.deleted_at))fail('글 상태가 바뀌었습니다. 목록을 새로고침해 주세요.',409);
      if(b.action==='category'){
        const updated=await rows(env,"UPDATE news_posts SET data=json_set(data,'$.category',?),locked=1,updated_at=? WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL RETURNING id",b.category,stamp,encodedIds);
        return json({ok:true,count:updated.length});
      }
      const changes={publish:"status='published',locked=1",hide:"status='hidden',locked=1",delete:'deleted_at=?,locked=1',restore:"deleted_at=NULL,status='pending',locked=1"};
      const values=b.action==='delete'?[stamp,stamp,encodedIds]:[stamp,encodedIds];
      const updated=await rows(env,`UPDATE news_posts SET ${changes[b.action]},updated_at=? WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS ${restoring?'NOT ':''}NULL RETURNING id`,...values);
      return json({ok:true,count:updated.length});
    }
    const backupImage=path.match(/^\/news\/admin\/backup-image\/([a-f0-9-]+)$/);
    if(admin && request.method==='GET' && backupImage) {
      const row=await env.DB.prepare('SELECT body FROM news_images WHERE id=?').bind(backupImage[1]).first();
      return row?new Response(row.body,{headers:{...headers,'Content-Type':'image/jpeg'}}):json({error:'사진을 찾을 수 없습니다.'},404);
    }
    if(admin && request.method==='POST' && path==='/news/admin/cleanup-images') {
      const result=await env.DB.prepare("DELETE FROM news_images WHERE julianday(created_at)<julianday('now','-1 day') AND NOT EXISTS(SELECT 1 FROM news_posts WHERE data LIKE '%' || '/news/images/' || news_images.id || '%' OR candidate LIKE '%' || '/news/images/' || news_images.id || '%')").run();
      return json({removed:result.meta?.changes||0});
    }
    if(admin && request.method==='POST' && path==='/news/admin/collection') {
      const b=await body(request);
      if(b.action==='start') {
        const lock=await env.DB.prepare("INSERT INTO news_locks(id,expires_at) VALUES('collect',unixepoch()+900) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at WHERE news_locks.expires_at<unixepoch()").run();
        return json({busy:!lock.meta?.changes,sources:lock.meta?.changes?await rows(env,'SELECT * FROM news_sources WHERE enabled=1 ORDER BY name LIMIT 12'):[]});
      }
      if(b.action==='finish'){await env.DB.prepare("DELETE FROM news_locks WHERE id='collect'").run();return json({ok:true});}
      const source=await env.DB.prepare('SELECT * FROM news_sources WHERE id=?').bind(clean(b.sourceId)).first();
      if(!source || !source.enabled)fail('수집할 사이트를 찾을 수 없습니다.',404);
      if(b.action==='state') {
        await env.DB.prepare('UPDATE news_sources SET last_attempt=? WHERE id=?').bind(nowISO(),source.id).run();
        return json({source,seen:await rows(env,'SELECT url,checked_at FROM news_seen WHERE source_id=?',source.id)});
      }
      if(b.action==='ingest')return json(await ingestPost(env,source,b.url,b.data));
      if(b.action==='result'){
        const error=clean(b.error).slice(0,500),count=Math.max(0,Number(b.count)||0);
        if(error)await env.DB.prepare('UPDATE news_sources SET last_error=?,last_count=? WHERE id=?').bind(error,count,source.id).run();
        else await env.DB.prepare('UPDATE news_sources SET last_success=?,last_error=NULL,last_count=? WHERE id=?').bind(nowISO(),count,source.id).run();
        return json({ok:true});
      }
      fail('수집 요청을 확인해 주세요.');
    }
    if(admin && request.method==='POST' && path==='/news/admin/collect') {
      const b=await body(request);if(!b.sourceId)fail('확인할 사이트를 선택해 주세요.');
      const result=await runCollection(env,clean(b.sourceId));return json(result,result.busy?409:200);
    }
    if(admin && request.method==='POST' && path==='/news/admin/image') {
      const bytes=await request.arrayBuffer();
      if(bytes.byteLength>180000 || bytes.byteLength<3 || new Uint8Array(bytes)[0]!==255 || new Uint8Array(bytes)[1]!==216)fail('사진은 180KB 이하 JPEG만 올릴 수 있습니다.');
      const total=await env.DB.prepare('SELECT COALESCE(SUM(length(body)),0) AS size FROM news_images').first();
      if(total.size+bytes.byteLength>50000000)fail('무료 운영을 위한 사진 보관 한도에 도달했습니다. 백업 후 지난 사진을 정리해 주세요.',413);
      const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO news_images VALUES(?,?,?)').bind(id,bytes,nowISO()).run();return json({url:`/news/images/${id}`});
    }
    if(admin && request.method==='POST' && path==='/news/admin/post') {
      const b=await body(request),stamp=nowISO();
      if(!['published','pending','hidden'].includes(b.status))fail('게시 상태를 선택해 주세요.');
      const data=validatePost(b),id=b.id||crypto.randomUUID();
      const existing=b.id?await env.DB.prepare('SELECT * FROM news_posts WHERE id=?').bind(id).first():null;
      if(b.id && !existing)fail('게시글을 찾을 수 없습니다.',404);
      if(existing?.deleted_at)fail('삭제함에서 먼저 복구해 주세요.',409);
      const fp=await fingerprint(data);
      if(existing) await env.DB.prepare('UPDATE news_posts SET data=?,candidate=NULL,status=?,locked=1,pinned=?,start_date=?,end_date=?,fingerprint=?,updated_at=?,price_info=?,venue_group=? WHERE id=?').bind(JSON.stringify(data),b.status,b.pinned?1:0,data.startDate,data.endDate,fp,stamp,JSON.stringify(priceInfo(data.price)),venueGroup(data.venue,data.title,existing?.source_id),id).run();
      else await env.DB.prepare('INSERT INTO news_posts(id,status,data,locked,pinned,start_date,end_date,fingerprint,created_at,updated_at,price_info,venue_group) VALUES(?,?,?,1,?,?,?,?,?,?,?,?)').bind(id,b.status,JSON.stringify(data),b.pinned?1:0,data.startDate,data.endDate,fp,stamp,stamp,JSON.stringify(priceInfo(data.price)),venueGroup(data.venue,data.title)).run();
      return json({ok:true,id});
    }
    if(admin && request.method==='POST' && path==='/news/admin/source') {
      const b=await body(request),id=b.id||crypto.randomUUID(),name=clean(b.name).slice(0,100),address=publicURL(b.url);
      if(!name || !address)fail('사이트 이름과 공개 주소를 입력해 주세요.');
      if(!['woojin','sori','ssac','nol','culturePerform','nihc','jjticket','wanju','naru','kukak','library','generic'].includes(b.adapter))fail('수집 방식을 확인해 주세요.');
      let config;try{config=typeof b.config==='string'?JSON.parse(b.config):b.config||{};}catch{fail('수집 설정 JSON을 확인해 주세요.');}
      const count=await env.DB.prepare('SELECT COUNT(*) AS count FROM news_sources').first();
      const previous=await env.DB.prepare('SELECT id FROM news_sources WHERE id=?').bind(id).first();
      if(!previous && count.count>=MAX_SOURCES)fail('무료 운영을 위해 사이트는 최대 12곳까지 등록합니다. 더 늘릴 때 수집 용량을 점검해 주세요.');
      if(b.autoPublish && b.adapter==='generic' && (!config.links||!config.title||!config.date||!config.venue))fail('수집 항목 확인 후 자동 게시를 켤 수 있습니다.');
      await env.DB.prepare('INSERT INTO news_sources(id,name,url,adapter,config,enabled,auto_publish,images_allowed) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,adapter=excluded.adapter,config=excluded.config,enabled=excluded.enabled,auto_publish=excluded.auto_publish,images_allowed=excluded.images_allowed').bind(id,name,address,b.adapter,JSON.stringify(config),b.enabled?1:0,b.autoPublish?1:0,b.imagesAllowed?1:0).run();
      return json({ok:true,id});
    }
    return json({error:'요청 경로를 확인해 주세요.'},404);
  }catch(e){if(!e.status)console.error('news error',e);return json({error:e.status?e.message:'소식을 처리하지 못했습니다. 연결 상태를 확인해 주세요.'},e.status||500);}
}
