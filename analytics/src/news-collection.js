import {fetchPage,linksFrom,listingURLs} from './news-collectors.js';
import {parseDetail} from './news-collectors.js';

const PAGED_LISTS={
  sori:{parameter:'page',first:0,pageSize:100},
  ssac:{parameter:'page',first:1},
  culturePerform:{parameter:'pageIndex',first:1},
  woojin:{parameter:'page',first:1},
  library:{parameter:'startPage',first:1},
  jjticket:{parameter:'page',first:1},
  wanju:{parameter:'page',first:1},
  nihc:{parameter:'page',first:1},
  museumEs:{parameter:'nPage',first:1},
  historyMuseum:{parameter:'page',first:1},
};
const MAX_LIST_PAGES_PER_RUN=4;
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
    if(source.adapter==='sori')url.searchParams.set('size',String(plan.pageSize));
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
async function collectListingItems(source,fetcher,deadline,startAt){
  const found=new Map();
  let warning='';
  if(source.adapter==='nihc'){
    const periods=listingURLs(source).map(url=>new URL(url));
    const first=periods[0];
    const token=typeof startAt==='string'?startAt:'';
    const parsed=token.match(/^(\d{4}-\d{2}):(\d+)$/);
    let periodIndex=parsed?periods.findIndex(u=>u.searchParams.get('year')===parsed[1].slice(0,4)&&String(u.searchParams.get('month')).padStart(2,'0')===parsed[1].slice(5,7)):0;
    let page=parsed?Number(parsed[2]):1;
    if(periodIndex<0||!Number.isInteger(page)||page<1){periodIndex=0;page=1;}
    let calls=0,nextCursor=`${periods[periodIndex].searchParams.get('year')}-${String(periods[periodIndex].searchParams.get('month')).padStart(2,'0')}:${page}`;
    // Always refresh the current month's first page, then continue the saved month/page cursor.
    const queue=[{period:0,page:1}];
    if(!(periodIndex===0&&page===1))queue.push({period:periodIndex,page});
    else queue.push({period:0,page:2});
    while(queue.length&&calls<MAX_LIST_PAGES_PER_RUN){
      if(Date.now()>deadline){warning='목록을 끝까지 확인하기 전에 이번 수집 시간이 끝났습니다.';break;}
      const current=queue.shift();if(current.period>=periods.length)break;
      const u=new URL(periods[current.period]);u.searchParams.set('page',String(current.page));
      let items;
      try{items=linksFrom(await fetcher(u.href),u.href,source);}
      catch(e){if(!found.size)throw e;warning=`${current.period+1}번째 월 ${current.page}페이지 목록 확인 실패: ${e.message}`;nextCursor=`${periods[current.period].searchParams.get('year')}-${String(periods[current.period].searchParams.get('month')).padStart(2,'0')}:${current.page}`;break;}
      calls++;
      if(!items.length){
        const nextPeriod=current.period+1;
        if(nextPeriod<periods.length){queue.push({period:nextPeriod,page:1});nextCursor=`${periods[nextPeriod].searchParams.get('year')}-${String(periods[nextPeriod].searchParams.get('month')).padStart(2,'0')}:1`;continue;}
        nextCursor=`${periods[0].searchParams.get('year')}-${String(periods[0].searchParams.get('month')).padStart(2,'0')}:1`;continue;
      }
      for(const item of items)if(!found.has(item.url))found.set(item.url,item);
      const nextPage=current.page+1;
      queue.push({period:current.period,page:nextPage});
      nextCursor=`${periods[current.period].searchParams.get('year')}-${String(periods[current.period].searchParams.get('month')).padStart(2,'0')}:${nextPage}`;
    }
    if(queue.length&&!warning)warning=`목록 ${calls}페이지를 확인했습니다. 남은 페이지는 다음 실행에서 이어 확인합니다.`;
    return {items:[...found.values()],warning,nextPage:nextCursor,startPage:token||`${first.searchParams.get('year')}-${String(first.searchParams.get('month')).padStart(2,'0')}:1`,firstPage:`${first.searchParams.get('year')}-${String(first.searchParams.get('month')).padStart(2,'0')}:1`};
  }
  if(source.adapter==='naru'||PAGED_LISTS[source.adapter]){
    const plan=PAGED_LISTS[source.adapter]||{first:1};
    const first=plan.first??1;
    const cursor=Number.isInteger(Number(startAt))&&Number(startAt)>=first?Number(startAt):first;
    const pages=cursor===first?[first]:[first,cursor];
    let pageCount=0,nextPage=cursor,ended=false,previousPageItems=null,previousSequentialPage=null;
    while(pages.length&&pageCount<MAX_LIST_PAGES_PER_RUN){
      if(Date.now()>deadline){warning='목록을 끝까지 확인하기 전에 이번 수집 시간이 끝났습니다.';break;}
      const current=pages.shift();
      if(current===undefined)break;
      const url=pagedListURL(source,current);
      let items;
      try{items=linksFrom(await fetcher(url),url,source);}
      catch(e){if(!found.size)throw e;warning=`${current}페이지 목록 확인 실패: ${e.message}`;nextPage=current;break;}
      if(!items.length){
        if(current===first&&cursor!==first){warning='최신 목록 페이지에서 글을 찾지 못했습니다.';continue;}
        nextPage=first;ended=true;break;
      }
      for(const item of items)if(!found.has(item.url))found.set(item.url,item);
      if(previousSequentialPage!==null&&current===previousSequentialPage+1&&previousPageItems&&items.every(item=>previousPageItems.has(item.url))){
        warning=`${current}페이지가 이전 페이지와 같습니다. 사이트의 페이지 넘김 방식을 확인해야 합니다.`;
        nextPage=current;break;
      }
      const currentSet=new Set(items.map(item=>item.url));
      if(current===first&&cursor!==first){
        // The saved cursor is already queued; do not enqueue it twice.
      }else{
        previousSequentialPage=current;previousPageItems=currentSet;
        nextPage=current+1;
        pages.push(current+1);
      }
      pageCount++;
    }
    if(ended)nextPage=first;
    if(pages.length&&!warning)warning=`목록 ${pageCount}페이지를 확인했습니다. 남은 페이지는 다음 실행에서 이어 확인합니다.`;
    return {items:[...found.values()],warning,nextPage,firstPage:first,startPage:cursor};
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
  let state=null;
  let nextPage=null;
  let retryPage=null;
  try{
    state=await client({action:'state',sourceId:source.id});
    const {seen}=state;
    const listing=await collectListingItems(source,fetcher,deadline,state.nextPage),found=listing.items;
    nextPage=listing.nextPage??state.nextPage;
    retryPage=listing.startPage??listing.firstPage??listing.nextPage;
    if(!found.length)throw new Error(listing.warning||'목록에서 글을 찾지 못했습니다. 사이트 주소나 수집 설정을 확인하세요.');
    const checked=new Map(seen.map(x=>[x.url,x.checked_at]));
    const items=found.sort((a,b)=>(checked.get(a.url)||'').localeCompare(checked.get(b.url)||'')).slice(0,30);
    const unseen=found.filter(item=>!checked.has(item.url)).length;
    const deferred=unseen>items.length;
    const errors=[];
    for(const item of items){
      if(Date.now()>deadline)throw new Error('이번 수집 시간을 마쳤습니다. 다음 실행에서 이어 확인합니다.');
      try{
        const data=parseDetail(await fetcher(item.url),item.url,source,item.hint);
        const result=await client({action:'ingest',sourceId:source.id,url:item.url,data});
        if(!result.skipped)count++;
      }catch(e){errors.push(e.message);}
    }
    if(errors.length){nextPage=listing.startPage??listing.firstPage??listing.nextPage;throw new Error(`${count}개 확인, ${errors.length}개 실패: ${errors[0]}`);}
    if(deferred)nextPage=listing.startPage??listing.firstPage??listing.nextPage;
    if(deferred||listing.warning){
      const reasons=[];
      if(deferred)reasons.push(`새 항목 ${unseen}건 중 일부를 처리량 한도로 다음 실행에서 확인합니다`);
      if(listing.warning)reasons.push(listing.warning);
      await client({action:'result',sourceId:source.id,count,error:`${count}개 확인. ${reasons.join(' ')}.`,nextPage});
      return {id:source.id,count,ok:false,error:`${count}개 확인. ${reasons.join(' ')}.`};
    }
    await client({action:'result',sourceId:source.id,count,nextPage});
    return {id:source.id,count,ok:true};
  }catch(e){await client({action:'result',sourceId:source.id,count,error:e.message,nextPage:retryPage??nextPage??state?.nextPage});return {id:source.id,count,ok:false,error:e.message};}
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
