import {clean,day,category} from './news-core.js';

// Public search used by the site's education finder; always restricted to Jeonbuk.
export async function digitalCourses(source,page=1,fetcher=fetch){
  const base='https://www.xn--2z1bw8k1pjz5ccumkb.kr';
  if(new URL(source.url).hostname!==new URL(base).hostname)throw new Error('디지털배움터 주소를 확인하세요.');
  const params=new URLSearchParams({supr_cd:'1',edu_type:'E',grp_se_yn:'N',sch_area_cd:'503',sch_signgu_cd:'',sch_edc_mthd_se_cd:'',sch_edc_bgn_dt:'',sch_edc_end_dt:'',sch_edc_crse_se_cd:'',sch_edc_plan_nm:'',sch_instrt_spts_nm:'',sch_oper_sttus_se_cd:'',sch_edc_trgter_ty_cd:'',sch_real_edc_plc:'',sch_edc_place_nm:'',page_no:String(page),page_size:'10'});
  const r=await fetcher(base+'/api/edc/req/list.do',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=utf-8','x-nia-header':'undefined','x-nia-token':'undefined',Referer:source.url},body:params,signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error(`전북 교육 검색 응답 오류 (${r.status})`);
  const result=await r.json();
  if(result.message!=='SEARCH_OK'||!Array.isArray(result.RK_RESULT))throw new Error('전북 교육 검색 결과를 확인하세요.');
  const items=result.RK_RESULT.filter(x=>x.area_cd==='503'&&!['05','06'].includes(x.oper_sttus_se_cd)).map(x=>{
    const url=base+'/edc/crse/req/dtl_step1.do?edc_plan_id='+encodeURIComponent(x.edc_plan_id);
    const venue=x.real_edc_plc_cd==='WR'?[x.real_edc_plc,x.real_edc_plc_dtl].filter(Boolean).join(' '):[x.edc_plc_adres,x.edc_plc_adres_dtl].filter(Boolean).join(' ');
    const title=clean(x.edc_plan_nm);
    return {url,hint:title,data:{title,category:category(title,clean(x.std_capa_nm),source.id),startDate:day(x.edc_bgn_dt),endDate:day(x.edc_end_dt),venue:clean(venue),time:'',price:'',audience:clean(x.edc_trgter_ty_nm),description:`교육방식: ${clean(x.edc_mthd_se_nm)}\n접수기간: ${clean(x.rcept_bgn_dt)} ~ ${clean(x.rcept_end_dt)}\n교육 일정 및 접수 가능 여부는 공식 안내에서 확인해 주세요.`,images:[],sourceName:source.name,link:url,cancelled:false}};
  });
  return {items,total:Number(result.RK_TOTAL)||0};
}
