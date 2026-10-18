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
  const rules=[
    ['세미나',/세미나|포럼|심포지엄|학술대회|학술행사/],
    ['문화강좌',/강좌|워크[숍샵]|강연|특강|교실|수강|양성|교육(?!극)|배우기|만들기|체험|독서모임|책놀이|읽어주기/],
    ['전시',/전시|展|갤러리/],
    ['공연',/공연|음악회|음악극|교육극|뮤지컬|콘서트|연주회|연극|오페라|발레|독주회|독창회|낭독회|인형극|국악|가무악/]
  ];
  for(const value of [clean(title),clean(context)])for(const [category,pattern] of rules){const match=value.match(pattern);if(match)return {category,reason:`‘${match[0]}’ 표현을 기준으로 추천했어요.`,needsReview:false};}
  if(source==='library')return {category:'문화강좌',reason:'도서관 프로그램으로 교육·강좌를 추천했어요. 행사 성격을 확인해 주세요.',needsReview:true};
  if(['sori','kukak','naru','jjticket','wanju'].includes(source))return {category:'공연',reason:'공연 안내 사이트의 글입니다. 제목만으로 확실하지 않아 확인이 필요해요.',needsReview:true};
  return {category:'기타 소식',reason:'분류할 단서가 부족해요. 원문을 보고 분류를 선택해 주세요.',needsReview:true};
}
export const category=(title,context='',source='')=>recommendCategory(title,context,source).category;
