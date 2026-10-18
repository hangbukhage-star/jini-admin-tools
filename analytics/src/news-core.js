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
export function category(title) {
  return /전시|展|갤러리/.test(title) ? '전시' : /세미나|포럼|심포지엄/.test(title) ? '세미나' : /교육극|음악극|뮤지컬|콘서트|연주회|연극|오페라|발레|독주회|독창회/.test(title) ? '공연' : /강좌|교육|워크숍|강연/.test(title) ? '문화강좌' : '공연';
}
