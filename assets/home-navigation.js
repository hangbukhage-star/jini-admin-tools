(() => {
  const categories = [...document.querySelectorAll('.tool-category')];
  const filterBox = document.querySelector('.jini-categories');
  const filters = [...filterBox.querySelectorAll('[data-category]')];
  const feature = document.querySelector('.jini-feature');
  const empty = document.querySelector('.jini-empty');
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

  const heading = document.querySelector('body > header h1');
  const subtitle = document.querySelector('body > header p');
  const homeHeading = [...heading.childNodes];
  const homeSubtitle = subtitle.textContent;
  const subtitleTail = document.createElement('span');
  subtitleTail.className = 'radar-subtitle-tail';
  subtitleTail.textContent = ' 내게 맞는 국내 공모전을 찾아보세요.';

  let selected = -1;

  function render() {
    const living = location.hash === '#living';
    const contests = location.hash === '#contests';
    const admin = !living && !contests;
    const active = living ? 1 : contests ? 3 : 0;
    heading.replaceChildren(...(contests ? ['지니의 공모전', document.createElement('br'), '레이더'] : homeHeading));
    subtitle.replaceChildren(...(contests ? ['AI 활용부터 행정업무 개선까지.', subtitleTail] : [homeSubtitle]));
    nav.forEach((link, index) => {
      if (index === active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.querySelector('.tool-list').setAttribute('aria-label', living ? '생활도구 목록' : '업무별 행정도구');
    filterBox.hidden = !admin;
    feature.hidden = !admin || selected !== -1;
    empty.hidden = !living;
    radar.hidden = !contests;
    if (contests && !radarFrame.hasAttribute('src')) radarFrame.src = radarFrame.dataset.src;
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

