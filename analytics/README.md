# 지니 행정도구 조회수 운영 안내

홈페이지 카드의 `프로그램 실행` 또는 `프로그램 다운로드` 클릭 횟수를 저장합니다.
방문자의 이름, IP, 파일 내용 등 개인정보는 저장하지 않습니다.

현재 통계 API는 `https://jini-tool-stats.yjj32.workers.dev`이며,
Cloudflare Worker와 APAC 지역 D1 데이터베이스에 배포되어 있습니다.
홈페이지 배포가 반영되면 각 도구 카드 아래에 누적 실행 횟수가 표시됩니다.

## 파일 구성

- `src/worker.js`: 조회·증가 API와 등록 도구 목록
- `migrations/0001_create_tool_counts.sql`: D1 테이블과 초기 도구 목록
- `wrangler.jsonc`: Worker, D1, 허용 홈페이지 주소 설정
- `tests/worker.test.mjs`: 집계·차단 동작 자동검사
- `../assets/stats-config.js`: 홈페이지에서 사용할 배포 API 주소
- `../assets/stats.js`: 카드 조회 및 클릭 집계

## 현재 배포 상태

Cloudflare 로그인, D1 데이터베이스 생성, 원격 테이블 적용, Worker 배포는 완료했습니다.
`wrangler.jsonc`와 `../assets/stats-config.js`에는 실제 계정·데이터베이스·API 주소가 설정되어 있습니다.

코드를 수정한 뒤 Worker만 다시 배포하려면 이 폴더에서 실행합니다.

```powershell
npx wrangler deploy
```

홈페이지의 `index.html` 또는 `../assets` 파일을 수정한 경우에는 저장소의 `main` 브랜치에 올려야 Vercel 홈페이지에 반영됩니다.

## 새 계정에 최초 배포할 때

PowerShell에서 이 폴더로 이동한 뒤 실행합니다.

```powershell
npm install
npx wrangler login
npx wrangler d1 create jini-tool-stats
```

명령 결과의 `database_id`를 `wrangler.jsonc`에 입력하고, Cloudflare 대시보드의 계정 ID도 `account_id`에 설정합니다.

`wrangler.jsonc`의 `ALLOWED_ORIGINS`에는 실제 홈페이지 주소를 입력합니다.
여러 주소는 쉼표로 구분합니다. 로컬 확인 주소는 그대로 두어도 됩니다.

```jsonc
"ALLOWED_ORIGINS": "http://127.0.0.1:8765,https://실제-홈페이지-주소"
```

데이터베이스를 만들고 Worker를 배포합니다.

```powershell
npm run db:remote
npm run deploy
```

배포 결과의 `https://...workers.dev` 주소를 복사해
`../assets/stats-config.js`에 입력합니다.

```js
window.JINI_STATS_CONFIG = Object.freeze({
  apiBase: "https://jini-tool-stats.계정.workers.dev"
});
```

이후 홈페이지 파일을 Vercel에 배포하면 카드별 실행 횟수가 표시됩니다.

## 정상 동작 확인

```powershell
npm run check
```

배포 API 확인:

```powershell
Invoke-RestMethod "https://배포주소.workers.dev/health"
Invoke-RestMethod "https://배포주소.workers.dev/counts"
```

홈페이지 버튼을 한 번 누른 후 `/counts` 결과에서 해당 도구 숫자가 1 증가하면 정상입니다.

## 조회수 수정 또는 초기화

아래 명령에서 도구 ID와 숫자만 바꿉니다.

```powershell
npx wrangler d1 execute jini-tool-stats --remote --command "UPDATE tool_counts SET count = 0 WHERE tool_id = 'work-plan'"
```

전체 조회:

```powershell
npx wrangler d1 execute jini-tool-stats --remote --command "SELECT * FROM tool_counts ORDER BY tool_id"
```

## 새 도구 추가

1. `index.html` 카드에 중복되지 않는 `data-tool-id`를 지정합니다.
2. 실행 버튼에 `data-track-tool` 속성을 붙입니다.
3. 카드 버튼 바로 위에 `<span class="tool-stats" aria-live="polite">조회수 확인 중</span>`을 넣습니다.
4. `src/worker.js`의 `TOOL_IDS`에 같은 ID를 추가합니다.
5. 새 migration SQL을 만들어 `INSERT OR IGNORE`로 ID를 추가합니다.
6. `npm run check` 후 migration과 Worker를 다시 배포합니다.

## 장애 시 동작

통계 API 주소가 비어 있거나 서버가 응답하지 않으면 조회수 문구만 숨겨집니다.
프로그램 실행·다운로드 링크는 통계와 분리되어 계속 정상 작동합니다.
