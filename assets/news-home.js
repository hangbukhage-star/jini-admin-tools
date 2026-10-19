(()=>{
  const list=document.querySelector('#home-news-list');if(!list)return;
  async function load(){
  try{
    const {posts}=await window.JiniNews.api('/news?limit=3');list.replaceChildren();
    if(!posts.length)list.append(window.JiniNews.el('p','새로운 문화 소식을 준비하고 있어요.','news-empty'));
    else posts.forEach((p,index)=>list.append(window.JiniNews.row(p,index)));
  }catch{list.textContent='문화 소식 게시판을 준비하고 있어요.';list.className='news-empty';}
  }
  load();window.addEventListener('pageshow',event=>{if(event.persisted)load();});
})();
