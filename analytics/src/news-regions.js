export const NEWS_REGIONS=['전주','군산','익산','정읍','남원','김제','완주','진안','무주','장수','임실','순창','고창','부안'];

// Venue names without a city in their name still have a fixed, known location.
const VENUES={
  전주:['한국소리문화의전당','덕진예술회관','우진문화공간','우진예술극장','국립무형유산원','전북예술회관','전북대학교삼성문화회관','전북도립국악원','전북특별자치도립국악원','한해랑아트홀','더바인홀','팔복예술공장','한국전통문화전당','기지제','오거리소극장','서신갤러리','뜻밖의미술관','삼천생활문화센터','효자생활문화센터','완산도서관','송천도서관','금암도서관','인후도서관','아중도서관','쪽구름도서관','건지도서관','연화정도서관','다가여행자도서관'],
  익산:['홀로스테이션'],완주:['전북도립미술관','전북특별자치도립미술관','삼례문화예술촌','복합문화지구누에'],남원:['국립민속국악원','광한루원'],부안:['수성당','매창테마관']
};
const compact=value=>String(value||'').replace(/ /g,'');
export function newsRegion(post){
  if(NEWS_REGIONS.includes(post.regionOverride))return post.regionOverride;
  const venue=compact(post.venue),title=String(post.title||'');
  return NEWS_REGIONS.find(region=>venue.includes(region))
    ||NEWS_REGIONS.find(region=>VENUES[region]?.some(name=>venue.includes(name)))
    ||NEWS_REGIONS.find(region=>title.includes(`[${region}]`)||title.includes(`(${region})`)||title.includes(`- ${region}`)||title.endsWith(`-${region}`))||'';
}

// Keep filtering in the database, before counts and pagination are calculated.
// All SQL literals here come from the fixed rules above, never request input.
export function newsRegionSQL(){
  const venue="replace(COALESCE(json_extract(data,'$.venue'),''),' ','')",title="COALESCE(json_extract(data,'$.title'),'')";
  const includes=(field,value)=>`instr(${field},'${value}')>0`;
  const rules=[...NEWS_REGIONS.map(region=>[includes(venue,region),region]),...NEWS_REGIONS.filter(region=>VENUES[region]).map(region=>[VENUES[region].map(name=>includes(venue,name)).join(' OR '),region]),...NEWS_REGIONS.map(region=>[[`[${region}]`,`(${region})`,`- ${region}`].map(name=>includes(title,name)).join(' OR ')+` OR substr(${title},-${region.length+1})='-${region}'`,region])];
  return `(CASE WHEN json_extract(data,'$.regionOverride') IN (${NEWS_REGIONS.map(region=>`'${region}'`).join(',')}) THEN json_extract(data,'$.regionOverride') ${rules.map(([condition,region])=>`WHEN ${condition} THEN '${region}'`).join(' ')} ELSE '' END)`;
}
