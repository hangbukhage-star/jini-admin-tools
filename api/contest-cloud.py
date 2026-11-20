import base64
import gzip
import hmac
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from urllib.parse import urlsplit, parse_qs
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'radar-cloud'))
from radar import DB_PATH, Handler, initialize
from sources import collect
from sync_feed import export_feed

def bridge(data=None):
    origin = os.environ['RADAR_BRIDGE_ORIGIN'].rstrip('/')
    headers = {'Authorization': 'Bearer ' + os.environ['RADAR_BRIDGE_SECRET'],
               'User-Agent':'JiniContestRadar/1.0', 'Accept':'application/json',
               'Content-Type': 'application/json'}
    address = 'https://jini-admin-tools.vercel.app/api/contest-radar?bridge=1' if data else origin + '/state'
    request = Request(address, data=json.dumps(data).encode() if data else None,
                      headers=headers, method='POST' if data else 'GET')
    with urlopen(request, timeout=15) as response:
        return json.load(response)

class handler(Handler):
    def verified_bridge(self):
        secret = os.environ.get('RADAR_BRIDGE_SECRET', '')
        return len(secret) >= 32 and hmac.compare_digest(
            self.headers.get('Authorization','').encode(), ('Bearer ' + secret).encode())

    def do_GET(self):
        self.dispatch(False)

    def do_POST(self):
        self.dispatch(True)

    def dispatch(self, write):
        path = urlsplit(self.path)
        action = parse_qs(path.query).get('action',[''])[0]
        if action == 'collect':
            if not write or not self.verified_bridge():
                self.respond(401,{'error':'수집기 인증이 필요합니다.'})
                return
        elif action not in ('admin','admin-collect','admin-remove'):
            self.respond(404,{'error':'찾을 수 없습니다.'})
            return
        elif not self.admin():
            return
        self.commit = None
        try:
            state = bridge()
            with TemporaryDirectory() as directory:
                db_file = Path(directory) / 'radar.db'
                if state['snapshot']:
                    db_file.write_bytes(gzip.decompress(base64.b64decode(state['snapshot'])))
                token = DB_PATH.set(db_file)
                try:
                    initialize()
                    if write:
                        self.commit = (state['revision'],db_file)
                    if action == 'collect':
                        length = int(self.headers.get('Content-Length','0'))
                        if length > 1000 or length < 0:
                            self.respond(400,{'error':'수집기 요청 크기 오류'})
                            return
                        args = json.loads(self.rfile.read(length)) if length else {}
                        self.respond(200,collect(scheduled=args.get('scheduled') is True))
                    else:
                        self.path = '/api/admin' + {'admin':'','admin-collect':'/collect','admin-remove':'/remove'}[action]
                        if write:
                            super().do_POST()
                        elif action == 'admin':
                            super().do_GET()
                        else:
                            self.respond(405,{'error':'POST만 지원합니다.'})
                finally:
                    DB_PATH.reset(token)
        except HTTPError as error:
            print(f'Radar cloud bridge HTTP {error.code}', file=sys.stderr)
            status = 409 if error.code == 409 else 503
            self.respond(status,{'error':'다른 수집 또는 편집이 진행 중입니다. 다시 시도해 주세요.' if status == 409 else '클라우드 저장소 연결 실패'})
        except (ValueError, TypeError, AttributeError):
            self.respond(400,{'error':'요청 형식을 확인해 주세요.'})
        except (OSError, KeyError) as error:
            print(f'Radar cloud runtime {type(error).__name__}', file=sys.stderr)
            self.respond(503,{'error':'클라우드 저장소 연결 실패'})

    def respond(self, status, body, mime='application/json; charset=utf-8'):
        if status == 200 and getattr(self,'commit',None):
            revision, db_file = self.commit
            self.commit = None
            bridge({'revision':revision,
                    'snapshot':base64.b64encode(gzip.compress(db_file.read_bytes())).decode(),
                    'feed':json.loads(export_feed())})
        super().respond(status, body, mime)
