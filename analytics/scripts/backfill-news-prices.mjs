// Run once after migration 0010 and Worker deployment. Only derived search data changes.
// From repository root: node --env-file=.env.news.local analytics/scripts/backfill-news-prices.mjs
import {writeFileSync,mkdirSync} from 'node:fs';
import {priceInfo} from '../src/news-core.js';
const key=process.env.NEWS_ADMIN_KEY;
if(!key)throw new Error('NEWS_ADMIN_KEY 환경변수가 필요합니다.');
const response=await fetch('https://jini-tool-stats.yjj32.workers.dev/news/admin/export',{headers:{Authorization:`Bearer ${key}`}});
if(!response.ok)throw new Error(`자료 확인 실패 (${response.status})`);
const {posts}=await response.json(),quote=value=>`'${String(value).replace(/'/g,"''")}'`;
const statements=posts.map(post=>{
  const price=String(JSON.parse(post.data).price??'');
  return `UPDATE news_posts SET price_info=${quote(JSON.stringify(priceInfo(price)))} WHERE id=${quote(post.id)} AND COALESCE(CAST(json_extract(data,'$.price') AS TEXT),'')=${quote(price)};`;
});
mkdirSync(new URL('../../tmp/',import.meta.url),{recursive:true});
writeFileSync(new URL('../../tmp/news-price-backfill.sql',import.meta.url),statements.join('\n'));
console.log(`${posts.length}개 글의 요금 검색 자료를 tmp/news-price-backfill.sql에 준비했습니다. 원문 내용과 상태는 변경하지 않습니다.`);
