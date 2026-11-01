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
