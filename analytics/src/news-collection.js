import {fetchPage,linksFrom,listingURLs} from './news-collectors.js';
import {parseDetail} from './news-collectors.js';

const PAGED_LISTS={
  ssac:{parameter:'page'},
  culturePerform:{parameter:'pageIndex'},
  woojin:{parameter:'page'},
  library:{parameter:'startPage'},
  jjticket:{parameter:'page'},
  wanju:{parameter:'page'},
};
const MAX_LIST_PAGES=50;
function pagedListURL(source,page){
  const url=new URL(source.url);
  if(source.adapter==='naru'){
    url.searchParams.set('offset',String((page-1)*9));
    if(!url.searchParams.has('findvalue'))url.searchParams.set('findvalue','');
    if(!url.searchParams.has('search'))url.searchParams.set('search','');
  }else{
    const plan=PAGED_LISTS[source.adapter];
    url.searchParams.set(plan.parameter,String(page));
    if(source.adapter==='ssac')url.searchParams.set('do','list');
    if(source.adapter==='culturePerform'){
      url.searchParams.set('rgnClctCd2','13');url.searchParams.set('menuNo','400013');
      if(!url.searchParams.has('sttsNm2'))url.searchParams.set('sttsNm2','');
      if(!url.searchParams.has('searchKwd'))url.searchParams.set('searchKwd','');
    }
    if(source.adapter==='library'){
      url.searchParams.set('orderField','RE_SDATE');url.searchParams.set('orderSort','desc');
    }
  }
  return url.href;
}
async function collectListingItems(source,fetcher,deadline){
  const found=new Map();
  let warning='';
  if(source.adapter==='naru'||PAGED_LISTS[source.adapter]){
    for(let page=1;page<=MAX_LIST_PAGES;page++){
      if(Date.now()>deadline){warning='목록을 끝까지 확인하기 전에 이번 수집 시간이 끝났습니다.';break;}
      const url=pagedListURL(source,page);
      let items;
      try{items=linksFrom(await fetcher(url),url,source);}
      catch(e){if(!found.size)throw e;warning=`${page}페이지 목록 확인 실패: ${e.message}`;break;}
      if(!items.length)return {items:[...found.values()],warning};
      let added=0;
      for(const item of items)if(!found.has(item.url)){found.set(item.url,item);added++;}
      // Some sites ignore a page parameter; stop rather than refetch the same page forever.
      if(page>1&&!added)break;
      if(page===MAX_LIST_PAGES)warning=`목록 ${MAX_LIST_PAGES}페이지까지만 확인했습니다. 더 많은 글이 있을 수 있습니다.`;
    }
    return {items:[...found.values()],warning};
  }
  for(const url of listingURLs(source)){
    if(Date.now()>deadline){warning='목록을 끝까지 확인하기 전에 이번 수집 시간이 끝났습니다.';break;}
    try{for(const item of linksFrom(await fetcher(url),url,source))found.set(item.url,item);}
    catch(e){if(!found.size)throw e;warning=`일부 목록 확인 실패: ${e.message}`;break;}
  }
  return {items:[...found.values()],warning};
}

// Runs on Vercel/Node, where HTML parsing is not constrained by Workers Free's 10ms CPU limit.
export async function collectSite(source,client,fetcher=fetchPage,deadline=Date.now()+240000) {
  let count=0;
  try{
    const {seen}=await client({action:'state',sourceId:source.id});
    const listing=await collectListingItems(source,fetcher,deadline),found=listing.items;
    if(!found.length)throw new Error(listing.warning||'목록에서 글을 찾지 못했습니다. 사이트 주소나 수집 설정을 확인하세요.');
    const checked=new Map(seen.map(x=>[x.url,x.checked_at]));
    const items=found.sort((a,b)=>(checked.get(a.url)||'').localeCompare(checked.get(b.url)||'')).slice(0,30);
    const deferred=found.length-items.length;
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
    if(deferred||listing.warning){
      const reasons=[];
      if(deferred)reasons.push(`목록 ${found.length}건 중 ${deferred}건은 처리량 한도로 다음 실행에서 확인합니다`);
      if(listing.warning)reasons.push(listing.warning);
      throw new Error(`${count}개 확인. ${reasons.join(' ')}.`);
    }
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
