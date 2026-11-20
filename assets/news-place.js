(() => {
const aliases = [
  [/삼성문화회관/, '삼성문화회관'],
  [/우석대학교/, '우석대학교'],
  [/전주대학교/, '전주대학교'],
  [/익산예술의전당/, '익산예술의전당'],
  [/전주역사박물관/, '전주역사박물관'],
  [/부안역사문화관/, '부안역사문화관'],
  [/전북대s*(?:박물관|삼성문화회관)/, '삼성문화회관'],
];
const roadAddress = /(?:^|\s)[가-힣\d·]+(?:로|길|번길)\s+\d+(?:-\d+)?\b/;
const room = /\s+(?:\d+\s*(?:층|호)|(?:건지|대공연|소공연|갤러리|필하모닉)홀|(?:대|소)공연장|기획전시실|상설전시실|전시실|강의실|대강당|야외(?:광장|공연장)|일원)(?:\s|$).*$/;
function representativeVenue(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  for (const [pattern, label] of aliases) if (pattern.test(value)) return label;
  if (/^온라인/.test(value)) return '온라인';
  const address = roadAddress.exec(value);
  if (address) {
    const suffix = value.slice(address.index + address[0].length).replace(/^[\s/,:·-]+/, '');
    const prefix = value.slice(0, address.index).trim();
    value = suffix || (/^(?:전북|전라북도|[가-힣]+[시군구읍면동])(?:\s|$)/.test(prefix) ? '' : prefix);
  }
  value = value.split(/\s*(?:\/|,|\+|\[|\()\s*/)[0].replace(room, '').trim();
  return value === '전시실' || value === '장소 미정' ? '' : value;
}

globalThis.jiniRepresentativeVenue = representativeVenue;
})();
