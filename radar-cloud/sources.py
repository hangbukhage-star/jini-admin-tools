from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from datetime import date
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, parse_qs
from urllib.request import Request, urlopen
import json
import os
import re
import ssl
import subprocess
from urllib.error import URLError

from radar import ROOT, connect, dump, now, save

MODU = 'https://modu.go.kr/front/epilogue/epilogueBbsList.do'
PORTAL = 'https://gcontest.co.kr/front/index'
ALLCON_BOARD = 'https://www.all-con.co.kr/page/ajax.contest_list.php'
ALLCON_FORM = 't=1&rows=25&page=1&sortorder=asc'
DAY = r"(?:(?:20)?([2-9]\d)\s*[.년/-]\s*)?(1[0-2]|0?[1-9])\s*[.월/-]\s*(3[01]|[12]\d|0?[1-9])(?!\d)\s*[.일]?\s*(?:\([월화수목금토일]\))?"
PERIOD = re.compile(DAY + r'\s*[~∼～–]\s*(?:[’\x27]\s*)?' + DAY)
CLOCK = re.compile(r'\s*\*?\s*(?:(\d{1,2}):(\d{2})|(\d{1,2})시|(?:까지\s*)?(자정))')
ELIGIBILITY = re.compile(r'참\s*가\s*(?:자\s*격|대\s*상)|응\s*모\s*자\s*격|지\s*원\s*자\s*격|공\s*모\s*대\s*상|□\s*대상\s*:')

class Document(HTMLParser):
    blocks = {'p','div','li','dd','dt','h1','h2','h3','h4','br','tr','section','article'}

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.parts, self.links, self.anchor = [], [], None
        self.ignore = 0
        self.raw = html
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag in ('script','style'):
            self.ignore += 1
        attrs = dict(attrs)
        if tag == 'a' and attrs.get('href'):
            self.anchor = [attrs['href'], []]
        if tag in self.blocks:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script','style'):
            self.ignore = max(0, self.ignore - 1)
        if tag == 'a' and self.anchor:
            href, text = self.anchor
            self.links.append((href, ' '.join(''.join(text).split())))
            self.anchor = None
        if tag in self.blocks:
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.ignore:
            self.parts.append(data)
            if self.anchor:
                self.anchor[1].append(data)

    @property
    def lines(self):
        return [' '.join(s.split()) for s in ''.join(self.parts).splitlines() if s.strip()]

def fetch(address):
    form = ALLCON_FORM if address == ALLCON_BOARD else ''
    request = Request(address, data=form.encode() if form else None,
                      headers={'User-Agent':'JiniContestRadar/1.0', 'Accept':'application/json' if form else 'text/html'})
    try:
        with urlopen(request, timeout=10) as response:
            data = response.read(2_000_001)
            encoding = response.headers.get_content_charset() or 'utf-8'
    except URLError as error:
        if os.name != 'nt' or not isinstance(error.reason, ssl.SSLCertVerificationError) or urlsplit(address).hostname != 'www.all-con.co.kr':
            raise
        # Windows curl uses the OS certificate store. TLS verification remains enabled.
        options = ['--data',form] if form else []
        data = subprocess.run(['curl.exe','--fail','--silent','--show-error','--max-time','10',
            '--max-filesize','2000000','--proto','=https',*options,'--',address],
            capture_output=True,check=True,timeout=12).stdout
        encoding = 'utf-8'
    if len(data) > 2_000_000:
        raise ValueError('문서가 수집 크기 제한을 초과했습니다.')
    return Document(data.decode(encoding, errors='replace'))

def new_portal_candidates(board, fetcher, mode):
    doc = fetcher(board)
    if mode == 'allcon':
        for row in json.loads(doc.raw.lstrip('\ufeff')).get('rows',[]):
            ident = str(row.get('cl_srl',''))
            title = ' '.join(Document(row.get('cl_title','')).lines)
            if not re.fullmatch(r'[0-9]+',ident) or not title:
                continue
            item = dict(title=title[:300],host=str(row.get('cl_host','')).strip().rstrip('…'),
                        candidateUrl=urljoin(board,'/view/contest/'+ident),
                        reviewReason='포털 후보 · 공식 주최기관 공고 확인 필요')
            dates = PERIOD.search(str(row.get('cl_date','')))
            if dates and dates[1] and dates[4]:
                try:
                    item['start'] = str(date(2000+int(dates[1]),int(dates[2]),int(dates[3])))
                    item['end'] = str(date(2000+int(dates[4]),int(dates[5]),int(dates[6])))
                except ValueError:
                    pass
            yield item
        return
    links = doc.links
    if mode == 'thinkgood':
        for chunk in re.findall(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',doc.raw,re.S):
            try:
                data = json.loads(chunk)
            except ValueError:
                continue
            if isinstance(data,dict) and data.get('@type') == 'ItemList':
                links.extend((x.get('url',''),x.get('name','')) for x in data.get('itemListElement',[]))
    seen = set()
    for href, label in links:
        if not label or not re.search(r'공모|경진|대회|콘테스트|해커톤|챌린지',label):
            continue
        p = urlsplit(urljoin(board,href))
        if (p.hostname or '').removeprefix('www.') != (urlsplit(board).hostname or '').removeprefix('www.'):
            continue
        params = parse_qs(p.query)
        if mode == 'thinkgood':
            ident = params.get('contest_pk',[''])[0] if p.path.endswith('/contest/view.do') else ''
            path = '/thinkgood/user/contest/view.do?contest_pk='+ident
        elif mode == 'wevity':
            ident = params.get('ix',[''])[0] if params.get('gbn',[''])[0] in ('view','viewok') else ''
            path = '/?c=find&s=1&gbn=view&ix='+ident
        if not ident.isascii() or not ident.isdecimal() or ident in seen:
            continue
        seen.add(ident)
        yield dict(title=label[:300],candidateUrl=urljoin(board,path),reviewReason='포털 후보 · 공식 주최기관 공고 확인 필요')
        if len(seen) == 25:
            break

def enrich_portal(item, fetcher):
    doc = fetcher(item['candidateUrl'])
    match = re.search(r'<div class="tit">주최</div>\s*<div class="txt">(.*?)</div>|'
                      r'<span class="tit">주최/주관</span>(.*?)</li>',doc.raw,re.S)
    if match:
        organizer = ' '.join(Document(match[1] or match[2]).lines).split(' / ',1)[0]
        if organizer:
            item['host'] = organizer
    try:
        start, end, _, _ = extract_schedule(doc)
    except ValueError:
        return
    item['start'],item['end'] = start,end

def discovered(board, fetcher, portal=False):
    source = fetcher(board)
    records = []
    seen = set()
    for href, label in source.links:
        target = urljoin(board, href)
        p = urlsplit(target)
        if p.hostname != urlsplit(board).hostname:
            continue
        if portal:
            match = re.fullmatch(r'/front/(?:m/)?comp/view/(\d+)', p.path)
            if not match or '공모' not in label:
                continue
            target = urljoin(board, '/front/m/comp/view/' + match[1])
        else:
            number = parse_qs(p.query).get('bbs_id', [''])[0]
            if not p.path.endswith('/epilogueBbsViewPage.do') or not re.fullmatch('[a-f0-9]{32}', number):
                continue
            target = urljoin(board, p.path + '?bbs_id=' + number)
        if target in seen or not label:
            continue
        seen.add(target)
        host = re.search(r'[【〖]([^】〗]+)[】〗]', label)
        title = re.sub(r'^.*?[】〗]\s*', '', label) if host else label
        records.append(dict(title=title[:300],host=host[1] if host else '',
                            candidateUrl=target, reviewReason='공식 본문·첨부 및 분류 확인 필요'))
    if not records:
        raise ValueError('공고 링크를 찾을 수 없습니다. 목록 구조를 확인해 주세요.')
    return records

def extract_schedule(document):
    lines = document.lines
    for index, line in enumerate(lines):
        if not re.search(r'접\s*수\s*기\s*간|공\s*모\s*기\s*간|□\s*접수\s*:', line):
            continue
        if ('~' in line or '∼' in line or '～' in line) and not PERIOD.search(line):
            continue
        value = line if PERIOD.search(line) else ' '.join(lines[index:index+2])
        match = PERIOD.search(value)
        if not match or not match[1]:
            continue
        start = date(2000+int(match[1]), int(match[2]), int(match[3]))
        end = date(2000+int(match[4] or match[1]), int(match[5]), int(match[6]))
        if end < start:
            continue
        time = CLOCK.match(value[match.end():])
        clock = ''
        if time:
            clock = '24:00' if time[4] else f'{int(time[1] or time[3]):02d}:{time[2] or "00"}'
        return str(start), str(end), clock, value[:250]
    raise ValueError('본문에서 명시적인 접수기간을 읽지 못했습니다.')

def tracked(base_url, fetcher):
    with connect() as db:
        items = [json.loads(r['data']) for r in db.execute('SELECT data FROM contest WHERE published=1 AND id NOT IN (SELECT id FROM removed)')]
    items = [item for item in items if urlsplit(item['url']).hostname == urlsplit(base_url).hostname]
    output, problems = [], []
    for item in items:
        try:
            doc = fetcher(item['url'])
            eligibility = extract_eligibility(doc)
            start, end, clock, evidence = official_schedule(item['url'], doc)
            if start[:4] != item['start'][:4]:
                raise ValueError('접수 시작 연도가 변경되어 회차 확인이 필요합니다.')
            signature = re.sub(r'\s+', '', eligibility[:120])
            previous = item['eligibilityEvidence'].partition(' | 본문 확인: ')[2]
            if previous and previous != signature:
                output.append((dict(title=item['title']+' — 참가 자격 확인',host=item['host'],
                    candidateUrl=item['url']+'#eligibility-review', reviewReason='원문 참가 자격 구간 변경: '+eligibility[:250]), False))
                problems.append(item['title'] + ' · 참가 자격 변경 검토')
                continue
            if not previous:
                reviewed = item['eligibilityEvidence'].partition(' | 자동 본문: ')[0]
                item['eligibilityEvidence'] = reviewed + ' | 본문 확인: ' + signature
            if not clock and item['time'] and item['end'] == end:
                clock = item['time']
                evidence = item['deadlineEvidence']
            item['_expectedChecked'] = item['checked']
            item.update(start=start,end=end,time=clock,deadlineEvidence=evidence)
            output.append((item, True))
        except Exception as error:
            problems.append(item['title'] + ' · ' + str(error))
    return output, problems

def official_schedule(address, document):
    if urlsplit(address).hostname == 'koreaaiart.com':
        # This organizer renders the date range from its inline page data.
        entry = re.search(r"parts:\s*\[([^\]]+)\],\s*ko:\s*\['접수 기간'", document.raw)
        if entry:
            rendered = re.sub(r"['\x22,]|\([A-Za-z]+\)", '', entry[1]).replace('—', '~')
            return extract_schedule(Document('<p>접수 기간 ' + rendered + '</p>'))
    return extract_schedule(document)

def extract_eligibility(document):
    lines = document.lines
    for index, line in enumerate(lines):
        match = ELIGIBILITY.search(line)
        if match:
            value = line[match.end():].strip(' :()')
            if value:
                return value
            if index + 1 < len(lines):
                return lines[index + 1]
    raise ValueError('본문에서 참가 자격을 읽지 못했습니다.')

def configured_sources():
    return {
        'modu': ('소통24', '전자정부 공모전 게시판 · 신규 발견 및 공개 공고 재확인', MODU, 'board'),
        'portal': ('지콘테스트', '공개 포털 목록 · 후보 발견', PORTAL, 'portal'),
        'thinkgood': ('씽굿', '공개 목록의 구조화 데이터와 상세 · 후보 발견', 'https://www.thinkcontest.com/thinkgood/index.do', 'thinkgood'),
        'wevity': ('위비티', '공개 공모전 목록과 상세 · 후보 발견', 'https://www.wevity.com/?c=find', 'wevity'),
        'allcon': ('올콘', '공개 공모전 목록의 JSON과 상세 · 후보 발견', ALLCON_BOARD, 'allcon'),
        'gyeongsan': ('경산시 AI 미디어 콘텐츠', '공식 공모요강 · 공개 공고 재확인', 'https://aiart.gbgs.art/guide', 'tracked'),
        'kinfa': ('서민금융진흥원', '공식 공지 · 공개 공고 재확인', 'https://www.kinfa.or.kr/notificationPromotion/noticeDetail.do?seq=35397', 'tracked'),
        'keris': ('한국교육학술정보원', '공식 공지 · 공개 공고 재확인', 'https://www.keris.or.kr/main/na/ntt/selectNttInfo.do?mi=1051&nttSn=44014', 'tracked'),
        'nyj': ('남양주시', '공식 고시공고 · 공개 공고 재확인', 'https://www.nyj.go.kr/www/selectEminwonWebView.do?key=2492&pk=89539', 'tracked'),
        'creative-art': ('한국창조미술협회', '공식 공모 사이트 · 공개 공고 재확인', 'https://koreaaiart.com/', 'tracked'),
    }

def check_source(config, fetcher):
    name, method, source_url, mode = config
    result = dict(name=name,method=method,url=source_url,checked=now().isoformat(),counts={})
    batch, errors = [], []
    if mode in ('thinkgood','wevity','allcon'):
        try:
            candidates = list(new_portal_candidates(source_url,fetcher,mode))
            if not candidates:
                raise ValueError('공개 목록에서 공모전 링크를 찾지 못했습니다.')
            with ThreadPoolExecutor(max_workers=3) as details:
                tasks = [details.submit(enrich_portal,item,fetcher) for item in candidates]
                for item,task in zip(candidates,tasks):
                    try:
                        task.result()
                    except Exception as error:
                        errors.append(item['title']+' · 상세 읽기 실패 '+str(error))
                    batch.append((item,False))
        except Exception as error:
            errors.append(str(error))
    elif mode != 'tracked':
        try:
            for item in discovered(source_url, fetcher, mode == 'portal'):
                if mode == 'board':
                    try:
                        detail = fetcher(item['candidateUrl'])
                        item['url'] = item['candidateUrl']
                        item['attachments'] = [{'label':label, 'url':urljoin(source_url, link)}
                            for link, label in detail.links if label and 'downloadEpilogueAtchmnfl.do?' in link]
                        start, end, clock, evidence = extract_schedule(detail)
                        item.update(start=start,end=end,time=clock,deadlineEvidence=evidence)
                        item['eligibilityEvidence'] = extract_eligibility(detail)
                    except Exception as error:
                        item['reviewReason'] += ' · ' + str(error)
                batch.append((item, False))
        except Exception as error:
            errors.append(str(error))
    if mode in ('board','tracked'):
        updates, problems = tracked(source_url, fetcher)
        batch.extend(updates)
        errors.extend(problems)
    result['status'] = '일부 성공' if errors and batch else '실패' if errors else '성공'
    result['error'] = ' / '.join(errors)
    return result, batch

def collect(fetcher=fetch, sources=None, scheduled=False):
    started = now()
    day = started.date().isoformat()
    configs = configured_sources() if sources is None else sources
    if scheduled:
        with connect() as db:
            claim = db.execute('INSERT OR IGNORE INTO runs VALUES (?,?)', (day, dump({
                'started':started.isoformat(),'mode':'예약','status':'실행 중'})))
            if not claim.rowcount:
                return {'status':'오늘 예약 실행 기록 있음'}
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = {key:pool.submit(copy_context().run, check_source, config, fetcher)
                for key,config in configs.items()}
        results = {}
        for key, job in jobs.items():
            result, batch = job.result()
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                prior = db.execute('SELECT data FROM source WHERE key=?', (key,)).fetchone()
                result['lastSuccess'] = result['checked'] if batch or not result['error'] else (
                    json.loads(prior['data']).get('lastSuccess') if prior else None)
                for item, publish in batch:
                    try:
                        _, outcome = save(db, item, publish, automatic=True)
                        label = ('public_' if publish else 'candidate_') + outcome
                        result['counts'][label] = result['counts'].get(label, 0) + 1
                    except ValueError as error:
                        result['error'] += (' / ' if result['error'] else '') + str(error)
                        result['status'] = '일부 성공'
                db.execute('INSERT OR REPLACE INTO source VALUES (?,?)', (key,dump(result)))
                results[key] = result
    report = {'started':started.isoformat(),'finished':now().isoformat(),
              'mode':'예약' if scheduled else '수동','status':'완료','sources':results}
    with connect() as db:
        key = day if scheduled else started.isoformat()
        db.execute('INSERT OR REPLACE INTO runs VALUES (?,?)', (key,dump(report)))
    return report
