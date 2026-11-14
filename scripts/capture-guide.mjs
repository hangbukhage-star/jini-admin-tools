#!/usr/bin/env node
/**
 * Recapture the education work plan guide screens with headless Chrome.
 * Run from the repository root: node scripts/capture-guide.mjs
 * Optional: GUIDE_SITE_URL=https://... CHROME_PATH=... node scripts/capture-guide.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const baseUrl = (process.env.GUIDE_SITE_URL || 'https://jini-admin-tools.vercel.app').replace(/\/$/, '');
const outputDir = path.resolve(process.cwd(), 'public/guide');
const appUrl = `${baseUrl}/%EA%B5%90%EC%9C%A1%EA%B3%B5%EB%AC%B4%EC%A7%81%EA%B7%BC%EB%AC%B4%EA%B3%84%ED%9A%8D%ED%91%9C/index.html`;
const width = 1440;
const height = 1100;
const port = 9327;
const profileDir = path.join(os.tmpdir(), `jini-guide-${process.pid}`);
const browserPath = process.env.CHROME_PATH || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => process.platform === 'win32' && requireExists(p));

function requireExists(file) {
  try {
    return process.getBuiltinModule('node:fs').existsSync(file);
  } catch {
    return false;
  }
}

if (!browserPath) {
  throw new Error('Chrome 또는 Edge를 찾을 수 없습니다. CHROME_PATH 환경 변수로 브라우저 경로를 지정해 주세요.');
}

let browser;
let socket;
try {
  await mkdir(outputDir, { recursive: true });
  browser = spawn(browserPath, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });

  let version;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      version = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json());
      break;
    } catch {
      await delay(250);
    }
  }
  if (!version) throw new Error('브라우저 디버깅 포트에 연결하지 못했습니다.');

  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  const target = targets.find(item => item.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result?.value;
  };
  const waitForPage = async (ms = 1000) => {
    await evaluate('document.fonts.ready');
    await delay(ms);
  };
  const capture = async (filename, marks, scrollSelector) => {
    if (scrollSelector) {
      await evaluate(`document.querySelector(${JSON.stringify(scrollSelector)})?.scrollIntoView({block:'center', inline:'nearest'})`);
    }
    await evaluate(`(() => {
      document.querySelectorAll('[data-guide-overlay]').forEach(node => node.remove());
      const selectors = ${JSON.stringify(marks)};
      const labels = ['①','②','③'];
      selectors.forEach((selector,index) => {
        const target = document.querySelector(selector);
        if (!target) throw new Error('캡처 표시 대상을 찾지 못했습니다: ' + selector);
        const r = target.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) throw new Error('캡처 표시 대상이 화면에 보이지 않습니다: ' + selector);
        const box = document.createElement('div');
        box.dataset.guideOverlay = 'true';
        Object.assign(box.style, {position:'fixed',left:(r.left-4)+'px',top:(r.top-4)+'px',width:(r.width+8)+'px',height:(r.height+8)+'px',border:'3px solid #e11d48',borderRadius:'9px',boxSizing:'border-box',zIndex:'2147483647',pointerEvents:'none',boxShadow:'0 0 0 2px rgba(255,255,255,.94)'});
        const badge = document.createElement('span');
        badge.textContent = labels[index];
        Object.assign(badge.style, {position:'absolute',left:'-15px',top:'-17px',width:'33px',height:'33px',borderRadius:'50%',background:'#e11d48',color:'#fff',border:'2px solid #fff',boxShadow:'0 2px 7px rgba(0,0,0,.25)',display:'grid',placeItems:'center',font:'700 18px/1 sans-serif'});
        box.append(badge);
        document.documentElement.append(box);
      });
    })()`);
    await delay(180);
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(outputDir, filename), Buffer.from(data, 'base64'));
    await evaluate(`document.querySelectorAll('[data-guide-overlay]').forEach(node => node.remove())`);
  };
  const fill = async (selector, value) => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('입력칸을 찾지 못했습니다: ${selector}');
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
    return el.value;
  })()`);
  const click = async selector => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('버튼을 찾지 못했습니다: ${selector}');
    el.click();
  })()`);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  // 01: Begin at the actual homepage and point to the program launch button.
  await send('Page.navigate', { url: baseUrl });
  await waitForPage(2200);
  await capture('01_첫화면.png', ['a.work-plan-button']);

  // Click through to the actual program as a first-time visitor would.
  // The live homepage opens app links in a new tab. Keep this scripted tour in
  // one tab while still using the visible launch control.
  await evaluate(`document.querySelector('a.work-plan-button').target = '_self'`);
  await click('a.work-plan-button');
  await waitForPage(2600);

  // 02: Enter the school and employee information used by the later examples.
  await fill('#workerForm [name="organization"]', '한솔초등학교');
  await fill('#workerForm [name="job"]', '조리실무사');
  await fill('#workerForm [name="name"]', '홍길동');
  await fill('#workerForm [name="currentWorkDate"]', '2026-03-01');
  await fill('#workerForm [name="dailyHours"]', '8');
  await waitForPage(800);
  await capture('02_근로자정보.png', [
    '#workerForm [name="organization"]',
    '#workerForm [name="job"]',
    '#workerForm [name="name"]',
  ], '#workerForm');

  // 03: Set the institution and the sample summer vacation/work period.
  await click('[data-tab="settings"]');
  await waitForPage(700);
  await fill('[data-panel="settings"] #organization', '한솔초등학교');
  await fill('[data-list="vacations"][data-index="0"][data-field="start"]', '2026-07-20');
  await fill('[data-list="vacations"][data-index="0"][data-field="end"]', '2026-08-16');
  await click('[data-action="add-work-range"]');
  await waitForPage(500);
  await evaluate(`(() => {
    const select = document.querySelector('[data-list="workRanges"][data-field="vacationId"]');
    if (!select) throw new Error('방학을 연결하는 선택칸을 찾지 못했습니다.');
    select.value = [...select.options].find(option => option.value)?.value || '';
    select.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await fill('[data-list="workRanges"][data-field="start"]', '2026-07-20');
  await fill('[data-list="workRanges"][data-field="end"]', '2026-07-31');
  await waitForPage(700);
  await capture('03_방학공휴일.png', [
    '[data-panel="settings"] #organization',
    '#vacationList .stack-item:first-child',
    '#workRangeList .stack-item',
  ], '[data-panel="settings"] #organization');

  // 04: Apply the settings, choose a kind of calendar entry, and tap one date.
  await click('[data-action="go-calendar"]');
  await waitForPage(900);
  await click('[data-tab="calendar"]');
  await waitForPage(700);
  await fill('#calendarMode', 'work');
  await fill('#calendarReason', '방학 중 급식');
  await evaluate(`document.querySelector('[data-date="2026-07-20"]')?.click()`);
  await waitForPage(800);
  await capture('04_달력입력.png', [
    '#calendarMode',
    '#calendarReason',
    '[data-date="2026-07-20"]',
  ], '[data-date="2026-07-20"]');

  // 05: Review the calculated annual summary and choose an output format.
  await click('[data-tab="documents"]');
  await waitForPage(1200);
  await capture('05_산출표계획서.png', [
    '[data-panel="documents"] [data-action="excel-current"]',
    '[data-panel="documents"] [data-action="print-current"]',
  ], '[data-panel="documents"] .document-toolbar');

  // 06: Open the document preview and point to the browser PDF/print action.
  await click('[data-panel="documents"] [data-action="print-current"]');
  await waitForPage(1000);
  await capture('06_PDF저장.png', ['[data-action="do-print"]']);

  console.log(`Saved six guide screenshots to ${outputDir}`);
} finally {
  socket?.close();
  browser?.kill();
  await delay(300);
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

