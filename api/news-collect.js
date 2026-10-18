import {timingSafeEqual,createHash} from 'node:crypto';
import {collectAll} from '../analytics/src/news-collection.js';

export const config={maxDuration:300};
export default async function handler(req,res) {
  const secret=process.env.NEWS_COLLECTOR_KEY||'';
  const supplied=(req.headers.authorization||'').replace(/^Bearer /,'');
  const digest=x=>createHash('sha256').update(x).digest();
  if(secret.length<32 || !timingSafeEqual(digest(secret),digest(supplied)))return res.status(401).json({error:'수집기 인증에 실패했습니다.'});
  if(req.method!=='POST')return res.status(405).json({error:'POST 요청만 지원합니다.'});
  if(!process.env.NEWS_ADMIN_KEY)return res.status(503).json({error:'저장 서비스 관리자 연결이 필요합니다.'});
  const base='https://jini-tool-stats.yjj32.workers.dev';
  const client=async body=>{
    const r=await fetch(`${base}/news/admin/collection`,{method:'POST',headers:{Authorization:`Bearer ${process.env.NEWS_ADMIN_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const result=await r.json();if(!r.ok)throw new Error(result.error||'저장 서비스 연결 오류');return result;
  };
  try{
    const sourceId=req.body?.sourceId;
    const data=await collectAll(client,typeof sourceId==='string'?sourceId:undefined);
    return res.status(data.busy?409:200).json(data);
  }catch(e){console.error('news collection',e.message);return res.status(500).json({error:e.message});}
}
