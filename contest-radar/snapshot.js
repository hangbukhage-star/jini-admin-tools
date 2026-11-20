(() => {
  const kst = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  function getItem(item, current) {
    const [day, time] = current.split(' ');
    const days = Math.round((Date.parse(item.end) - Date.parse(day)) / 86400000);
    const closed = days < 0 || (days === 0 && item.time && time > item.time);
    const status = item.start > day ? 'upcoming' : closed ? 'closed' : 'open';
    return {...item,primary:item.tags[0],days,status};
  }
  const tags = ['AI 활용','행정업무','국민 누구나 참여'];
  const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
  let snapshot;
  window.radarPublicFallback = async path => {
    snapshot ??= fetch('/contest-radar/public-data.json').then(response => {
      if (!response.ok) throw new Error('공모전 목록을 불러올 수 없습니다.');
      return response.json();
    }).catch(error => {snapshot = undefined; throw error;});
    const current = kst.format(new Date());
    const rows = (await snapshot).map(item => getItem(item,current)).filter(item=>item.status!=='closed'||item.days>-15);
    const address = new URL(path,location.origin);
    const id = address.pathname.match(/^\/api\/contests\/(\d+)$/)?.[1];
    if (id) {
      const row = rows.find(item=>item.id===Number(id));
      if (!row) throw new Error('공고를 찾을 수 없습니다.');
      return row;
    }
    const p=address.searchParams;
    const terms=(p.get('q')||'').normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
    const results=rows.filter(row=>row.status===(p.get('status')||'open') &&
      (!p.get('tag')||row.tags.includes(p.get('tag'))) &&
      (!p.get('type')||row.types.includes(p.get('type'))) &&
      (p.get('education')!=='1'||row.education) &&
      terms.every(term=>[row.title,row.host,row.topic,...row.tags].join(' ').normalize('NFKC').toLowerCase().includes(term)));
    const order=p.get('sort')||'priority';
    results.sort((a,b)=>order==='latest' ? compare(b.announced,a.announced)||a.id-b.id :
      (order==='priority' ? tags.indexOf(a.primary)-tags.indexOf(b.primary) : 0) ||
      compare(a.end,b.end)||compare(a.time||'24:00',b.time||'24:00')||a.id-b.id);
    return {items:results,source:'snapshot'};
  };
})();
