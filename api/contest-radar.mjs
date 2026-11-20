import { timingSafeEqual } from 'node:crypto';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.query.bridge === '1') {
    if (req.method !== 'POST') return res.status(405).json({error:'POST required'});
    const secret=process.env.RADAR_BRIDGE_SECRET;
    const supplied=Buffer.from(req.headers.authorization || '');
    const expected=Buffer.from('Bearer '+secret);
    if (!secret || supplied.length!==expected.length || !timingSafeEqual(supplied,expected))
      return res.status(401).json({error:'Unauthorized'});
    try {
      const upstream=await fetch(new URL('/state',process.env.RADAR_BRIDGE_ORIGIN),{
        method:'PUT',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},
        body:JSON.stringify(req.body),signal:AbortSignal.timeout(10000),redirect:'error'
      });
      return res.status(upstream.status).json(await upstream.json());
    } catch {
      return res.status(503).json({error:'Storage unavailable'});
    }
  }
  if (req.method !== 'GET') return res.status(405).json({error:'GET만 지원합니다.'});
  if (req.query.feed === '1') {
    const origin=process.env.RADAR_BRIDGE_ORIGIN;
    if (!origin) return res.status(503).json({error:'Feed pending'});
    try {
      const upstream=await fetch(new URL('/feed',origin),{signal:AbortSignal.timeout(5000),redirect:'error'});
      if (!upstream.ok) throw new Error('Feed unavailable');
      const feed=await upstream.json();
      if (!Array.isArray(feed)) throw new Error('Invalid feed');
      res.setHeader('Cache-Control','s-maxage=60, stale-while-revalidate=120');
      return res.status(200).json(feed);
    } catch {
      return res.status(503).json({error:'Feed unavailable'});
    }
  }
  const id = req.query.id;
  if (id !== undefined && (typeof id !== 'string' || !/^\d{1,12}$/.test(id)))
    return res.status(400).json({error:'공고 번호를 확인해 주세요.'});
  const setting=process.env.CONTEST_RADAR_ORIGIN;
  if (!setting) return res.status(503).json({error:'실시간 수집 서버 미연결'});
  try {
    const origin=new URL(setting);
    if (origin.protocol!=='https:' || origin.username || origin.password)
      throw new Error('Invalid origin');
    const target = new URL('/api/contests'+(id?'/'+id:''),origin);
    for(const key of ['q','tag','status','type','sort','education']) {
      const value=req.query[key];
      if(typeof value==='string') target.searchParams.set(key,value.slice(0,200));
    }
    const upstream=await fetch(target,{signal:AbortSignal.timeout(5000),redirect:'error'});
    if (!upstream.ok && upstream.status!==404) throw new Error('Upstream unavailable');
    return res.status(upstream.status).json(await upstream.json());
  } catch {
    return res.status(502).json({error:'실시간 수집 서버에 연결하지 못했습니다.'});
  }
}
