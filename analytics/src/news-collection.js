import {fetchPage,linksFrom,listingURLs} from './news-collectors.js';
import {parseDetail} from './news-collectors.js';

// Runs on Vercel/Node, where HTML parsing is not constrained by Workers Free's 10ms CPU limit.
export async function collectSite(source,client,fetcher=fetchPage,deadline=Date.now()+240000) {
  let count=0;
  try{
    const {seen}=await client({action:'state',sourceId:source.id});
    const found=new Map();
    for(const url of listingURLs(source)){
      if(Date.now()>deadline)throw new Error('이번 수집 시간을 마쳤습니다. 다음 실행에서 이어 확인합니다.');
      for(const item of linksFrom(await fetcher(url),url,source))found.set(item.url,item);
    }
    if(!found.size)throw new Error('목록에서 글을 찾지 못했습니다. 사이트 주소나 수집 설정을 확인하세요.');
    const checked=new Map(seen.map(x=>[x.url,x.checked_at]));
    const items=[...found.values()].sort((a,b)=>(checked.get(a.url)||'').localeCompare(checked.get(b.url)||'')).slice(0,30);
    const errors=[];
    for(const item of items){
      if(Date.now()>deadline)throw new Error('이번 수집 시간을 마쳤습니다. 다음 실행에서 이어 확인합니다.');
      try{
        const data=parseDetail(await fetcher(item.url),item.url,source,item.hint);
        const result=await client({action:'ingest',sourceId:source.id,url:item.url,data});
        if(!result.skipped)count++;
      }catch(e){errors.push(e.message);}
    }
    if(errors.length)throw new Error(`${count}개 확인, ${errors.length}개 실패: ${errors[0]}`);
    await client({action:'result',sourceId:source.id,count});
    return {id:source.id,count,ok:true};
  }catch(e){await client({action:'result',sourceId:source.id,count,error:e.message});return {id:source.id,count,ok:false,error:e.message};}
}
export async function collectAll(client,sourceId,fetcher=fetchPage) {
  const state=await client({action:'start'});
  if(state.busy)return {busy:true};
  try{
    const sources=sourceId?state.sources.filter(s=>s.id===sourceId):state.sources;
    if(sourceId&&!sources.length)throw new Error('사용 중인 수집 사이트를 선택해 주세요.');
    // Separate sources can be extended without changing the public board or storage API.
    const results=[],deadline=Date.now()+240000;
    for(let i=0;i<sources.length;i++){
      const budget=(deadline-Date.now())/(sources.length-i);
      results.push(await collectSite(sources[i],client,fetcher,Date.now()+budget));
    }
    return {results};
  }finally{await client({action:'finish'});}
}
