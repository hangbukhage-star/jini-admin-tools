"""Collect locally and synchronize the reviewed public feed to Manmulsang."""
import argparse
import json
import os
from pathlib import Path
import subprocess

from radar import ROOT, connect, initialize, now, public_item, visible

REMOTE = 'https://github.com/hangbukhage-star/jini-admin-tools.git'
FEED = 'contest-radar/public-data.json'
PUBLIC_FIELDS = (
    'id','title','host','eligibility','topic','format','prize','announced','start','end',
    'time','url','attachments','tags','types','education','checked',
)

def export_feed():
    with connect() as db:
        current = now()
        records = []
        for row in db.execute('SELECT * FROM contest WHERE published=1 AND id NOT IN (SELECT id FROM removed) ORDER BY id'):
            item = public_item(row,current)
            if not visible(item,current):
                continue
            record = {key:item[key] for key in PUBLIC_FIELDS}
            record['history'] = [json.loads(h['data']) for h in db.execute(
                'SELECT data FROM history WHERE id=? ORDER BY rowid DESC',(item['id'],))]
            records.append(record)
    return (json.dumps(records,ensure_ascii=False,indent=2)+'\n').encode('utf-8')

def git(directory, *args):
    return subprocess.check_output(['git','-C',str(directory),*args],
        stderr=subprocess.STDOUT, timeout=120, env={**os.environ,'GIT_TERMINAL_PROMPT':'0',
            'GCM_INTERACTIVE':'Never'}).decode('utf-8',errors='replace').strip()

def sync(data, checkout):
    checkout.parent.mkdir(parents=True,exist_ok=True)
    if not checkout.exists():
        git(checkout.parent,'clone','--depth','1','--filter=blob:none','--no-checkout','--branch','main',REMOTE,str(checkout))
        git(checkout,'sparse-checkout','init','--no-cone')
        git(checkout,'sparse-checkout','set','--no-cone','/contest-radar/public-data.json')
        git(checkout,'checkout','main')
    if git(checkout,'remote','get-url','origin') != REMOTE or git(checkout,'branch','--show-current') != 'main':
        raise ValueError('공모전 배포 전용 폴더의 Git 주소나 브랜치가 다릅니다.')
    pending=git(checkout,'status','--porcelain','--untracked-files=all')
    if pending and pending not in ('M contest-radar/public-data.json','M  contest-radar/public-data.json'):
        raise ValueError('배포 전용 폴더에 다른 파일 변경이 있습니다.')
    git(checkout,'fetch','--depth','1','origin','main')
    # This private checkout holds a reproducible feed only. Refresh it from the verified remote
    # before each export so a prior rejected push cannot overwrite concurrent homepage changes.
    git(checkout,'reset','--hard','FETCH_HEAD')
    output=checkout/FEED
    old_data=output.read_bytes().replace(b'\r\n',b'\n')
    if old_data==data:
        return '공개 공고 변경 없음'
    output.write_bytes(data)
    git(checkout,'add','--',FEED)
    git(checkout,'commit','-m','Sync reviewed contest radar feed')
    git(checkout,'push','origin','HEAD:refs/heads/main')
    return git(checkout,'rev-parse','HEAD')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--collect',action='store_true')
    parser.add_argument('--export',type=Path)
    args=parser.parse_args()
    initialize()
    if args.collect:
        from sources import collect
        collect(scheduled=True)
    data=export_feed()
    if args.export:
        args.export.write_bytes(data)
        return
    log=ROOT/'data/feed-sync.log'
    try:
        result=sync(data,ROOT/'data/feed-checkout')
    except Exception as error:
        detail=error.output.decode('utf-8',errors='replace').strip() if isinstance(error,subprocess.CalledProcessError) else str(error)
        with log.open('a',encoding='utf-8') as f:
            f.write(f'{now().isoformat()} 실패 {detail}\n')
        raise
    with log.open('a',encoding='utf-8') as f:
        f.write(f'{now().isoformat()} 성공 {result}\n')
    print(result)

if __name__=='__main__':
    main()
