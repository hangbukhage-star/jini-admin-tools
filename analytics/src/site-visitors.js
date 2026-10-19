import {koreaToday} from './news-core.js';
const START='2026-10-19';
export async function cleanupVisitors(env,now=new Date()) {
  const cutoff=koreaToday(new Date(+now-3*86400000));
  await env.DB.prepare('DELETE FROM site_visit_days WHERE visit_date<?').bind(cutoff).run();
}
export async function siteVisitors(request,env,origin,now=new Date()) {
  const headers={'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store','Vary':'Origin'};
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(!['GET','POST'].includes(request.method))return json({error:'지원하지 않는 요청입니다.'},405);
  const today=koreaToday(now);
  try{
    if(request.method==='POST'){
      if(Number(request.headers.get('Content-Length'))>1000)return json({error:'입력 내용을 확인해 주세요.'},413);
      const raw=await request.text();if(raw.length>1000)return json({error:'입력 내용을 확인해 주세요.'},413);
      let data;try{data=JSON.parse(raw);}catch{return json({error:'입력 내용을 확인해 주세요.'},400);}
      if(typeof data?.visitorId!=='string'||!/^[a-f0-9-]{36}$/.test(data.visitorId))return json({error:'방문 연결 정보를 확인해 주세요.'},400);
      if(today>=START){
        const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${today}:${data.visitorId}`));
        const visitor=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
        // A primary key and trigger make retry/parallel requests count only once per day.
        await env.DB.prepare('INSERT OR IGNORE INTO site_visit_days(visit_date,visitor_hash) VALUES(?,?)').bind(today,visitor).run();
      }
    }
    const counts=await env.DB.prepare('SELECT COALESCE(SUM(visitors),0) AS total,COALESCE(SUM(CASE WHEN visit_date=? THEN visitors ELSE 0 END),0) AS today FROM site_visitor_counts WHERE visit_date>=?').bind(today,START).first();
    return json({today:Number(counts.today),total:Number(counts.total),date:today,startDate:START});
  }catch(e){console.error('site visitors',e.message);return json({error:'방문자 집계를 불러오지 못했습니다.'},500);}
}
