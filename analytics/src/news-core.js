export const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
export function publicURL(value, base) {
  try {
    const u = new URL(value, base);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port) return '';
    const h = u.hostname.toLowerCase();
    // Only public DNS names: block local/special addresses and IP literals.
    if (!h.includes('.') || /[\[\]:]/.test(h) || /^[\d.]+$/.test(h) || /\.(local|localhost|internal|test|invalid)$/.test(h)) return '';
    u.hash = '';
    return u.href;
  } catch { return ''; }
}
export function day(value) {
  const m = String(value || '').match(/(20\d{2})\s*[.년/-]\s*(\d{1,2})\s*[.월/-]\s*(\d{1,2})/);
  if (!m) return '';
  const out = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  const d = new Date(`${out}T00:00:00Z`);
  return Number.isFinite(+d) && d.toISOString().slice(0,10) === out ? out : '';
}
export function koreaToday(now = new Date()) { return new Date(+now + 9*3600000).toISOString().slice(0,10); }
export function horizon(now = new Date()) {
  const d = new Date(`${koreaToday(now)}T00:00:00Z`);
  const targetMonth = d.getUTCMonth() + 3;
  const last = new Date(Date.UTC(d.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(d.getUTCDate(), last)); d.setUTCMonth(targetMonth);
  return d.toISOString().slice(0,10);
}
export function recommendCategory(title, context='', source='') {
  if(source==='sori-exhibition')return {category:'전시',reason:'전시 전용 수집 사이트의 글입니다.',needsReview:false};
  const rules=[
    ['AI·디지털 교육',/인공지능|생성형\s*AI|AI\s*(?:교육|활용|강좌|특강|리터러시)|디지털\s*(?:배움|교육|문해)/i],
    ['평생·문화교육',/평생학습|평생교육|교육생\s*모집|수강생\s*모집|강좌\s*모집|수강\s*신청|문화예술교육|문화강좌|강좌|워크[숍샵]|강연|특강|교실|수강|양성|교육(?!극)|배우기|만들기|체험|독서모임|책놀이|읽어주기|세미나|포럼|심포지엄|학술대회|학술행사/],
    ['전시',/전시|展|갤러리/],
    ['공연',/공연|음악회|음악극|교육극|뮤지컬|콘서트|연주회|연극|오페라|발레|독주회|독창회|낭독회|인형극|국악|가무악/]
  ];
  for(const value of [clean(title),clean(context)])for(const [category,pattern] of rules){const match=value.match(pattern);if(match)return {category,reason:`‘${match[0]}’ 표현을 기준으로 추천했어요.`,needsReview:false};}
  if(source==='library')return {category:'평생·문화교육',reason:'도서관 프로그램으로 평생·문화교육을 추천했어요. 행사 성격을 확인해 주세요.',needsReview:true};
  if(['sori','ssac','nol-jeonbuk','culturePerform','kukak','naru','jjticket','wanju','woojin'].includes(source))return {category:'공연',reason:'공연 안내 사이트의 글입니다. 제목만으로 확실하지 않아 확인이 필요해요.',needsReview:true};
  return {category:'평생·문화교육',reason:'분류 단서가 부족해 평생·문화교육으로 두었어요. 원문을 보고 분류를 확인해 주세요.',needsReview:true};
}
export const category=(title,context='',source='')=>recommendCategory(title,context,source).category;

// Search only explicit monetary amounts. Ages, dates and discount percentages are not fees.
export function priceInfo(value) {
  let text=clean(value);const amounts=new Set();
  const add=number=>{if(Number.isSafeInteger(number)&&number>=0&&number<=100000000)amounts.add(number);};
  text=text.replace(/(\d+(?:\.\d+)?)\s*만\s*(?:(\d+(?:\.\d+)?)\s*천)?\s*원/g,(_,man,thousand)=>{add(Number(man)*10000+Number(thousand||0)*1000);return ' ';});
  text=text.replace(/(\d[\d,]*(?:\.\d+)?)\s*(천)?\s*원/g,(_,number,thousand)=>{add(Number(number.replace(/,/g,''))*(thousand?1000:1));return ' ';});
  for(const match of text.matchAll(/(?<![\d,])\d{1,3}(?:,\d{3})+(?![\d,])/g))add(Number(match[0].replace(/,/g,'')));
  if(/^\d+$/.test(text))add(Number(text));
  if(/무료(?!\s*(?:아님|아닙))|초대/i.test(value))add(0);
  const sorted=[...amounts].sort((a,b)=>a-b),paid=sorted.some(n=>n>0),free=sorted.includes(0);
  return {type:paid?(free?'mixed':'paid'):free?'free':/유료/.test(value)?'paid':'unknown',amounts:sorted};
}

export function venueGroup(value,title='',source='') {
  const venue=clean(value),compact=venue.replace(/\s/g,'');
  const known=[['전주한벽문화관','전주한벽문화관'],['전북대학교삼성문화회관','전북대학교 삼성문화회관'],['소리문화의전당','한국소리문화의전당'],['덕진예술회관','덕진예술회관'],['국립무형유산원','국립무형유산원'],['우진문화공간','우진문화공간'],['우진예술극장','우진문화공간'],['완주향토예술문화회관','완주향토예술문화회관'],['완주문화예술회관','완주문화예술회관'],['전북예술회관','전북예술회관'],['국립극장','국립극장'],['로컬플랫폼모이장','로컬플랫폼 모이장'],['전주완산벙커','전주완산벙커 더 스페이스']];
  for(const [match,name] of known)if(compact.includes(match))return name;
  const library=venue.match(/^([^()\n]*?도서관)/);if(library)return clean(library[1]);
  const short=venue.replace(/\([^)]*\)/g,'').replace(/\s*(?:지하\s*)?\d+층[\s\S]*$/,'').replace(/(회관|전당|센터|도서관|극장|아트홀|갤러리|문화공간|문화원|청사)\s+(?:대|소|중|야외)?(?:공연장|강당|회의실|강의실|로비|자료실)[\s\S]*$/,'$1').trim();
  if(source==='library'&&(!short||/^(?:지하|강당|배움기지|동아리실|문화강의실)/.test(short))){
    const branch=title.match(/^\[(완산|삼천|서신|평화|효자|송천|금암|인후|아중|쪽구름|건지|꽃심|한옥마을|서학예술마을|연화정|다가)\]/)?.[1];
    return branch?(branch==='꽃심'?'전주시립도서관 꽃심':branch+'도서관'):'';
  }
  if(/^(?:지하\s*)?(?:강당|회의실|강의실|로비|자료실|배움기지|동아리실)$/.test(short))return '';
  return short;
}
