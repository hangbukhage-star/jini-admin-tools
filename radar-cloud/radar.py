import argparse
from contextlib import closing, contextmanager
from contextvars import ContextVar
from datetime import datetime, date, time, timedelta, timezone
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import sqlite3
from threading import Event, Thread
from urllib.parse import urlsplit, parse_qs, urlencode
import unicodedata

ROOT = Path(__file__).resolve().parent
DB_PATH = ContextVar('radar_database_path', default=None)
KST = timezone(timedelta(hours=9), "Asia/Seoul")
TAGS = ('AI 활용', '행정업무', '국민 누구나 참여')
TYPES = ('사례', '아이디어', '슬로건', '영상', '이미지', '앱', '웹서비스', '기타')
DATES = ('announced', 'start', 'end', 'time')
TEXT = ('title', 'host', 'eligibility', 'topic', 'format', 'prize', 'number', 'edition',
        'eligibilityEvidence', 'deadlineEvidence', 'reviewReason')
SCHEMA = """
CREATE TABLE IF NOT EXISTS contest (id INTEGER PRIMARY KEY, published INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS alias (key TEXT PRIMARY KEY, id INTEGER NOT NULL REFERENCES contest);
CREATE TABLE IF NOT EXISTS history (id INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source (key TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (day TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS removed (id INTEGER PRIMARY KEY REFERENCES contest, at TEXT NOT NULL);
"""

def now():
    return datetime.now(KST)

@contextmanager
def connect():
    path = Path(DB_PATH.get() or os.environ.get('RADAR_DB', ROOT / 'data' / 'radar.sqlite3'))
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path, timeout=20)) as db:
        db.row_factory = sqlite3.Row
        db.executescript(SCHEMA)
        with db:
            yield db

def dump(value):
    return json.dumps(value, ensure_ascii=False)

def url(value):
    if not value:
        return ''
    p = urlsplit(value)
    if p.scheme not in ('https', 'http') or not p.hostname or p.username or re.search(r'[\s\\]', value):
        raise ValueError('공식 링크는 올바른 HTTP(S) URL이어야 합니다.')
    return value

def clean(raw):
    item = {key: str(raw.get(key) or '').strip()[:8000] for key in TEXT + DATES}
    for key in DATES[:3]:
        if item[key] and date.fromisoformat(item[key]).isoformat() != item[key]:
            raise ValueError('날짜 형식은 YYYY-MM-DD입니다.')
    if item['start'] and item['end'] and item['start'] > item['end']:
        raise ValueError('접수기간을 확인해 주세요.')
    if item['time'] and item['time'] != '24:00' and not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', item['time']):
        raise ValueError('시각 형식은 HH:MM입니다.')
    for key in ('url', 'candidateUrl', 'correctionUrl'):
        item[key] = url(raw.get(key))
    item['attachments'] = [{'label': str(a['label'])[:300], 'url': url(a['url'])}
                           for a in raw.get('attachments', []) if a.get('url')]
    item['tags'] = [tag for tag in TAGS if tag in raw.get('tags', [])]
    item['types'] = [kind for kind in TYPES if kind in raw.get('types', [])]
    item['education'] = bool(raw.get('education')) and TAGS[1] in item['tags']
    item['checked'] = now().isoformat(timespec='seconds')
    if not item['title']:
        raise ValueError('제목을 입력해 주세요.')
    return item

def normalized(s):
    return re.sub(r'[\W_]+', '', unicodedata.normalize('NFKC', s).casefold())

def aliases(item):
    keys = []
    for field in ('url', 'candidateUrl'):
        if item[field]:
            p = urlsplit(item[field])
            params = [(k, v) for k, values in sorted(parse_qs(p.query).items())
                      if not k.startswith('utm_') for v in sorted(values)]
            identity = 'url:' + p.netloc.lower() + p.path.rstrip('/') + '?' + urlencode(params)
            if p.fragment == 'eligibility-review':
                identity += '#' + p.fragment
            keys.append(identity)
            if item['edition']:
                keys.append(identity + '|edition:' + normalized(item['edition']))
    host = normalized(item['host'])
    if host and item['number']:
        keys.append('number:' + host + ':' + normalized(item['number']))
    if host:
        year = (item['announced'] or item['start'])[:4]
        year_in_title = re.search(r'(?<!\d)20\d{2}(?!\d)', item['title'])
        if not year and year_in_title:
            year = year_in_title[0]
        if year:
            keys.append('title:' + host + ':' + normalized(item['title']) + ':' + (item['edition'] or year))
            title = re.sub(r'(?<!\d)'+year+r'\s*년?(?!\d)', '', item['title'])
            if len(normalized(title)) >= 8:
                keys.append('contest:' + host + ':' + normalized(title) + ':' + (item['edition'] or year))
    return keys

def save(db, raw, publish=False, automatic=False, initialize=False):
    item = clean(raw)
    if initialize and raw.get('checked'):
        item['checked'] = datetime.fromisoformat(raw['checked']).astimezone(KST).isoformat(timespec='seconds')
    if publish and (not all(item[k] for k in ('host','eligibility','start','end','url',
            'eligibilityEvidence','deadlineEvidence')) or not item['tags']):
        raise ValueError('공개하려면 주최, 공식 URL, 참가 자격·접수기간의 근거와 범주가 필요합니다.')
    if not db.in_transaction:
        db.execute('BEGIN IMMEDIATE')
    keys = aliases(item)
    matches = set()
    for key in keys:
        row = db.execute('SELECT contest.id, data FROM alias JOIN contest USING(id) WHERE key=?', (key,)).fetchone()
        if not row:
            continue
        existing = json.loads(row['data'])
        if (not raw.get('id') and item['edition'] and existing['edition']
                and normalized(item['edition']) != normalized(existing['edition'])):
            continue
        matches.add(row['id'])
    if raw.get('id') is not None:
        matches.add(int(raw['id']))
    if len(matches) > 1:
        raise ValueError('서로 다른 공고와 중복됩니다. 관리자 확인이 필요합니다.')
    row = db.execute('SELECT * FROM contest WHERE id=?', (next(iter(matches)),)).fetchone() if matches else None
    if row:
        ident = row['id']
        if db.execute('SELECT 1 FROM removed WHERE id=?', (ident,)).fetchone():
            db.executemany('INSERT OR IGNORE INTO alias VALUES (?,?)', [(key, ident) for key in keys])
            return ident, 'unchanged'
        if initialize or (automatic and row['published'] and not publish):
            db.executemany('INSERT OR IGNORE INTO alias VALUES (?,?)', [(key, ident) for key in keys])
            return ident, 'unchanged'
        old = json.loads(row['data'])
        if automatic and raw.get('_expectedChecked', old['checked']) != old['checked']:
            return ident, 'unchanged'
        if automatic and not publish and old['checked'] and old['eligibility']:
            db.executemany('INSERT OR IGNORE INTO alias VALUES (?,?)', [(key, ident) for key in keys])
            return ident, 'unchanged'
        if automatic and not publish:
            for key in ('title','host','start','end','candidateUrl','url','attachments'):
                item[key] = old[key] or item[key]
            if old['host'] in ('전체','응모대상') and raw.get('host'):
                item['host'] = raw['host']
        if automatic and row['published'] and publish:
            for key in ('tags','types','education','number','edition','announced','attachments','candidateUrl'):
                item[key] = old[key] or item[key]
        delta = {k: {'before': old[k], 'after': item[k]} for k in DATES if old[k] != item[k]}
        if delta and (row['published'] or publish):
            db.execute('INSERT INTO history VALUES (?,?)', (ident, dump({
                'changes': delta, 'checked': item['checked'], 'url': item['correctionUrl'] or item['url']})))
        unchanged = all(old[k] == item[k] for k in item if k != 'checked') and row['published'] == publish
        db.execute('UPDATE contest SET published=?, data=? WHERE id=?', (publish, dump(item), ident))
        result = 'unchanged' if unchanged else 'updated'
    else:
        if raw.get('id') is not None:
            raise ValueError('수정할 공고를 찾을 수 없습니다.')
        cursor = db.execute('INSERT INTO contest(published,data) VALUES (?,?)', (publish, dump(item)))
        ident, result = cursor.lastrowid, 'inserted'
    db.executemany('INSERT OR IGNORE INTO alias VALUES (?,?)', [(key, ident) for key in keys])
    return ident, result

def publish_many(db, ids):
    if not isinstance(ids, list) or not ids or any(type(i) is not int or i < 1 or i > 2**63-1 for i in ids):
        raise ValueError('게시할 공고를 1건 이상 올바르게 선택해 주세요.')
    db.execute('BEGIN IMMEDIATE')
    published, skipped = [], []
    required = {
        'host':'주최기관','url':'공식 공고 URL','eligibility':'참가 자격',
        'start':'접수 시작일','end':'접수 마감일','eligibilityEvidence':'참가 자격 근거',
        'deadlineEvidence':'마감일 근거','tags':'공모전 범주',
    }
    for ident in dict.fromkeys(ids):
        row = db.execute('SELECT * FROM contest WHERE id=? AND id NOT IN (SELECT id FROM removed)', (ident,)).fetchone()
        if not row or row['published']:
            skipped.append({'id':ident,'reason':'게시할 수 있는 검토 대기 공고가 아닙니다.'})
            continue
        record = json.loads(row['data'])
        missing = [label for key,label in required.items() if not record.get(key)]
        if missing:
            skipped.append({'id':ident,'reason':'보완 필요 · ' + ', '.join(missing)})
            continue
        try:
            save(db, dict(record,id=ident), publish=True)
        except ValueError as error:
            skipped.append({'id':ident,'reason':str(error)})
            continue
        published.append(ident)
    return {'published':published,'skipped':skipped}

def public_item(row, current):
    item = json.loads(row['data'])
    days = (date.fromisoformat(item['end']) - current.date()).days
    before = current.date().isoformat() < item['start']
    closed = days < 0 or (days == 0 and item['time'] and current.strftime('%H:%M') > item['time'])
    item.update(id=row['id'], primary=item['tags'][0], days=days,
                status='upcoming' if before else 'closed' if closed else 'open')
    return item

def visible(item, current):
    cutoff = (current.date() - timedelta(days=15)).isoformat()
    return item['status'] != 'closed' or item['end'] > cutoff

def catalog(db, query, current):
    rows = [public_item(row, current) for row in db.execute('SELECT * FROM contest WHERE published=1 AND id NOT IN (SELECT id FROM removed)')]
    rows = [item for item in rows if visible(item, current)]
    counts = {status: sum(row['status'] == status for row in rows) for status in ('open','upcoming','closed')}
    kinds = [kind for kind in TYPES if any(kind in row['types'] for row in rows)]
    terms = [unicodedata.normalize('NFKC', term).casefold() for term in query.get('q','').split()]
    found = []
    for row in rows:
        if row['status'] != query.get('status', 'open'):
            continue
        if query.get('tag') and query['tag'] not in row['tags']:
            continue
        if query.get('type') and query['type'] not in row['types']:
            continue
        if query.get('education') == '1' and not row['education']:
            continue
        searchable = unicodedata.normalize('NFKC', ' '.join([row['title'],row['host'],row['topic'],*row['tags']])).casefold()
        if all(term in searchable for term in terms):
            found.append(row)
    order = query.get('sort', 'priority')
    if order == 'latest':
        found.sort(key=lambda row: (row['announced'], -row['id']), reverse=True)
    else:
        found.sort(key=lambda row: (TAGS.index(row['primary']) if order == 'priority' else 0,
                                     row['end'], row['time'] or '24:00',row['id']))
    return {'items': found, 'counts': counts, 'types': kinds, 'today': current.date().isoformat()}

def initialize():
    with connect() as db:
        for item in json.loads((ROOT / 'verified.json').read_text(encoding='utf-8-sig')):
            item.setdefault('checked','2026-11-20T09:40:00+09:00')
            save(db, item, True, initialize=True)
        from sources import configured_sources
        for key, (name, method, source_url, _) in configured_sources().items():
            db.execute('INSERT OR IGNORE INTO source VALUES (?,?)', (key, dump({
                'name':name,'method':method,'url':source_url,'status':'미실행','lastSuccess':None})))

class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body, mime='application/json; charset=utf-8'):
        payload = dump(body).encode() if mime.startswith('application/json') else body
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','strict-origin-when-cross-origin')
        self.send_header('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'")
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(payload)

    def admin(self):
        secret = os.environ.get('RADAR_ADMIN_TOKEN', '')
        given = self.headers.get('Authorization','').encode()
        pin = os.environ.get('RADAR_ADMIN_PIN', '')
        pin_matches = not pin or hmac.compare_digest(self.headers.get('X-Radar-Pin','').encode(), pin.encode())
        if len(secret) >= 24 and hmac.compare_digest(given, ('Bearer ' + secret).encode()) and pin_matches:
            return True
        self.respond(401, {'error':'관리자 인증이 필요합니다.'})
        return False

    def do_GET(self):
        request = urlsplit(self.path)
        path = request.path
        static = {'/': ('index.html','text/html'), '/admin': ('index.html','text/html'),
                  '/app.js': ('app.js','text/javascript'), '/style.css': ('style.css','text/css')}
        if re.fullmatch(r'/contest/\d+', path):
            static[path] = static['/']
        if path in static:
            name, mime = static[path]
            self.respond(200, (ROOT / name).read_bytes(), mime + '; charset=utf-8')
            return
        with connect() as db:
            if path == '/api/contests':
                params = {k:v[-1] for k,v in parse_qs(request.query).items()}
                self.respond(200, catalog(db, params, now()))
                return
            match = re.fullmatch(r'/api/contests/(\d+)', path)
            if match:
                ident = int(match[1])
                row = db.execute('SELECT * FROM contest WHERE id=? AND published=1 AND id NOT IN (SELECT id FROM removed)', (ident,)).fetchone()
                if row:
                    current = now()
                    item = public_item(row, current)
                    if visible(item, current):
                        item['history'] = [json.loads(r['data']) for r in db.execute(
                            'SELECT data FROM history WHERE id=? ORDER BY rowid DESC', (ident,))]
                        self.respond(200, item)
                        return
            if path == '/api/admin':
                if self.admin():
                    self.respond(200, {
                        'items': [dict(json.loads(r['data']), id=r['id'], published=bool(r['published']))
                                  for r in db.execute('SELECT * FROM contest WHERE id NOT IN (SELECT id FROM removed) ORDER BY published, id DESC')],
                        'sources': [json.loads(r['data']) for r in db.execute('SELECT data FROM source')],
                        'runs': [json.loads(r['data']) for r in db.execute('SELECT data FROM runs ORDER BY day DESC LIMIT 20')]})
                return
        self.respond(404, {'error':'찾을 수 없습니다.'})

    def do_POST(self):
        if self.path not in ('/api/admin', '/api/admin/collect', '/api/admin/remove', '/api/admin/publish'):
            self.respond(404, {'error':'찾을 수 없습니다.'})
            return
        if not self.admin():
            return
        try:
            if self.path.endswith('/collect'):
                from sources import collect
                self.respond(200, collect())
                return
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 100_000:
                raise ValueError('등록 데이터 크기를 확인해 주세요.')
            body = json.loads(self.rfile.read(length))
            with connect() as db:
                if self.path.endswith('/publish'):
                    if body.get('confirmed') is not True:
                        raise ValueError('선택한 공고의 공식 원문 확인이 필요합니다.')
                    result = publish_many(db, body.get('ids'))
                elif self.path.endswith('/remove'):
                    ident = int(body['id'])
                    if not db.execute('SELECT 1 FROM contest WHERE id=?', (ident,)).fetchone():
                        raise ValueError('삭제할 공고를 찾을 수 없습니다.')
                    db.execute('INSERT OR IGNORE INTO removed VALUES (?,?)', (ident,now().isoformat()))
                    result = {'id':ident,'result':'removed'}
                else:
                    ident, outcome = save(db, body, body.get('published') is True)
                    result = {'id':ident,'result':outcome}
            self.respond(200, result)
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            self.respond(400, {'error': str(error)})

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('serve','init','collect','daily'))
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', default=8787, type=int)
    parser.add_argument('--schedule', type=time.fromisoformat,
                        help='Run once per KST date at or after HH:MM while serving.')
    args = parser.parse_args()
    initialize()
    if args.command == 'serve':
        stop = Event()
        with ThreadingHTTPServer((args.host,args.port),Handler) as server:
            if args.schedule:
                Thread(target=schedule, args=(args.schedule, stop), daemon=True).start()
                print(f'Daily collection at {args.schedule:%H:%M} KST', flush=True)
            print(f'http://{args.host}:{server.server_port}', flush=True)
            try:
                server.serve_forever()
            finally:
                stop.set()
    elif args.command in ('collect','daily'):
        from sources import collect
        print(dump(collect(scheduled=args.command == 'daily')))

def schedule(at, stop):
    from sources import collect
    while not stop.is_set():
        current = now()
        due = datetime.combine(current.date(), at, KST)
        if current >= due:
            try:
                result = collect(scheduled=True)
                print(dump(result), flush=True)
                due += timedelta(days=1)
            except Exception as error:
                print('Scheduled collection error:', error, flush=True)
                stop.wait(60)
                continue
        delay = max(1, (due - now()).total_seconds())
        stop.wait(delay)

if __name__ == '__main__':
    import sys
    sys.modules['radar'] = sys.modules[__name__]
    main()
