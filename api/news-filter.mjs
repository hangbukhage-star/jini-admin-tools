import '../assets/news-place.js';
const {jiniRepresentativeVenue: representativeVenue} = globalThis;
const upstream = 'https://jini-tool-stats.yjj32.workers.dev';
async function getNews(params) {
  const response = await fetch(upstream + '/news?' + params, {signal: AbortSignal.timeout(8000)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '게시판을 불러오지 못했습니다.');
  return data;
}
export async function filterNews(query) {
  const params = new URLSearchParams(query);
  const mode = params.get('mode');
  const region = params.get('region') || '';
  const venue = params.get('venue') || '';
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const limit = Math.min(50, Math.max(1, Number(params.get('limit')) || 30));
  params.delete('mode');
  params.delete('venue');
  if (region === 'other') params.delete('region');
  params.set('limit','50');
  params.set('offset','0');
  const first = await getNews(params);
  if(first.total > 10000) throw Error('검색 조건을 추가해 주세요.');
  const pages = [];
  for (let start = 50; start < first.total; start += 50) pages.push(start);
  const rest = await Promise.all(pages.map(start => {
    const page = new URLSearchParams(params);
    page.set('offset', String(start));
    return getNews(page);
  }));
  const posts = [first, ...rest].flatMap(page => page.posts)
    .filter(post => region !== 'other' || post.region !== '전주')
    .map(post => ({...post, placeName: representativeVenue(post.venueGroup || post.venue)}));
  if (mode === 'venues') return {venues: [...new Set(posts.map(post => post.placeName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'))};
  const matching = venue ? posts.filter(post => post.placeName === venue) : posts;
  return {posts:matching.slice(offset,offset+limit),total:matching.length,hasMore:offset+limit<matching.length};
}

export default async function handler(req,res) {
  if (req.method !== 'GET') return res.status(405).json({error:'조회만 지원합니다.'});
  try {
    const params = new URL(req.url,'http://localhost').searchParams;
    const result = await filterNews(params);
    res.setHeader('Cache-Control','public, s-maxage=45, stale-while-revalidate=60');
    res.status(200).json(result);
  } catch(error) {
    res.status(502).json({error:error.message});
  }
}

