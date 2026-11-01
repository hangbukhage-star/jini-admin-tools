import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';

test('공연·전시는 카드, 교육은 게시판, 전체는 두 영역으로 표시한다',()=>{
  const {document}=parseHTML('<html><body><section id="list"></section></body></html>');
  const window={};vm.runInNewContext(readFileSync(new URL('../../assets/news-common.js',import.meta.url),'utf8'),{window,document,URL,fetch});
  const posts=['공연','전시','평생·문화교육','AI·디지털 교육'].map((category,i)=>({id:String(i),category,title:category+' 소식',region:'전주',venueGroup:'한국소리문화의전당',images:['https://example.org/poster.jpg'],reactions:{like:1,dislike:2}}));
  const list=document.querySelector('#list');
  for(const post of posts){
    window.JiniNews.renderListing(list,[post],post.category);
    const cards=['공연','전시'].includes(post.category);
    assert.equal(list.querySelectorAll('.news-card').length,cards?1:0);
    assert.equal(list.querySelectorAll('img').length,cards?1:0);
    assert(list.querySelector('a').href.includes('post='+post.id));
    assert(list.textContent.includes('전주'));assert.equal(list.querySelectorAll('.news-reaction-badge').length,2);
  }
  window.JiniNews.renderListing(list,posts,'');
  assert.equal(list.querySelectorAll('.news-list-section').length,2);
  assert.equal(list.querySelectorAll('.news-card').length,2);
  assert.equal(list.querySelectorAll('.news-board-list .news-row').length,2);
  window.JiniNews.renderListing(list,[],'평생·문화교육');assert(list.querySelector('.news-empty'));
});

test('게시판 로그인 성공 후 삭제 버튼을 보이며 확인 취소·로그아웃·삭제 실패를 처리한다',async()=>{
  const {document}=parseHTML(readFileSync(new URL('../../news/index.html',import.meta.url),'utf8'));
  for(const select of document.querySelectorAll('select'))Object.defineProperty(select,'value',{configurable:true,writable:true,value:''});
  for(const dialog of document.querySelectorAll('dialog')){dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new document.defaultView.Event('close'));};}
  const window={},context={window,document,URL,URLSearchParams,fetch,location:{search:'',pathname:'/news/'},history:{replaceState(){}},confirm:()=>false};
  vm.runInNewContext(readFileSync(new URL('../../assets/news-common.js',import.meta.url),'utf8'),context);
  let failLogin=false,failDelete=false,deleteCount=0,removed=false;
  window.JiniNews.api=async(path,options={})=>{
    if(path==='/news/admin/session'){if(failLogin)throw Error('비밀번호 오류');assert.equal(options.headers.Authorization,'Bearer test-password');return {ok:true};}
    if(path==='/news/admin/bulk'){deleteCount++;if(failDelete)throw Error('삭제 실패');assert.deepEqual(JSON.parse(options.body),{action:'delete',ids:['one']});removed=true;return {ok:true};}
    if(path.startsWith('/news/venues'))return {venues:[]};
    return {posts:removed?[]:[{id:'one',title:'확인할 공연',category:'공연',venue:'한국소리문화의전당',region:'전주'}],total:removed?0:1,hasMore:false};
  };
  vm.runInNewContext(readFileSync(new URL('../../assets/news-board.js',import.meta.url),'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(document.querySelectorAll('.news-delete').length,0);
  const submitter={disabled:false},form=document.querySelector('#quick-admin-form'),key=document.querySelector('#quick-admin-key');
  failLogin=true;key.value='wrong';await form.onsubmit({preventDefault(){},submitter});assert.equal(document.querySelectorAll('.news-delete').length,0);assert.equal(key.value,'');
  failLogin=false;key.value='test-password';await form.onsubmit({preventDefault(){},submitter});assert.equal(document.querySelectorAll('.news-delete').length,1);assert.equal(key.value,'');assert(!document.querySelector('a .news-delete'));
  await document.querySelector('.news-delete').onclick();assert.equal(deleteCount,0);
  context.confirm=()=>true;failDelete=true;await document.querySelector('.news-delete').onclick();assert.equal(deleteCount,1);assert(document.querySelector('.news-row'));assert.equal(document.querySelector('#status').textContent,'삭제 실패');
  failDelete=false;await document.querySelector('.news-delete').onclick();assert.equal(deleteCount,2);assert(!document.querySelector('.news-row'));assert(document.querySelector('#status').textContent.includes('삭제함으로 옮겼습니다'));
  document.querySelector('#quick-admin').onclick();assert.equal(document.querySelectorAll('.news-delete').length,0);
});
