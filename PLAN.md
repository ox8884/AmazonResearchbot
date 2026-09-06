# Forge Kitchen Ops 신규 구축 실행 계획

## 실행 상태 (2026-09-06)
- 계획 승인: Jay, “Plan approved”.
- 디자인 승인: Jay, 시안 그대로. DESIGN.md SHA-256 `f4e17fadeee52bcddc1a96fa164866c3b735e1c69a182135fb9bab3725cec9c5` at 2026-09-06T03:13:14-05:00.
- 현재 마일스톤: M1 로컬 20후보 수직 연결. 유료 호출·외부 전송·프로덕션 배포·데이터 삭제는 하지 않는다.

## Context
Jay가 운영하는 주방용품 브랜드 Forge Kitchen의 Amazon FBA 리서치·소싱 시스템을 처음부터 만든다. CSV 20행을 20개 후보로 가져와 공식 Jungle Scout 검증, 공급처 수집, 승인된 견적 연락, 손익 비교와 발주 판단까지 연결한다. 기본 언어는 한국어/영어 전환이며 웹 UI는 Cloudflare, 유일한 프로덕션 워커는 Oracle VM, DB는 Postgres이다. 지금은 계획만 작성하며 코드·계정 설정·배포를 변경하지 않는다.
추가 확정 요구: **프론트엔드를 예쁘게 만든다.** 쉬운 사용성과 별도의 합격 항목으로 취급하고, 일관된 글꼴·여백·색·정렬·제품/견적 정보 표현과 실제 PC/태블릿/모바일 화면 검수로 확인한다.

## 확인한 사실과 근거
- `계약서-SPEC.md` 전체를 먼저 읽었다. 요구사항 1–10, 비즈니스 규칙, 이전 실패 12개, 최종 시나리오를 본 계획의 합격 기준으로 삼는다.
- 새 작업 폴더를 read로 확인: 계약서와 `.codegraph`만 있고 기존 구현이 없다. 따라서 신규 경로와 심볼은 이후 명시하는 새 설계이며 재사용할 현행 애플리케이션 코드는 없다.
- `gh repo view ox8884/AmazonResearchbot --json name,isEmpty,isPrivate,defaultBranchRef,url` 결과 `isEmpty:true`, `isPrivate:false`, 기본 브랜치 이름 빈 값. 공개 저장소이므로 실제 CSV·공급처 연락처·서버 식별자·로그·키·DB 백업은 절대 커밋하지 않는다.
- 공개 URL https://github.com/ox8884/AmazonResearchbot 확인. contents API 404만으로 빈 저장소라 단정하지 않고 인증된 gh 메타데이터로 확인했다.
- 구버전 `C:/Users/hyj53/Documents/amazon research agent` 디렉터리에는 운영/장애/검증 기록이 있다. 외부 사실만 참고하며 구버전 설계·디자인·코드 구조는 채택하지 않는다.
- BrowserOS neo 스킬을 확인했지만 이 세션의 도구 목록에는 neo 제어 도구가 없다. 로그인 웹 검색·다운로드·Alibaba 전송의 실측은 미실행이다. 다른 브라우저로 사용자 세션을 우회하지 않는다.
- `C:/Users/hyj53/Documents/amazon research agent/docs/deployment/oracle.md:3–17,38–59`는 Ubuntu 24.04 ARM64/4 OCPU/24GB를 대상 환경으로 기록하고 공유 호스트 timezone 보존을 요구한다. 이번 세션 실제 서버 재실측 아님.
- 같은 구버전 `review-logs/2026-09-05-oracle-worker-production-correction.md:5–10,22–38`은 Oracle 구 워커를 놓친 채 Windows 소비자를 추가한 사고, SIGTERM 후 복구, 재부팅 미실시를 기록한다. 기존 DB는 원격 Supabase였으며 본 계획의 새 Oracle Postgres와 혼동하지 않는다.
- 공식 Jungle Scout OpenAPI https://developer.junglescout.com/api-docs/v1/swagger.json 과 설명 https://developer.junglescout.com/api 를 확인했다. `Keywords.search_terms` schema=array/예시=string 충돌, HSV 366일 오류 명세, parent sales 중복 합산 위험을 확인했다. 현재 계정 quota/CSV 실제 다운로드는 미확인이다.
- Better Auth의 https://www.better-auth.com/docs/plugins/2fa 및 https://www.better-auth.com/docs/authentication/email-password 에서 TOTP/backup codes/trusted devices와 password 로그인 기능을 확인했다. pg-boss 공식 `docs/api/jobs.md`, `constructor.md`, `workers.md`(https://github.com/timgit/pg-boss)에서 transaction adapter·producer 옵션·동시성 API를 확인했다.

## 질문과 기본 결정 — QUESTIONS.md 이관 원문
기록일: 2026-09-06. 모든 항목은 답변 없음/기본안 채택이며 실제 지출·외부 전송·배포 승인이 아니다. 쓰기 권한 복원 후 프로젝트 루트 `QUESTIONS.md`에 날짜/질문/기본안/실제로 진행한 내용/응답·승인 상태 열로 기록한다. 현재 진행한 내용은 조사와 계획 수립뿐이다.

| ID | 질문 | 기본안 | 현재 진행/상태 |
|---|---|---|---|
| Q1 | 첫 판매 시장은 미국인가? | Amazon US, USD, 주방용품. 시장별 수수료·규격 분리. | 이 기본값으로 설계, 답변 없음 |
| Q2 | ROI 150%의 분모는 무엇인가? | 광고 후 단위 기여이익 / 단위 도착원가 × 100. 출시 현금 한도는 별도 판정. | 계산식 선택만, 답변 없음 |
| Q3 | API·AI·서버 운영비를 $3,000에 포함하는가? | 상품 출시 현금과 시스템 운영비 분리. 유료 호출/추가 지출 한도는 미승인, 실제 호출 차단. | 지출 0, 답변 없음 |
| Q4 | 기존 업무 데이터를 이관하는가? | 빈 업무 데이터로 시작. 기존 데이터 보존. 이관은 별도 승인 후 출처 보존. | 이관·삭제 없음, 답변 없음 |
| Q5 | 요약 시각과 채널은? | Asia/Seoul 08:00 이메일. 발신·수신·일일 반복 범위 승인 전에는 앱 내부 요약만. | 발송 0, 계정·승인 대기 |
| Q6 | 로그인 브라우저가 없으면? | 웹 확인 대기. 쿠키 서버 복사/인증 우회 없이 세션 복구 후 재개. 다른 후보는 계속. | 실제 세션 미확인 |
| Q7 | 견적 연락 채널은? | 공개 업무용 이메일 우선. Alibaba 내 메시지만 가능하면 승인된 실제 브라우저로 전송. 수신·본문·사양·수량 단위 승인. | 외부 연락 0, 승인 대기 |
| Q8 | 자동 발주·결제도 포함하는가? | 발주 판단 자료와 결정 기록까지. 실제 구매·결제는 자동 실행하지 않음. | 기본 경계로 설계 |

추가 결정 D1 — 2026-09-06 / 사용자 요청: “프론트 엔드 예쁘게 만들 것” / 확정: 미적 완성도를 별도 요구 F11로 추가 / 진행: 계획의 디자인·M0·M5·시각 검증 기준에 반영, 아직 화면 구현 없음. 이 항목도 QUESTIONS.md의 결정 기록으로 옮긴다.

## 승인 경계
계획 승인과 디자인 시스템 승인은 각각 필요하다. 계획 단계에는 작업 트리를 수정하지 않는다. 이후 디자인 문서를 먼저 만들고 승인 없이는 애플리케이션 코드를 작성하지 않는다. 계약의 무인 진행 조항을 디자인 승인·유료 호출·외부 전송·배포 승인을 생략하는 근거로 사용하지 않는다. 유료 API 호출, 외부 전송(운영 이메일 포함), Oracle/Cloudflare 프로덕션 배포, 데이터 삭제는 사전 승인 없이는 실행하지 않는다. 질문 기본안은 승인으로 간주하지 않는다. 구현 허용 후에도 승인 대기 행위만 보류하고 가능한 독립적인 로컬 구현·검증을 계속한다.

## Approach
아래 경로·심볼·설정은 모두 신규 설계다. 새 저장소에 동등 기능이 없으므로 아래 라이브러리의 검증된 기능을 재사용하고, 업무 상태·근거·예산 승인만 직접 구현한다. 순서는 M0 → M1 → M2 → M3 → M4 → M5 → M6이며 OAuth P1은 M1 공통 계약 이후 독립적이다.

### 1. 운영 경계와 기술 구성 고정
- Node.js 24 LTS, pnpm workspace, TypeScript strict. React + Vite SPA(화면만 브라우저에서 구성), React Router, TanStack Query, React Hook Form + Zod, Radix 접근성 primitive, CSS tokens, i18next를 사용한다. 서버는 Fastify, Postgres 17, `pg` + Drizzle의 append-only SQL migration, `pg-boss` 큐, `decimal.js` 금액 계산이다. 인증은 Better Auth의 email/password + `twoFactor()` TOTP 및 trusted-device 기능을 재사용한다. 구현 시작 시 호환 stable 버전을 lockfile로 고정하고 canary/beta는 쓰지 않는다.
- Cloudflare **Workers Static Assets** 선택: 정적 React 파일과 `/api/*` 프록시를 한 배포 단위로 관리한다. Pages+별도 Functions나 Next.js SSR은 사용하지 않는다. 개인 운영 도구에 SEO/SSR이 불필요하고 Node 워커/비밀정보 처리를 Oracle 한 곳에 두기 위함이다. 공식 근거: https://developers.cloudflare.com/workers/static-assets/ .
- 브라우저 → Cloudflare Worker → Access 서비스 인증으로 보호된 Cloudflare Tunnel → Oracle localhost Fastify API → Postgres. `/api/*`는 `run_worker_first`로 SPA fallback보다 먼저 처리하고 모든 업무/API 응답은 `Cache-Control: no-store`다. JS/CSS에는 업무 데이터나 키를 빌드하지 않는다.
- 신규 Postgres는 Oracle VM의 별도 `forge_ops` DB로 설치한다. 기존 Supabase/DB를 복제하거나 연결하지 않는다. 같은 VM 장애 위험 때문에 암호화된 DB+원본파일 백업을 VM 외부의 비공개 Cloudflare R2 버킷에 둔다. 버킷·VM 변경·스토리지 비용은 배포 승인 범위에 포함되어야 하며 미승인 시 생성하지 않는다.
- 신규 코드 소유 경계: `apps/web` UI, `apps/edge` Cloudflare 정적 배포/고정 origin 프록시, `apps/api` 인증과 업무 API, `apps/worker` 유일 큐 소비자, `apps/browser-bridge` 선택적 로그인 브라우저 보조 연결, `packages/domain` 근거/상태/손익, `packages/db` schema/migrations/transaction, `packages/integrations` Jungle Scout/AI/소싱/메일 어댑터, `packages/security` 암호화/안전한 HTTP/로그, `packages/ui` 공통 컴포넌트·번역·tokens, `ops` systemd/배포, `tests` 합성 fixture/통합·인수 시나리오. browser-bridge는 큐 소비자가 아니라 Oracle가 서명한 제한된 웹 작업만 받아 결과를 반환한다.
- 로컬 실행 계약은 설치 완료 후 루트 `pnpm dev` 한 번이다. `scripts/dev.mjs`가 Docker Desktop의 로컬 Postgres·Mailpit을 준비하고 로컬 migration, web/API/worker를 함께 실행·종료한다. DB 볼륨을 자동 삭제하지 않는다. 초기 도구 설치가 없으면 한글 오류와 준비 방법을 표시하며 `pnpm dev`가 시스템 패키지 설치·유료 요청·production credential 로드를 하지 않는다.

### 2. 디자인 문서 선승인과 화면 문법
- 쓰기 허용 후 첫 산출물은 루트 `PLAN.md`(본 문서 내용), `QUESTIONS.md`(위 질문 원문과 실제 진행 상태), `PRODUCT.md`(계약의 사용자·업무·고정 조건), `DESIGN.md`(이 절의 디자인 체계와 화면별 설명)다. 이전 디자인을 열어 베끼지 않는다. `DESIGN.md` 승인 기록에 문서 hash와 승인 시점을 남긴 뒤 애플리케이션 구현한다. 무응답이면 디자인 승인 대기로 남기고 조사·검증 명세 작성만 진행한다.
- Operate 방향: “오늘 처리할 승인함”. 아침에 잠깐 접속하는 비개발 운영자가 다음 결정과 근거를 같은 화면에서 읽는다. 거대한 KPI 타일·수익 확률·코드/서버/로그 콘솔은 첫 화면에 두지 않는다. 기본 밝은 화면, 배경 `#F4F6F8`, 본문 `#172B3A`, 표면 `#FFFFFF`, 행동색 `#164E63`, 경고 글자 `#854D0E`/배경 `#FEF3C7`, 위험 `#991B1B`/`#FEE2E2`, 성공 `#166534`/`#DCFCE7`. 상태는 색+문구+아이콘으로 중복 표현한다. 이 색은 제안 값이며 승인 전 UI 구현 금지.
- 글꼴은 자체 호스팅 Noto Sans KR variable + system sans, 본문 16px/1.5, 보조 14px 이상, 제목 24/32px, 숫자 tabular-nums. 간격 4/8/12/16/24/32px, 모서리 8px, 입력·주요 버튼 최소 높이 44px, 명확한 2px focus ring. 의미 없는 애니메이션·가로 카드 회전·nested card 구조를 만들지 않는다. reduced-motion 존중.
- 경로: `/` 오늘의 승인; `/research` 저장 검색/CSV 가져오기; `/candidates` 후보 목록; `/candidates/:id` 근거·경쟁·소싱·계산 세부; `/sourcing` 견적 요청/회신 비교; `/settings` 기준·예산·연결·언어·알림; `/security` 로그인 기기·복구·감사 기록. 화면에 원시 endpoint/SQL/stack trace를 노출하지 않고 연결의 이름과 상태를 보여준다.
- 후보 요약 API의 유일 형식은 `CandidateView = { id, keyword, stage, evidenceSummary, unknowns, nextAction }`; `nextAction = { kind: 'automatic'|'approval'|'waiting', label, target }` 하나만 반환한다. 승인 필요 후보는 가장 먼저 해결할 한 가지 행동을 강조한다. 자동 작업은 “자동 확인 중”, 접근 불가이면 “웹 연결을 기다리고 있어요”처럼 다음 행동을 설명하고 불필요한 승인 버튼을 만들지 않는다.
- 1280px: 216px 사이드바 + 주 승인목록 + 선택 건 근거 패널. 768px: 상단 내비게이션 + 단일 목록, 세부는 별도 화면. 375px: 하단 핵심 4탭(오늘/후보/견적/설정), 승인 카드 단일열, 세부 안에서 근거/모르는 것/행동 순서. 견적 비교는 모바일에서 견적별 세로 항목과 동일 필드 반복으로 제공하며 페이지 가로 스크롤을 만들지 않는다.
- 첫 실행은 업무 0건 안내와 “제품 가져오기”; 대기 0건은 “지금 승인할 일이 없어요”와 자동 진행 요약. 로딩/빈 데이터/실패/오프라인/기준 변경으로 오래된 평가/견적 미도착/미확인/승인 후 전송 불확실 상태를 별도 문구로 설계한다. 영어 전환은 모든 사용자 문구·메일을 포함하고 USD/시장 의미는 번역으로 바꾸지 않는다.
- **F11 시각 품질 합격**: 디자인 선승인 때 승인함·후보 상세·견적 비교·설정의 화면별 정적 시안과 375/768/1280 구성 규칙을 `DESIGN.md`에 포함한다(이미지/문서, 애플리케이션 코드 아님; 유료 이미지 생성은 별도 승인 전 금지). 구현 후 같은 대표 화면의 실제 스크린샷을 대조해 폰트/행간/간격/정렬/색/버튼·입력/표/반응형 규칙 이탈을 표로 남긴다. 제품 이미지는 실제 출처와 사용권이 있을 때만 쓰고 없으면 명확한 “이미지 없음”을 사용한다. 장식용 가짜 제품·지표·과한 그라데이션으로 채우지 않는다.
- 화면 전환 120–180ms와 승인 완료 feedback은 작업 상태를 알려줄 때만 쓰며 reduced-motion에서는 제거한다. 한 화면씩 임시 스타일을 추가하지 않고 `packages/ui` tokens/공통 컴포넌트로 수정한다. desktop/mobile를 묶어 한 번 검수하고 지적사항을 한 묶음으로 고쳐 확인한다. 기능 합격만으로 시각 합격을 대신하지 않고 최종 미적 승인은 Jay에게 실제 화면으로 받는다.

### 3. 근거·기준·다중 후보 파이프라인
- `packages/domain/src/evidence.ts`에 `Evidence<T> = {kind:'measured'|'estimate'|'quote'; value:T; sourceId:string; observedAt:string} | {kind:'unknown'; value:null; sourceId:string|null; observedAt:string|null; reason:string}`를 정의한다. `unknown` value가 계산에 들어갈 수 없도록 narrow한 숫자 타입만 손익 함수가 받는다. API/DB에도 kind/value 일치 CHECK, source/time 필수 조건을 둔다. unknown의 timestamp가 없는 사실은 null로 표현하고 임의 시점을 측정 시점으로 만들지 않는다.
- 수치 계산 결과도 입력 sourceId/계산 버전/계산 시점/추정 포함 여부를 보존한다. 모델이 추론한 값은 estimate이며 가격표 견적처럼 승격하지 않는다. estimate/quote로 계산한 GO는 “현재 입력 기준 충족 · 추정 포함/견적 기반”이지 “수익성 확인”이 아니다.
- `settings_versions`는 `version`, `effectiveAt`, `approvedBy`, 전체 settings snapshot을 보존한다. 초기키는 `marketplace:'us'`, `currency:'USD'`, `launchBudgetUsd:'3000.00'`, `marginBeforeAdsPct:'35'`, `marginAfterAdsPct:'35'`, `roiPct:'150'`, `timezone:'Asia/Seoul'`, `summaryLocalTime:'08:00'`. 업무 numeric은 decimal string + Postgres numeric, 단순 부동소수점으로 돈을 합산하지 않는다. 앱/API/AI 모두 직접 current 설정 변경 권한이 없으며 Jay 승인 트랜잭션만 새 버전을 활성화한다.
- `imports`, `import_rows`, `sources`, `evidence`, `candidates`, `candidate_events`, `evaluations`, `settings_versions`, `approvals`, `external_actions`, `api_operations`, `api_attempts`, `api_cache`, `budget_days`, `suppliers`, `spec_revisions`, `quotes`, `providers`, `provider_routes`, `daily_runs`, `summaries`, `audit_events`를 업무 테이블로 둔다. 인증 표는 Better Auth schema를 가져와 버전 migration에 포함한다. 사업 데이터·감사·attempt는 자동 삭제하지 않는다.
- 상태 전이: `imported` → `screening` → `api_validation` → `sourcing` → `rfq_draft` → `awaiting_contact_approval` → `sending_rfq` → `awaiting_quote` → `economics_review` → `awaiting_order_decision` → `decision_recorded`. `rejected`는 확인된 탈락 근거가 있는 경우만. 막힘은 단계와 별개 `blockedReason = web_session|budget|credential|evidence|external_outcome_unknown|provider_unavailable|null`로 저장하여 “웹 확인 대기” 후 정확한 단계로 복귀한다. GO/CAUTION/HOLD는 평가 판정이지 큐 실행 상태가 아니다.
- API 변경은 `POST /api/imports`, `GET /api/candidates`, `GET /api/candidates/:id`, `POST /api/quotes`, `POST /api/approvals/:id/approve`, `POST /api/approvals/:id/reject`, `POST /api/settings/proposals`를 중심으로 한다. 입력 Zod 검증, version 기반 낙관적 잠금, 중복 요청 idempotency key와 payload hash를 적용한다. 승인 내용이 바뀌었으면 409 `APPROVAL_STALE`, 권한 없는 실행은 403, 누락 근거는 후보 HOLD이지 서버 에러가 아니다.
- 모든 후보 단계 변경과 다음 pg-boss `send(name,data,{db:transactionAdapter})`를 같은 DB transaction으로 기록한다. 라이브러리 `db.executeSql(text,values)`를 pg transaction client에 연결한다. API 프로세스는 `supervise:false,schedule:false,migrate:false` producer로만 사용하고 `work()/fetch()`를 호출하지 않는다. 큐 job에는 후보 ID/단계/버전만 넣고 원문·비밀키는 넣지 않는다. `candidate_events`의 `(candidate_id,stage,input_version)` UNIQUE가 재실행 중복 부작용을 막는다.
- worker 초기 `localConcurrency:4`, job별 처리(batchSize 1); 외부 provider는 원자적 전역 예산/레이트 제한을 별도로 적용한다. 한 후보의 세션/견적 대기가 다른 후보 실행을 막지 않는다. job ack 유실로 다시 실행되어도 저장된 단계 결과와 외부 attempt부터 확인한다. 큐의 at-least-once 재전달을 외부 호출 exactly-once 보장으로 소개하지 않는다.

### 4. CSV와 로그인 웹 연결
- `packages/integrations/src/jungle-scout/csv.ts`에서 `csv-parse`의 streaming 파서 사용. UTF-8/BOM 처리, 원문 SHA-256, 원래 filename, byte size, 원본 행 번호, 원시 행, 파일 import 시점, 실제 추출 시점(알면), marketplace, Opportunity Finder 출처 및 저장 검색 revision을 보존한다. 10MiB/10,000 데이터 행 제한은 입력 자원 보호이며 20행 시나리오와 별개다.
- 실제 Opportunity Finder CSV가 아직 없으면 신규 테스트용 20행은 **합성 검증 자료**로 명명하고 실제 웹 export 합격 증거로 쓰지 않는다. 임의 헤더를 공식 형식으로 고정하지 않는다. 실제 승인된 CSV 확보 시 원래 헤더→표준 field mapping을 schema version으로 고정한다. 필요한 헤더가 다르면 import 미리보기에서 사용자가 매핑; 출처는 `user_declared`로 표시하고 자동으로 웹 검증됨이라고 쓰지 않는다. 지원하지 않는 다른 도구 파일은 Opportunity Finder로 위장하지 않고 원래 source type으로 보존한다.
- 파일 내 유효한 서로 다른 키워드 20행은 20 후보+20 원본 행으로 한 transaction에 등록한다. 잘못된 행이 있으면 행별 이유가 보이는 미리보기로 반환하고 후보 commit은 하지 않는다. 동일 file hash+marketplace 재업로드는 기존 import 반환; 다른 파일에 같은 키워드가 있어도 새로운 관측행을 기존 `(marketplace,normalizedKeyword)` 후보에 연결하고 과거 근거를 덮어쓰지 않는다. 원본파일 저장 성공 전에 후보 생성하지 않는다.
- 원본은 Oracle의 웹에서 직접 접근 불가한 암호화 blob 저장소에 둔다. 다운로드는 인증된 API가 원본 attachment로만 반환한다. CSV 셀의 `=,+,-,@` 수식은 실행하지 않고 React는 텍스트로 렌더링; 재내보내기 때 spreadsheet injection을 무해화하고 원본은 바꾸지 않는다.
- 저장 검색은 카테고리/가격/수요/경쟁/계절성 필터와 marketplace/version을 DB에 저장한다. 화면의 “저장 검색 실행” → 실제 브라우저 Opportunity Finder에서 적용·CSV 다운로드 → bridge가 원본 업로드를 자동 수행한다. 실제 연결이 없을 때는 웹 열기/CSV 파일선택+자동임포트의 수동 다운로드 경로를 제공한다.
- 3클릭 합격 범위는 최초 로그인·2FA·저장 검색 설정·bridge 등록을 끝낸 후 **저장 검색을 선택한 상태에서 검색 실행→다운로드→임포트 완료**다. 자동 경로는 1개 시작 클릭, 수동 경로는 검색 1/CSV 내보내기 1/파일선택 1을 목표로 실제 포털 UI와 OS 선택까지 측정한다. 실제 UI가 이를 초과하면 “3클릭 미달”로 기록하고 사용자가 이미 한 클릭을 제외해 수치를 꾸미지 않는다.
- `apps/browser-bridge`는 BrowserOS neo의 공식 MCP가 실제 제공될 때만 capability negotiation 후 사용한다. 초기 등록은 로그인한 앱에서 5분 유효 단회 pairing code, 완료 후 머신 credential은 OS credential vault에 보관; 기기별 철회 가능. bridge는 승인된 origin의 작업을 outbound polling하고 DB credential·API키·일반 shell 명령을 받지 않는다. 검색/CSV/공급처 읽기 및 승인된 특정 연락 외 작업은 거부한다. 쿠키·전체 profile·비밀번호·TOTP는 전송하지 않는다.
- neo transport/schema/session이 unavailable이면 어댑터 비활성 + 수동 다운로드 경로, 해당 웹 작업 대기다. 화면 스크래핑으로 표 모양만 흉내내거나 CAPTCHA/약관/인증 제한을 우회하지 않는다. 브라우저 연결이 없으면 “무인 브라우저 연동 합격”이라 쓰지 않는다.

### 5. 니치 규칙과 공식 API 비용 통제
- `packages/domain/src/niche.ts`의 `evaluateNiche(input,settings):NicheAssessment`는 5개 규칙별 pass/fail/unknown과 출처를 반환한다. 초기값: 리뷰 700 이상 상품 ≤3, 리뷰 2000 이상 ≥2이면 **다른 점수와 무관하게 탈락**; 1위 가격 17–80 inclusive; 월 매출 8000 이상 상품 ≥5; Standard size; 차별화 경로 있음. 알려진 pass ≥4면 1차 통과, pass+unknown<4이면 탈락, 그 외 확인 대기다. hard-fail 리뷰 조건이 미확인이면 최종 합격시키지 않는다. 비율을 알 수 없는 샘플로 상품 수 전체를 단정하지 않는다.
- CSV 1차 필터에서 확인된 탈락만 즉시 종료한다. 규칙을 판단할 상품/리뷰 근거가 아직 없는 후보는 unknown을 유지한 채 **근거를 수집하기 위해 api_validation으로 전진**한다. “검증이 통과해야 검증 API를 부른다”는 순환 조건을 만들지 않는다. API 검증 후에도 불충분하면 HOLD, 확인된 규칙 통과 후보만 소싱한다.
- 설정 화면은 위의 모든 numeric 기준·4/5 pass 개수·리뷰 hard-fail·추가 확인 항목·광고 전후 마진·ROI·출시 현금·시간/예산을 실제 편집할 수 있어야 한다. `POST /api/settings/proposals`는 변경 전/후 차이를 반환하고 승인으로만 활성화한다. 활성화 후 다음 작업은 새 version을 읽으며 구 평가/발주 승인은 오래됨으로 표시하고 재계산한다. UI에 없는 DB-only 설정으로 남기지 않는다.
- 차별화는 AI 점수 하나가 아니라 구체 사양 변경과 고객 불만/비교상품 근거가 연결되어야 한다. AI만 제안하고 뒷받침 자료가 없으면 unknown. 예비 정렬 점수는 통과 규칙을 대신하지 않는다.
- 추가 확인 항목을 설정·결과에 별도로 유지: 1위 매출 점유율 `<35%`, 상위3 `<55%`, 첫 페이지 매출 `>=350000`; 저리뷰 판매 기회, Amazon 자체브랜드, 변형 과다, 반품률, gated 위험. 광고 SOV를 매출 점유율로, Product Database 검색 결과를 Amazon 실제 첫 페이지로 바꾸지 않는다. 모집단/기간이 맞는 근거가 없으면 unknown. 추가 조건의 알려진 위험은 CAUTION, 최종 의사결정에 필요한 범위/수수료/규제 자료 미확인은 HOLD. 초기 4/5 규칙을 추가 조건의 숨은 점수로 바꾸지 않는다.
- 공식 endpoint allowlist: `POST /api/product_database_query`(JSON:API `data.type='product_database_query'`), `POST /api/keywords/keywords_by_keyword_query`(`data.type='keywords_by_keyword_query'`), `GET /api/keywords/historical_search_volume`, `GET /api/sales_estimates_query`, `GET /api/share_of_voice`. base `https://developer.junglescout.com`, 모든 요청 `marketplace=us`, `Authorization: KEY_NAME:API_KEY`, `X-API-Type: junglescout`, `Accept: application/vnd.junglescout.v1+json`, `Content-Type: application/vnd.api+json`. 키 name도 server-only.
- Product Database/Keywords만 `page[size]=100`과 공식 `links.next` cursor를 사용한다. next URL은 같은 HTTPS origin/허용 endpoint/marketplace인지 재검증하고 POST 다음 페이지에 동일 body를 유지한다. CSV 키워드별 Product Database는 시장 Kitchen & Dining 카테고리와 keyword만으로 **리뷰/매출/가격 필터로 탈락 상품을 미리 제거하지 않은 모집단**을 얻는다. 최대 페이지 수는 기본 3으로 설정·노출하며 초과 부분은 미수집, 전체 계산은 unknown이다.
- `search_terms`는 OpenAPI schema에 맞게 `[keyword]` 배열로 구현한다. 최초 승인된 연결검증이 400/422로 거절되면 다른 타입을 유료 자동 재시도하지 않고 해당 endpoint contract 불일치로 차단한다. 공식 문서/제공자 확인으로 타입을 확정한 후 어댑터와 schema fixture를 함께 변경한다.
- HSV는 `keyword,start_date,end_date`로 최근 완료된 365일(UTC 날짜, 어제 끝), Sales Estimates는 `asin,start_date,end_date`로 완료된 최근 30일; 기간은 366일을 넘기지 않는다. SOV는 `keyword`만, 역사 API처럼 period를 invent하지 않는다. HSV의 `estimated_exact_search_volume`는 7일 구간 값, Product Database `approximate_30_day_units_sold/revenue`와 Sales Estimates의 `estimated_units_sold`는 모두 estimate다.
- Sales Estimates parent_asin/is_variant와 Product Database 변형 관계로 동일 parent family 중복을 제거해 매출을 합산한다. family 분리가 불가능하면 정확한 총매출/점유율은 unknown이다. SOV first 3 pages는 노출 점유율로만 표시하고 first-page sales로 해석하지 않는다. LQS 숫자 scale이 문서 내 모호하므로 합격 규칙에 쓰지 않는다. credentials/entitlement·단위 미확인은 해당 호출 또는 지표를 차단한다.
- `authorizeAttempt(operationId,requestFingerprint,budgetDay):Promise<AuthorizedAttempt|BudgetBlocked|AlreadyHandled>`는 DB transaction에서 operation lock + 당일 budget row lock + settings 현재 승인 version 조회를 하고 `reserved + consumed + proposed <= limit`일 때만 attempt 생성·예약한다. 일일 JS wire cap과 승인된 provider별 비용 상한/레이트 제한을 구분한다. 미승인 초기 cap은 호출 가능 0; 실제 요금/entitlement 모르면 과금액은 unknown이며 사용량 무료로 가정하지 않는다.
- rate 제한은 계정 단위 DB window로 초당 15/분당 300 이하이고 사용자 승인 cap이 더 낮으면 그 값을 사용한다. 당일 예산은 UTC day로 고정하고 UI에 리셋 시각을 사용자 시간대로 보여준다. 자정 전 예약을 다음날 dispatch하려면 이전 예약을 취소하고 새 day 예산에서 재승인한다. 결과 확정은 같은 transaction에서 reserved를 감소시키고 consumed를 증가시켜 이중 계산하지 않는다; outcome_unknown은 reservation을 유지한다.
- 캐시 키 `sha256(canonicalJSON({provider,accountScope,endpoint,method,marketplace,normalizedQuery,period,filters,sort,pagination,apiVersion,normalizerVersion}))`. Unicode NFKC/trim/공백 정리와 객체 key 정렬을 수행하고 원본 쿼리는 별도 보존한다. keyword 소문자화는 영문 locale-independent 규칙만 사용한다. 정규화·지원 필드 변경 시 normalizerVersion을 올린다. 신선 데이터 기본 TTL 24h, 종료된 역사 월 데이터 30일; TTL 초과 자료는 오래된 근거로 표시하고 새 평가의 현재 확인에 쓰지 않는다. 정상 만료 후 새 수집은 DB가 부여한 `cacheGeneration`으로 새 operation을 만들되 기존 outcome_unknown fingerprint가 있으면 generation 변경으로 우회하지 못한다.
- 캐시 hit는 wire 0, 동일 요청 동시 cache miss는 operation UNIQUE/row lock으로 대표 1개만 예약한다. 논리 작업 수·관측된 wire 시작 수·예약/불확실 수·제공자 과금 확인액을 분리한다. DB 기록과 socket 송신은 원자화할 수 없으므로 사망 구간의 실제 wire 수는 “확인된 수 + 최대 불확실 N”으로 보여주고 확정값을 꾸미지 않는다. 캐시 lookup 실패/DB 단절이면 직접 API로 우회하지 않는다.
- attempt 상태는 `authorized -> dispatching -> succeeded|http_failed|outcome_unknown`. dispatching을 DB에 commit한 뒤에만 HTTP를 시작한다. authorized 상태는 실제 HTTP 금지이므로 lease 복구로 안전하게 이어갈 수 있다. dispatching 중 워커가 죽으면 결과 모름으로 고정; 같은 요청을 새 attempt로 무조건 보내지 않는다. 공식 idempotency/reconciliation 근거가 있을 때만 동일 provider key로 조회·복구한다. 불명확 요청 예약은 임의 환불하지 않으며 미래 반복 planner도 새 날짜라는 이유로 재전송하지 않는다.
- HTTP SDK 자동 재시도/redirect는 꺼 둔다. 확인된 429/5xx만 최대 2회 추가 attempt, `Retry-After`/공식 `REQUEST_THROTTLED`의 `retry again at` 중 더 늦은 유효 시각 또는 5/30초 backoff로 재예약하며 매번 당일 잔여 예산을 원자 승인한다. timeout/reset/응답 저장 전 사망은 자동 재시도하지 않는다. wire request가 발생한 429/5xx도 예산에서 차감한다. 성공 body가 예상 schema와 다르면 evidence unknown+안전한 오류코드; 키·원시 body를 로그에 남기지 않는다.

### 6. 같은 사양의 소싱·승인·견적·손익
- `spec_revisions`에 재질·치수/단위·포장·수량·품질/인증 요구·목표 시장을 하나의 불변 revision으로 저장한다. API 검증을 통과한 후보에 대해 Alibaba 실제 검색 및 허용된 공개 공급처 페이지를 수집하고 회사/제품 URL/검색어/수집 시점/사양 일치·불일치·미확인을 기록한다. 상품 listing 가격은 estimate이지 견적이 아니다. LLM은 업체나 이메일 주소를 창작할 수 없고 source가 없는 업체는 후보로 등록하지 않는다.
- 별도 공식 바이어 메시지 API가 확인되지 않았으므로 `alibaba.icbu.quotation.post`를 바이어 연락 API로 사용하지 않는다. 실제 로그인 브라우저에서 공급처 조회/연락이 허용된 경로만 자동화한다. 세션/권한이 없으면 웹 작업 대기이며 공급처 미수집을 “공급처 없음”이나 후보 탈락으로 바꾸지 않는다.
- RFQ 초안은 고정 템플릿으로도 생성 가능하게 한다: 사양 revision, 요청수량, 수량별 가격/MOQ, Incoterm·운송 출발/도착 범위, 포장·치수·무게, 샘플/금형/인증비, 리드타임, 결제조건, 견적 유효일. AI는 승인된 모델이 있을 때 문장/번역만 돕는다. 회신이 없는 필드는 unknown으로 남긴다.
- 업무 승인 enum은 `supplier_contact`, `order_decision`, `budget_or_criteria_change`, `provider_activation` 네 가지다. 서버가 `ApprovalPayload`의 대상·revision·수신인·제목/본문·첨부 hash·연락채널 또는 설정/제공자 변경값 hash를 저장한다. Jay의 인증된 승인만 `pending -> approved`가 가능하다. 재승인 클릭은 같은 승인 결과 반환; 거절은 전송 0. 전송 직전 최신 payload와 approval hash를 다시 비교하고 변경/철회/견적 만료 시 stale 처리한다.
- 공급처 연락은 `external_actions`에 approval ID UNIQUE와 immutable payload를 기록한 뒤 원자적으로 `approved -> dispatching`을 획득한 실행자만 보낸다. SMTP/브라우저가 송신을 수락했다는 receipt가 있어야 `sent`/후보 `awaiting_quote`로 이동한다. receipt 전에 사망/timeout이면 “전송 결과 확인 중”; 같은 내용을 자동 재전송하지 않는다. 이메일의 고정 Message-ID/IMAP Sent 또는 브라우저 메시지 thread ID로 먼저 복구하고, 확인 불가이면 대기를 유지한다.
- 기본 메일 연결은 전용 업무 메일함의 SMTP TLS 465(587이면 필수 STARTTLS) + IMAPS 993, `nodemailer` + `imapflow`로 구현한다. 서버 hostname·포트·sender·recipient를 설정하고 앱 비밀번호는 write-only 저장한다. 일반 임의 TCP proxy로 노출하지 않고 포트/호스트 승인 및 공인 IP 검증을 적용한다. 프로토콜 미지원/계정 없음이면 메일 연결 대기; 승인 전 SMTP test send도 하지 않는다. 개발에서만 localhost Mailpit으로 대체한다.
- worker가 IMAP UIDVALIDITY+UID/Message-ID로 새 회신을 중복 없이 수집한다. RFQ Message-ID의 In-Reply-To/References 또는 고유 RFQ 코드로 견적과 연결한다. 본문/첨부는 untrusted: 스크립트/HTML/원격 이미지 실행 금지, 첨부는 제한된 종류·크기·격리 저장 후 텍스트 추출. 명시적 금액·단위와 인용 구간을 붙여 quote로 저장하고 불명확 조건은 unknown. thread가 모호하면 자동으로 임의 후보에 붙이지 않고 미분류 회신으로 표시한다. 수동 견적 입력도 같은 검증과 source 원문 보존 경로를 쓴다.
- `Quote`는 공급처 ID, specRevision, quoteRevision, 통화, 수량별 단가·MOQ **같은 tier**, Incoterm, 운송 포함범위, 운임·관세·prep·inspection, 일회성 선지급비용, 결제 일정, 유효일, 근거를 보존한다. A 견적의 단가와 B 견적의 MOQ를 결합하지 않는다. 수량 변경은 해당 tier로 재계산, 유효하지 않은 tier/만료 견적은 HOLD. 다른 통화는 출처·시점 있는 환율이 없으면 USD로 계산하지 않는다.
- `evaluateEconomics(input:EconomicsInput,settings:SettingsSnapshot):EconomicsAssessment`의 exact 공식: `landedUnitCost = productUnitPrice + unitFreight + unitDuty + unitPrepInspection + otherLandedUnitCost`; `beforeAds = salePrice - landedUnitCost - fbaFee - referralFee - expectedReturnLoss - otherVariableCost`; `afterAds = beforeAds - adsPerUnit`; 전/후 마진은 각각 `/salePrice*100`; `roiPct = afterAds/landedUnitCost*100`; `launchCash = quantity*landedUnitCost + separateUpfrontCosts + initialAdCash + contingencyCash`. 선지급비용을 도착원가에 이미 포함했다면 별도 비용에 중복 포함하지 않는다. launchCash의 광고는 필요 운전자금이며 기여이익의 광고비와 서로 다른 관점이라는 설명을 표시한다.
- 수수료는 현재 marketplace·카테고리·포장 후 치수/무게·적용일이 맞는 Amazon 공식 수수료표를 출처로 사용한다. 공식표를 확보하지 못한 상태에서 보편적인 $3 FBA/15% referral 등을 박제하지 않는다. 초기에는 출처가 있는 수수료 입력을 지원; 정식표를 확보하면 versioned 계산기와 경계 fixture를 추가한다. 공개 listing/API에서 필요한 치수가 없으면 unknown. 광고·반품손실·운송·관세·기타/예비비가 없으면 0으로 가정하지 않는다. 명시적 0은 출처와 그 비용이 없다는 근거가 있을 때만 유효하다.
- 판매가/도착원가 0 이하, 누락 비용, 미확인 필수 위험은 계산 불가 또는 HOLD. 알려진 기준 미달은 CAUTION, 미확인 없이 모든 수익/현금 기준 충족은 GO(근거 분류 병기). 견적 0건은 “견적 대기/HOLD”이지 탈락이 아니다. 발주 패킷은 현재 settings/quote/spec revision과 계산 breakdown을 포함하며 Jay의 GO/보류/거절 결정만 기록한다. 결제 API/자동 주문 버튼을 구현하지 않는다.
- $3,000은 출시별 한도다. 동시에 승인된 미집행 발주 판단이 있다면 `launch_cash_reservations`로 예약합을 계산해 동일 자금을 여러 후보에 중복 승인하지 못하게 한다. 승인 취소/명시적 종료 때만 예약 해제, 견적·설정 변경 시 다시 검토한다.

### 7. AI 제공자 설정과 구독 OAuth 격리
- `POST /api/providers`, `PATCH /api/providers/:id`, `POST /api/providers/:id/test`, `POST /api/providers/:id/activation-proposals`, `PUT /api/provider-routes`를 통해 이름/baseURL/model/역할/우선순위/단가·한도/상태를 화면에서 관리한다. 역할은 `normalize`, `niche_analysis`, `sourcing_analysis`, `rfq_draft`. 계산과 기준 변경·외부 연락은 AI 역할에 포함하지 않는다.
- OpenAI-compatible Chat Completions API를 초기 커스텀 protocol `openai_chat_completions`로 지원한다. baseURL은 `/v1` 등 제공자가 문서화한 API root를 입력받고 `chat/completions` path를 붙인다; 모델 이름은 수동 입력, 모델목록 자동 조회로 숨은 외부 호출을 만들지 않는다. 출력은 JSON schema/Zod 검증 후 근거 참조를 확인한다. 비호환 제공자에 성공 응답을 가장하지 않고 `PROVIDER_PROTOCOL_UNSUPPORTED`를 보여준다.
- `register`는 disabled 상태로 저장하며 신규 활성화는 Jay 승인 필수다. 테스트 버튼은 요청 destination/model/최대 토큰/예상 비용 및 전송할 합성문장을 보여주는 일회성 test 권한을 받는다. activation 전 테스트 허가는 test 작업 1건에만 유효하고 일반 router는 여전히 차단한다. 비용 단가/최대 청구량을 알 수 없으면 test도 유료 승인 전 차단한다.
- router는 역할에 연결된 활성·승인·허용 protocol 제공자만 우선순위로 선택한다. 이미 승인된 차순위만 fallback하며 새 제공자를 자동 활성화하지 않는다. 재시도/fallback 각각 공통 budget/attempt를 통과한다. 모두 불가이면 AI 작업 대기; CSV/규칙/손익/고정 RFQ 템플릿은 계속 동작한다. 모델 출력의 설정 변경 지시나 URL 접속 지시를 실행하지 않는다.
- ChatGPT와 Grok는 UI에서 `not_authorized`/“공식 연동 확인 전 사용 불가” 상태로 보이며 라우팅 후보에 포함하지 않는다. https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt 는 identity 공유이지 모델 토큰/과금 사용 허가가 아니다. https://docs.x.ai/developers/faq/accounts 는 Grok/API 과금 분리를 명시하고, https://x.ai/news/grok-opencode 의 구독 OAuth는 OpenCode용 근거이며 본 앱의 일반 사용 허가로 전용하지 않는다.
- P1의 `SubscriptionCapability = {provider,clientId,allowedUse,scopes,officialEvidenceUrl,verifiedAt,status}` registry를 코어 밖에 둔다. 본 앱 사용을 명시적으로 허용하는 공식 client 등록·scope·상용 무인 사용 근거가 전부 있어야 추후 활성화 심사 가능하다. 미확인인 현재는 adapter 실행파일/토큰 저장/로그인 URL 생성 자체를 하지 않는다. 비활성 adapter를 import/spawn하지 않고 네트워크·키 조회 전 guard로 `SUBSCRIPTION_NOT_AUTHORIZED` 반환한다. 비공식 client ID 위장·기존 CLI token/profile 가져오기 금지.

### 8. 무인 일정과 승인 범위
- `apps/worker/src/planner.ts`의 `runDailyPlanner(now):Promise<DailyRunResult>`는 IANA timezone 기준 `(schedule,localDate)` UNIQUE로 하루 계획을 한 번 만든다. 실행가능 후보를 `lastProgressAt` 오래된 순→ID로 공정하게 순회하고 DB에 고정된 규칙/예산/전이표로 다음 단계를 선정한다. AI에게 큐/예산 제어권을 주지 않는다.
- Oracle systemd `forge-ops-scheduler.timer`가 1분마다 짧은 scheduler 명령을 실행한다. 명령은 DB의 변경 가능한 schedule settings와 마지막 실행키를 보고 00:10 Asia/Seoul 데일리 계획, 08:00 요약을 enqueue한다. OS timezone은 바꾸지 않는다. timer `Persistent=true` + daily key로 다운타임 이후 누락 하루를 한 번 이어가고 과거 일수만큼 이메일을 몰아 보내지 않는다.
- 승인된 외부 작업·새 회신·세션 복구·설정 변경은 이벤트로 후보를 재개한다. 일일 계획 외에도 worker는 24/7 계속 수행한다. 승인/근거/세션 대기는 큐 job을 무한 실행시켜 슬롯을 점유하지 않고 blocked 상태로 반환한다.
- 아침 요약은 진행 후보 수/확인된 탈락 이유/승인 대기/알 수 없는 것/비용 예약과 실사용을 한국어로 보여주며 앱에도 저장한다. 처음에 수신주소·발신 계정·08:00 반복·템플릿 필드 범위를 승인받은 뒤 범위 내 요약은 매일 자동 발송한다. 수신자 변경·새 채널·외부 공유는 기존 승인 범위를 벗어나므로 재승인 필요. 외부 메일 미승인·장애는 앱 내부 생성과 후보 진행을 막지 않는다.
- 네 가지 업무 승인 외에 로그인·CSV 최초 선택·계정 연결은 초기 준비/복구 행위다. 지원되지 않는 외부 접근을 사람 작업으로 숨겨 무인 합격이라 하지 않는다. 실제 최종 시나리오는 사전 연결·예산·정기 요약 승인 완료 상태에서 검증하며 이후 필요한 사람 행동은 견적 연락 2건 승인뿐이다.

### 9. 비밀정보·인증·네트워크·백업
- Better Auth는 관리자 1명만 설정, public signup 비활성. 최초 계정은 배포자가 일회성 관리 bootstrap을 Tailscale 경유 서버에서 실행해 생성하고 비밀번호를 CLI 인자/로그로 남기지 않는다. 최초 비밀번호+TOTP 등록이 끝나기 전 업무 API 접근 차단. password hashing은 라이브러리의 검증된 기본 구현을 사용한다.
- 계정+IP별 DB 로그인 실패 이력: 15분 내 5회 실패하면 15분 잠금. TOTP 시도도 동일 throttle, 재부팅 후 유지. 존재하지 않는 계정도 동일 일반 오류. trusted device는 임의 토큰의 hash+만료(30일)·기기 목록·철회, session 12h absolute 만료. 비밀번호/2FA 재설정은 세션·신뢰기기를 모두 폐기하고 일회용 복구코드는 hash 저장한다. 기기 기억과 로그인 유지는 별개로 표시한다.
- cookie는 Secure/HttpOnly/SameSite=Lax, 엄격한 origin whitelist와 CSRF 검증. CORS `*` 금지, 관리자 API는 세션과 권한을 서버에서 재검증한다. 정적 UI가 공개로 내려가도 인증 데이터는 못 얻어야 한다. worker/API 계정은 원본 secret을 필요할 때만 복호화하며 UI의 secret DTO는 `{configured,last4}`만 허용한다.
- `packages/security/src/secrets.ts`는 AES-256-GCM + 난수 nonce + keyVersion + owner/provider/field AAD로 암호화한다. master key는 Git/DB 밖 root 소유 systemd credential로 관리한다. key 불일치/변조 시 연결 차단, 평문 fallback 없음. auth secret과 데이터 encryption key를 분리하고 복원용 key escrow도 DB 백업과 분리·암호화해 운영자에게 인계한다.
- Fastify/Pino는 request/response body 로깅을 기본 금지, Authorization/Cookie/Set-Cookie/token/apiKey/password 및 error cause/raw provider payload를 중앙 차단한다. API error는 `{code,message,requestId}` whitelist만; SQL 바인딩/stack trace는 사용자 응답에 포함하지 않는다. 감사 로그는 행위자/시간/대상/승인 hash/안전한 상태 변경만 저장하고 key 변경은 값 대신 `secretUpdated:true`로 기록한다. CSV·견적·메일 원문은 업무 저장소에만 보존하고 CI evidence는 합성 또는 완전 비식별 자료만 사용한다.
- 커스텀 HTTP는 `packages/security/src/egress.ts` 한 경로로: `https:`만, URL userinfo/fragment/비허용 port/동적 redirect 금지, hostname IDNA 정규화, 모든 A/AAAA 주소가 공인일 때만 승인. RFC1918/loopback/link-local/metadata/ULA/multicast/unspecified/예약범위 및 IPv4-mapped IPv6를 차단한다. DNS 검증 후 같은 해석 IP에 연결을 pin하고 TLS SNI/인증서 hostname 검증은 원래 host로 유지하여 DNS rebinding을 막는다. 인증 헤더는 해당 origin에만 붙인다.
- 고정 공식 JS/메일/백업 origin과 승인된 커스텀 origin을 구분한다. provider baseURL/model/secret 변경은 기존 활성화 fingerprint를 무효화하여 재승인 전 호출 불가. 비활성화는 즉시 신규 예약을 막고 이미 dispatch된 요청은 “진행 중”으로 명시한다. 서버 DNS·내부 IP를 secret 입력 오류에 돌려주지 않는다.
- 브라우저·CSV·공급처 회신의 prompt injection은 데이터로만 처리한다. AI 입력은 해당 역할에 필요한 수치·비식별 사양만 제공; 공급처 연락처/전체 CSV/브라우저 쿠키/회사 비밀을 임의 제공자에게 통째로 보내지 않는다. 활성화 승인 화면에 전달 데이터 범주와 해당 제공자 보관 정책을 표시하고 정책 미확인은 알려준다.
- API/worker는 별도 unprivileged OS 계정, `NoNewPrivileges`, `ProtectSystem=strict`, 제한된 `ReadWritePaths`, capability 비우기, DB 역할 분리; DB는 localhost socket만 듣고 public 5432 금지. SSH는 Tailscale을 통한 승인된 관리자만, 기존 공유 호스트 방화벽·서비스를 전역 초기화하지 않는다. cloudflared는 localhost API만 노출하고 공개 raw MCP 포트 금지.
- 백업은 매일 pg_dump custom format + role/grant 재생성 명세 + 암호화 원본 blob manifest/hash를 같은 완료된 snapshot manifest로 묶어 암호화 R2 업로드한다. immutable source/blob 덕분에 dump가 참조한 파일을 모두 포함시켜 일관성을 보장한다. 파일 누락이면 백업 실패이지 성공 badge 금지. 일일본 30일 보관을 기본안으로 하되 retention 삭제 정책 승인이 없으면 자동 삭제를 켜지 않는다. 목표 RPO 24h, RTO 4h는 목표이며 복원 리허설 시간으로 실측한다. DB·blob·복호화 키를 복원하여 후보/견적/승인 이력이 재현되어야 합격이다.

### 10. Oracle 전용 production 권한과 배포
- 구버전 기록에는 Ubuntu 24.04 ARM64 대상, 공유 호스트이며 프로세스 kill 복구는 실측했지만 재부팅은 미실시다. 실제 설치 전 승인된 read-only preflight로 OS/아키텍처/여유 메모리·디스크/기존 포트·서비스를 확인한다. 다른 앱·구버전 서비스를 임의 중단하지 않는다. 새 서비스명/경로는 `forge-ops-*`, `/opt/forge-ops/releases/<commit>`와 `/opt/forge-ops/current`, `/etc/forge-ops`로 분리한다.
- `APP_ENV=production`의 worker는 Linux + systemd invocation + root 소유 `/etc/forge-ops/worker-authority.json` + DB `deployment_identity.environment='production'`/승인된 worker identity가 전부 일치할 때만 큐 연결한다. 단순 env flag만으로 허용하지 않는다. production DB는 Oracle localhost Unix socket + 해당 worker OS 사용자에 한정한 peer authentication/DB role로 claim을 허용한다. 개발 role/API producer는 큐 SELECT/UPDATE claim 권한을 갖지 않는다. production worker 자격증명은 Windows/CI에 두지 않고 로컬 런처는 localhost dev DB+`environment='development'`까지 검사한다.
- systemd `forge-ops-api.service`, `forge-ops-worker.service`, `forge-ops-scheduler.service/.timer`, `forge-ops-backup.service/.timer`, cloudflared 연결을 전용 설정한다. worker `Restart=always,RestartSec=5,TimeoutStopSec=90`; graceful shutdown은 새 claim 중지→진행 attempt 상태 보존→종료. start script에서도 authority 검사해 직접 실행 우회 방지. pg-boss schema migration은 별도 migration role로만 배포 단계 수행하고 runtime `migrate:false`.
- CI는 GitHub Actions에서 PR별 로컬 합성 데이터 검증/build, production credential 없음, untrusted fork에 비밀정보 없음. 의미 있는 마일스톤마다 새 공개 저장소에 커밋·푸시하되 소스/합성 fixture/비식별 문서만. production 배포는 `workflow_dispatch` + 보호된 environment의 Jay 승인 또는 같은 release digest에 대한 명시적 승인 후에만 실행하고 main push가 자동 배포되지 않게 한다.
- artifact는 commit SHA·checksum으로 고정한다. Oracle 설치는 승인된 Tailscale 접속에서 release 검증→DB 백업→additive migration→서비스 atomic symlink 전환→health 확인. Cloudflare edge/UI도 같은 release contract로 배포한다. 롤백은 직전 코드 release로만, migration 역삭제/DB reset/원본 삭제 금지. 호환 schema 범위를 CI에서 검증하고 구코드와 호환 불가한 변경은 새 migration으로 전진 수정한다.
- 공유 호스트 재부팅은 배포 승인과 별도로 영향/시각을 명시해 승인받고 실제 reboot 전후 uptime/부팅 ID와 자동 기동·남은 job 처리·외부 attempt를 실측한다. 승인 없으면 process kill/로컬 복구만 실행하고 요구 5 재부팅 합격은 대기로 남긴다. 외부 계정/비용/브라우저가 준비되지 않았다는 이유로 dev worker를 production 대체 소비자로 쓰지 않는다.

## 마일스톤과 합격 기준
규모는 상대적인 업무 범위이며 완료 날짜 약속이 아니다. 각 마일스톤은 계약 재독→정해진 인수 시나리오 실행→증거 보고→다음 단계 순서다. 합격 후 이미 통과한 범위를 취향 때문에 다시 설계하지 않는다. 외부 승인이 없어 실측하지 못한 항목은 로컬 통과와 분리해 대기로 남긴다.

| 단계 | 산출물·의존성 | 합격 기준 매핑 | 예상 규모 |
|---|---|---|---|
| M0 디자인·운영 계약 | PLAN/QUESTIONS/PRODUCT/DESIGN, 대표 화면 시안, 승인 범위, 공식 연동 가능/대기 표. 애플리케이션 코드 전 디자인 승인. | 요구 6 선승인, F11 예쁜 UI 기준, 이전 실패 1/2/3/6 방지 | 중 |
| M1 20후보 수직 연결 | 로컬 한 명령 실행, 인증·근거 타입·DB·설정 UI, CSV→20후보→독립 큐 처리→후보 화면. 이미 유료 호출 차단/secret 정책 포함. | 요구 1 전체, 요구 6 문법, 요구 10 기본 인증, 실패 4/5/7/9/11/12 | 대 |
| M2 실제 리서치·공식 검증 | 저장 검색·브라우저/수동 CSV, 공식 5 endpoint, cache/DB 예산·attempt·재시작 안전성. M1 필요. | 요구 2/3, 실패 8/10. API 미승인 시 local simulator만 합격, 실제 계정 검증은 대기 | 대 |
| M3 소싱·견적·결정 | 사양 revision, 실제 공급처 수집, RFQ 초안·승인·전송/회신, 2견적 손익·현금·발주 판단. M1 계약 기반, M2 완료 후보 연결. | 요구 4 전체, 요구 9의 연락/발주 승인, F11 견적 화면 | 대 |
| M4 AI 설정·무인 운영 | 제공자 2개·역할/우선순위/승인·테스트·비활성, planner·메일함·정기 요약, OAuth fail-closed 격리. | 요구 7 비활성 증명/8/9. P1 허용 근거 없으면 비활성 자체가 요구 7 합격 | 대 |
| M5 보안·화면 인수 | SSRF/누출/2FA/승인 경계·복원, 한글/영문·3폭·비개발 제3자 흐름·대표화면 시각 검수. | 요구 6/10 전체와 F11; 구현된 기능의 실제 인수, 별도 뒤늦은 리디자인 아님 | 중 |
| M6 Oracle/Cloudflare 실운영 | 승인된 release 배포, Oracle만 소비, 실제 kill/reboot/백업복원, 밤→아침 최종 시나리오. | 요구 5 전체, 1–10 end-to-end 및 F11 최종 확인 | 중~대 |

### 계약 합격 문장 — 그대로 검증 포인트로 사용
1. 서로 다른 키워드 20행짜리 CSV 하나가 한 번의 업로드로 20개 후보가 되고, 각 후보가 [현재 단계 / 근거 / 모르는 것 / 다음 행동 1개]를 가진 채 화면에 보인다.
2. 실제 검색 → CSV → 임포트가 UI에서 3클릭 이내, 출처 추적 가능.
3. 예산 소진 시 추가 호출 0 / 워커 재시작 후 중복 유료 호출 0 / 캐시 히트 시 wire call 0.
4. 견적 2건 입력 → 자동 손익·현금 계산 → 기준 대비 판정이 화면에 재현.
5. 재부팅/프로세스 kill 테스트로 자동 복구를 실측.
6. 개발 지식 없는 제3자가 설명서 없이 후보 1개를 발굴부터 견적 대기까지 진행.
7. 미인가 구독 어댑터가 유료·외부 호출을 하나도 못 한다는 것을 테스트로 증명.
8. 프로바이더 2개 등록 → 역할 분기 동작 → 테스트 성공, 키 유출 경로 0.
9. 하루 스케줄 실행에서 사람 조작 0으로 후보들이 단계 전진 + 아침 요약 알림 수신.
10. 보안 체크리스트 전 항목을 실측으로 통과.
11. 추가 F11: 승인한 디자인 체계로 만든 예쁜 프론트엔드가 대표 화면 및 375/768/1280 실제 렌더링에서 검수되고 Jay의 시각 승인을 받는다.

## Verification
지금 계획 단계에서는 아래 프로그램/테스트/화면은 **아직 존재하지 않으며 실행하지 않았다**. 구현자가 아래 명령과 관측 결과를 제공해야 한다. 외부 서비스 simulator는 비용/장애/경계 검증용만 사용하고 실제 리서치·전송·배포 성공 증거를 대체하지 않는다. 정상 흐름 smoke는 실행용 임시 시나리오로; 아래 회귀 위험(unknown, 이중송신, 병렬예산, 권한우회)은 지속 테스트로 남긴다.
계획 단계에서 실제 수행한 검증은 계약/저장소/공식 문서 조사와 아래 A/B 손익 예시의 독립 Decimal 계산이다. 계산 결과 A: 전14·후12·46.67%/40.00%·ROI200%·현금2600, B: 전15·후13·50.00%/43.33%·ROI260%·현금3800을 확인했다. 이는 식의 산술 검증이며 아직 없는 앱의 동작 합격은 아니다.

### 로컬 실행 계약과 증거
- cwd는 신규 `AmazonResearchbot` 루트. 사전 Node 24/pnpm/Docker Desktop 준비, production credential 없는 local env, 로컬 Postgres·Mailpit 사용. 루트 `pnpm dev` → `http://localhost:5173`, API `http://localhost:3001`, Mailpit `http://localhost:8025`. `APP_ENV=development`, 실제 외부 HTTP는 deny. `pnpm verify:local -- --scenario all`은 아래 위험별 사례를 로컬 실제 API/워커/DB 경로로 실행하고 scenario별 관측 결과를 출력한다. 아직 없는 script는 M1에서 이 계약대로 제공한다.
- `pnpm verify:local -- --scenario csv20`: 합성 CSV `tests/fixtures/opportunity-finder-20.csv`의 20개 서로 다른 keyword 업로드→20후보 화면/각 nextAction 1개/원본 bytes hash·행 연결 확인. 한 후보를 web_session 대기로 만들고 나머지 19개가 전진하는지 관측. 같은 파일 재업로드는 40개가 아닌 동일 20개. 실제 export fixture는 별도 권한/비식별 처리 후 검증하며 합성 CSV와 명확히 구분.
- `pnpm verify:local -- --scenario evidence`: numeric missing/null/`< 450`/빈칸이 0·450 exact·pass로 바뀌지 않음. `< 450`은 numeric unknown + 원문 상한 설명으로 보존. 리뷰 2000+ 상품 2개면 다른 4규칙 pass여도 reject; 1개면 이 hard-fail 없음. pass3/unknown2는 pass가 아닌 evidence 작업; 1위 가격 17/80 inclusive, 점유율 정확히35/55는 `<` 미충족. 같은 parent 3개 variation의 매출이 세 번 더해지지 않음.
- `pnpm verify:local -- --scenario budget`: 새 로컬 DB에서 cap3/동시 20개 서로 다른 요청→local HTTP 수신기 실제 request 최대3; cap0→0. 동일 query 동시20→wire1, cache 재실행→0. 429→500→200은 예산3 소모, 예산2라면 세 번째 wire0. DB 실패→외부0. local HTTP 요청 수신 후 응답 보류 시 worker 강제 종료/재시작→같은 logical 작업 중복 송신0/unknown 표시. 응답 저장·캐시 저장·job ack 사이 사망도 재과금0. UTC 자정·cache version/sort/cursor 분리도 검증.
- `pnpm verify:local -- --scenario economics`: 동일 사양 견적 A는 판매가30, 도착원가6, FBA4.50, referral4.50, 광고2, 반품손실0.50, 기타변동0.50, 수량300, 별도선지급200, 초기광고현금300, 예비비300(USD). 광고 전 이익14/마진46.67%, 광고 후12/40.00%, ROI200.00%, 출시현금2600→GO. 견적 B는 도착원가5/수량600만 다름: 전15/50%, 후13/43.33%, ROI260%, 출시현금3800→예산초과 CAUTION. A단가6+BMOQ600 또는 B단가5+AMOQ300의 가짜 견적이 생성되지 않아야 한다. A 운임 unknown이면 계산·GO 불가, 견적없음은 탈락 아님. A 승인예약2600 후 동일 예산에서 다른2600 발주판단 승인 차단.
- `pnpm verify:local -- --scenario approvals`: 연락 초안2건 미승인→메일0, 승인 후 local Mailpit 수신 정확히2, 후보 견적대기. double click/worker kill→중복0. 승인 후 수신인·수량·본문 변조→409 APPROVAL_STALE/전송0. 설정에서 launchBudgetUsd 3000→2500 승인→다음 실행의 A는 CAUTION, 이전평가 오래됨 표시; 미승인/AI 제안만으로 설정 불변.
- `pnpm verify:local -- --scenario providers`: 공개망 대신 test 전용 transport의 local model endpoints 2개를 등록하고 normalize는A/rfq_draft는B의 서로 구별되는 유효 결과를 관측. 신규 미승인/비활성 endpoint는 수신0, 테스트 승인권한은 test1건에만 사용, 첫 제공자 실패 시 승인된 차순위만 사용. 키 sentinel이 성공/실패/timeout/DB 오류의 UI/JSON/log/audit/build output에 평문으로 나오지 않음. OAuth registry를 강제로 선택하는 요청도 adapter process 시작0/DNS0/HTTP0/secret 조회0. production transport에 local 테스트 예외를 넣지 않는다.
- `pnpm verify:local -- --scenario security`: wrong password/TOTP 5회 잠금과 재시작 지속, 2FA 미등록/미완료 세션 거부, trusted device 철회/복구코드 재사용 실패; 승인 API CSRF·다른 origin·비로그인·stale revision 거부. HTTP redirect/localhost/169.254.169.254/IPv6 loopback/mapped IPv4/public DNS→private 재바인딩/URL userinfo 차단을 수신기·DNS 관측으로 입증. CSV·회신의 HTML/script/prompt injection이 렌더링·외부 연락·예산 변경을 유발하지 않음. 암호문 tamper와 key 없음은 fail-closed.
- `pnpm verify:local -- --scenario overnight`: fake clock으로 localDate 00:10→08:00을 진행하되 실제 API·DB·worker·Mailpit으로 20후보를 처리한다. 사전 연결과 정기요약 승인 이후 사용자 HTTP mutation0인 동안 여러 후보가 API/소싱/RFQ 승인대기까지 전진; local 아침 요약1건. 중복 timer/중간 재시작도 daily_run/요약 중복0. 이 단축 시계 검증을 실제 하룻밤 실증이라고 부르지 않는다.
- 웹 실측은 제공된 BrowserOS neo task-owned tab으로 로컬 UI를 열어 수행한다. 도구가 없으면 headless UI screenshot을 보았다고 하지 않고 API/접근성 자동 결과와 미실측 화면을 구분한다. 구현 환경에 실제 browser 도구가 제공될 때 `/`, `/candidates/:id`, `/sourcing`, `/settings`를 375/768/1280로 촬영한다. 한국어 긴 keyword/영어/빈 상태/오류/미확인/키보드-only/200% 확대를 포함. WCAG AA 대비(본문4.5:1, 큰 글자·주요 UI3:1), focus/label/읽기순서/스크린리더와 F11 시안 대조표. 비개발 제3자의 설명서 없는 발굴→견적 대기 수행은 실제 관찰 기록으로, 에이전트 단독 성공으로 대체하지 않는다.

### 승인 후 실제 외부·production 증거
- live prerequisites: 실제 OF export 권한/로그인 BrowserOS/CSV 다운로드 능력, API key+market entitlement+일일 호출 및 과금 상한 승인, 공급처 수집 허용 범위, 활성 AI 제공자2개·테스트 소액 승인, 업무 메일함/수신 Jay/반복 요약 승인, 견적2건 전송별 승인, Oracle·Cloudflare·DNS·R2 배포 권한. 비밀값은 QUESTIONS.md에 적지 않고 앱의 write-only 입력 또는 승인된 secret 저장 경로로 전달한다.
- `pnpm verify:live -- --scenario research --approval-id <id>`: 이 명령은 자동 승인 생성 금지, 기존 범위·만료·잔여 cap 검증 후 실제 검색→CSV→20후보와 필요한 공식 API만 사용. 정확한 click 수, 원본 hash/row 연결, 응답 source/evidence와 wire/예약 수를 비식별 보고한다. 미준비 계정은 무엇이 없는지 기록하고 외부 합격을 보류한다.
- `pnpm verify:live -- --scenario providers --approval-id <id>`: 실 provider2개 연결/역할별 결과·제한된 유료 test 성공/비밀정보 누출 점검. 시험 허가를 일반 무제한 AI 실행으로 전용하지 않는다.
- production cwd `/opt/forge-ops/current`: `systemctl is-enabled forge-ops-worker.service forge-ops-scheduler.timer`, `systemctl is-active forge-ops-worker.service`, `pnpm verify:authority`(dev/API role로 claim→권한거부, production worker만 성공), `pnpm verify:restore -- --target isolated`(새 격리 DB/업로드 storage로 복원, 기존데이터 덮어쓰기 없음). 명령은 신규 배포 script가 제공해야 하는 인터페이스다.
- 승인된 시각에 `sudo systemctl kill --kill-whom=main --signal=SIGKILL forge-ops-worker.service` → MainPID 변경·자동 active·미완료 단계 재개·중복 wire0. 별도 승인 후 `sudo systemctl reboot` → boot ID 변경·서비스 자동 시작·큐 및 ledger 복구. reboot 승인이 없으면 enabled 상태만으로 요구 5 합격 불가. 복구 검증용 유료 요청은 쓰지 않고 실제 worker에 local-only 계산 job과 이미 기록된 완료/불확실 attempt를 사용한다.
- 최종 인수 문장 그대로: **“새 CSV 20행 업로드 → 밤새 무인으로 필터·API 검증·소싱 후보 수집 → 아침에 이메일 요약 수신 → 화면에서 견적 초안 2건 승인 → 승인된 후보가 견적 대기 단계로 이동”**. 실제 날짜·Jay 메일 수신·2개 공급처 전송 receipt·화면 상태·승인 audit를 서로 연결해서 증명한다. 자동 단계에서 계정/예산/웹 세션이 없으면 안전한 대기 동작은 확인하되 최종 완료라고 보고하지 않는다.

## Critical files & anchors
아래 기존 파일만 외부 사실의 재확인 앵커다. 신규 구현 경로는 Approach에서 지정했다. 구현자는 수정 전에 최신 파일을 다시 읽는다.
- `계약서-SPEC.md` 요구사항1–10/리서치 규칙/이전 실패/최종 시나리오: 실제 합격 기준의 권위.
- `C:/Users/hyj53/Documents/amazon research agent/review-logs/2026-09-05-oracle-worker-production-correction.md` Outcome·Live runtime·Preservation: Windows/Oracle 이중소비 및 reboot 미실측 근거.
- `C:/Users/hyj53/Documents/amazon research agent/docs/deployment/oracle.md` Host setup·systemd: 공유 호스트 보존과 ARM64 대상 근거. 새 구조 복사 용도로 쓰지 않는다.

## Assumptions & contingencies
- Q1–Q8은 위 기본안을 사용하고 D1은 사용자 확정이다. 기존 업무 데이터 보존, 상품 시장/ROI/운영비 경계가 바뀌면 설정 version과 이후 평가만 바꾸고 과거 근거를 수정하지 않는다.
- 현재 시스템은 single-owner 운영 도구다. 실제 운영비/계정·도메인·인프라 상태는 미확인이며 비용/외부 행위 승인 전 로컬 구현만 진행한다. 공유 Oracle에 새 DB를 둘 여유가 없으면 기존 서비스를 건드리거나 새 유료 인스턴스를 자동 생성하지 않고 로컬 Postgres 검증을 완료한 채 배포 자원 승인을 기다린다.
- 브라우저 상시 가용은 보장하지 않는다. PC가 잠들어도 Oracle의 API/계산/이미 확보한 자료 처리/알림은 계속되지만 로그인 웹 작업은 대기한다. 24/7 웹 발굴까지 원하면 별도 항상 켜진 브라우저 기기/허용 계정 세션이 필요하다. 본 기본안은 사용자 profile의 서버 복사를 선택하지 않는다.
- 공식 OAuth가 본 앱에 허용되지 않거나 증거가 모호하면 P1은 영구 비활성 상태로 코어 완료 가능하다. 허가 확인 없이 “구독 연결 가능”이라 약속하거나 API 요금을 구독에 포함해 계산하지 않는다.
- 실제 유출 위험을 수학적으로 0이라고 보증하지 않는다. 계약의 “유출 0”은 명시한 경로의 실측 차단·비밀값 미노출·외부 전달 최소화로 검증하고 미검증 경로를 공개한다. 실제 보안/디자인/제3자 사용성/production 합격 미실측은 완료로 처리하지 않는다.
- 계획 승인(2026-09-06) 후 쓰기 범위는 루트 운영 문서와 정적 시안이다. `PLAN.md` `QUESTIONS.md` `PRODUCT.md` `DESIGN.md` `design/screens.html` `docs/verification.md`를 기록했다. 디자인 승인(문서 hash·시점) 전에는 애플리케이션 코드를 작성하지 않는다. 유료 호출·외부 전송·프로덕션 배포·데이터 삭제는 별도 승인이다.

