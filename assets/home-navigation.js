(() => {
  const categories = [...document.querySelectorAll('.tool-category')];
  const filterBox = document.querySelector('.jini-categories');
  const filters = [...filterBox.querySelectorAll('[data-category]')];
  const feature = document.querySelector('.jini-feature');
  const empty = document.querySelector('.jini-empty');
  const title = document.querySelector('#section-title');
  const caption = document.querySelector('#section-caption');
  const nav = [...document.querySelectorAll('.jini-nav a')];
  const radar = document.querySelector('#contest-radar-panel');
  const radarFrame = document.querySelector('#contest-radar-frame');
  let radarObserver;

  radarFrame.addEventListener('load', () => {
    radarObserver?.disconnect();
    const body = radarFrame.contentDocument?.body;
    if (!body) return;
    const fit = () => {
      const height = Math.ceil(body.getBoundingClientRect().height);
      if (height > 0) radarFrame.style.height = height + 'px';
    };
    radarObserver = new ResizeObserver(fit);
    radarObserver.observe(body);
    fit();
  });

  let selected = -1;

  function render() {
    const living = location.hash === '#living';
    const contests = location.hash === '#contests';
    const admin = !living && !contests;
    const active = living ? 1 : contests ? 3 : 0;
    nav.forEach((link, index) => {
      if (index === active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    title.textContent = nav[active].textContent;
    caption.textContent = living ? '일상에 필요한 도구를 모아 보는 공간입니다.'
      : contests ? '공모전 소식을 모아 볼 공간입니다.'
      : '학교 업무에 필요한 프로그램을 업무별로 찾을 수 있어요.';
    document.querySelector('.tool-list').setAttribute('aria-label', living ? '생활도구 목록' : '업무별 행정도구');
    filterBox.hidden = !admin;
    feature.hidden = !admin || selected !== -1;
    empty.hidden = !living;
    title.parentElement.hidden = contests;
    radar.hidden = !contests;
    if (contests && !radarFrame.hasAttribute('src')) radarFrame.src = radarFrame.dataset.src;
    empty.textContent = living ? '등록된 생활도구가 없습니다.' : '등록된 공모전 소식이 없습니다.';
    filters.forEach((button, index) => button.setAttribute('aria-pressed', String(index === selected)));
    categories.forEach((category, index) => {
      category.hidden = !admin || (selected !== -1 && selected !== index);
    });
  }

  filters.forEach((button, index) => button.addEventListener('click', () => {
    selected = index;
    render();
  }));
  document.querySelector('.jini-reset').addEventListener('click', () => {
    selected = -1;
    render();
  });
  document.querySelector('[data-feature-launch]').addEventListener('click', event => {
    const original = document.querySelector('.work-plan-card [data-track-tool]');
    if (!original || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    original.click();
  });
  window.addEventListener('hashchange', () => {
    selected = -1;
    render();
  });
  render();
})();

