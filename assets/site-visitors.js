(()=>{
  const base=String(window.JINI_STATS_CONFIG?.apiBase||'https://jini-tool-stats.yjj32.workers.dev').replace(/\/$/,'');
  let visitorId='';
  try{visitorId=localStorage.getItem('jini-site-visitor')||'';if(!/^[a-f0-9-]{36}$/.test(visitorId)){visitorId=crypto.randomUUID();localStorage.setItem('jini-site-visitor',visitorId);}}
  catch{try{visitorId=sessionStorage.getItem('jini-site-visitor')||crypto.randomUUID();sessionStorage.setItem('jini-site-visitor',visitorId);}catch{visitorId='';}}
  const show=data=>{document.querySelectorAll('[data-visit-today]').forEach(e=>e.textContent=Number(data.today).toLocaleString('ko-KR')+'명');document.querySelectorAll('[data-visit-total]').forEach(e=>e.textContent=Number(data.total).toLocaleString('ko-KR')+'명');};
  async function request(count){const response=await fetch(base+'/site/visits',{method:count?'POST':'GET',...(count?{headers:{'Content-Type':'application/json'},body:JSON.stringify({visitorId})}:{}),signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('방문자 집계 연결 오류');return response.json();}
  (async()=>{try{show(await request(!!visitorId));}catch{try{show(await request(false));}catch{document.querySelectorAll('[data-visit-today],[data-visit-total]').forEach(e=>e.textContent='연결 확인 중');}}})();
})();
