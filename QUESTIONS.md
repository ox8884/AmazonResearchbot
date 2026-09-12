# QUESTIONS — Forge Kitchen Ops

기록 규칙: 날짜 / 질문 / 기본안 / 그 기본안으로 진행한 내용 / 응답·승인 상태. 비밀값·키·서버 식별자·실제 연락처는 적지 않는다. 질문 기본안은 지출·외부 전송·배포 승인이 아니다.

## 질문과 기본안

| 날짜 | ID | 질문 | 기본안 | 실제 진행 | 응답·승인 상태 |
|---|---|---|---|---|---|
| 2026-09-06 | Q1 | 첫 판매 시장은? | Amazon US·USD·주방용품. 시장별 수수료/규격 분리. | PRODUCT.md·DESIGN.md 초기값 `marketplace:'us'`, `currency:'USD'` | 답변 없음, 기본안 |
| 2026-09-06 | Q2 | ROI 150% 계산 기준은? | 광고 후 단위 기여이익 ÷ 단위 도착원가 × 100. 출시 현금 한도 별도. | PLAN 공식·합성 견적 A/B Decimal 확인. 설정 시안에 표시 | 답변 없음, 기본안 |
| 2026-09-06 | Q3 | 시스템 운영비를 출시 $3,000에 포함하는가? | 상품 출시 현금과 별도. 호출/비용 상한 미승인 시 유료 호출 차단. | 유료 호출 0. 일일 API cap 미승인=0으로 설계 | 답변 없음, 지출 미승인 |
| 2026-09-06 | Q4 | 기존 데이터를 이관하는가? | 새 업무 데이터로 시작, 기존 데이터 보존. 이관은 별도 승인. | 이관·삭제 없음. 구버전은 외부 사실만 참고 | 답변 없음, 이관 미승인 |
| 2026-09-06 | Q5 | 아침 요약 시간/채널은? | Asia/Seoul 08:00 이메일. 발신·수신·반복범위 승인 전 앱 내부 생성만. | 발송 0. 설정 시안에 시각만 표시 | 계정·반복발송 승인 대기 |
| 2026-09-06 | Q6 | 로그인 브라우저가 없으면? | 웹 확인 대기, 다른 후보 계속, 세션 복구 후 재개. 쿠키 복사/인증 우회 금지. | 시안 문구 “웹 연결을 기다리고 있어요”. 실제 세션 미실행 | 기본안, 실연결 미확인 |
| 2026-09-06 | Q7 | 공급처 연락 채널은? | 공개 업무용 이메일 우선. Alibaba 내부 전용이면 허용된 실제 브라우저. 수신·사양·수량·본문별 승인. | 외부 연락 0. 시안 승인 버튼은 전송하지 않음 | 계정·개별 전송 승인 대기 |
| 2026-09-06 | Q8 | 자동 구매·결제까지 하는가? | 발주 판단 자료와 결정 기록까지. 실제 구매/결제 실행 제외. | PRODUCT.md 경계. 결제 버튼 없음 | 답변 없음, 기본안 |

## 사용자 확정 결정

| 날짜 | ID | 요청 | 결정 | 실제 진행 |
|---|---|---|---|---|
| 2026-09-06 | D1 | 프론트 엔드 예쁘게 만들 것 | 쉬운 사용성과 별도 F11 시각 품질. 디자인 선승인, 375·768·1280 검수, Jay 시각 승인. | DESIGN.md·시안 작성 후 Jay 승인 |
| 2026-09-06 | D2 | Plan approved | 실행 계획 승인. 디자인 승인과는 별개. | 루트 PLAN.md 기록. M0 문서 작성 |
| 2026-09-06 | D3 | 시안 그대로 승인 | DESIGN.md hash `f4e17fadeee52bcddc1a96fa164866c3b735e1c69a182135fb9bab3725cec9c5` 기록. M1 시작. | 로컬 앱 기동. `pnpm verify:local -- --scenario csv20` 후보 20, 재업로드 20, 독립 대기, wire 0 |

## 조사로 고정한 기술 선택 (승인 대상 아님, 계획에 포함)

- 공개 GitHub `ox8884/AmazonResearchbot`. 업무 데이터/키/백업 커밋 금지.
- UI: React + Vite SPA. 엣지: Cloudflare Workers Static Assets + `/api/*` 프록시.
- API/워커: Fastify, Postgres 17, pg-boss, Better Auth email/password + TOTP.
- 로컬: `pnpm dev` 한 번 (Postgres·Mailpit·web·api·worker).
- ChatGPT/Grok 구독 OAuth는 본 앱 허가 근거 전까지 fail-closed.

## 승인·준비 대기
1. 디자인 시스템 — Jay 승인됨 (D3).
2. Jungle Scout 웹/CSV/API 권한, 일일 호출·과금 상한.
3. 신규 AI 제공자 활성화·테스트 호출 범위.
4. 업무 이메일 계정·Jay 수신주소·매일 반복 요약 발송 범위.
5. 견적 요청 각각의 실제 수신인/본문/사양/수량.
6. Oracle/Cloudflare/DNS/R2 배포와 비용, 공유 Oracle 재부팅 시각(배포와 별도).
7. BrowserOS neo 실제 연결, 제3자 사용성 확인, 완성 화면 시각 승인(F11 최종).

## 이번 기록에서 한 일 / 하지 않은 일

한 일: M0 문서·시안 승인. M1 로컬 스택. csv20 후보 20. M2 로컬 JS 시뮬레이터: 예산 cap3/cap0, 동일쿼리 wire1, 재시작 재전송 0, 근거 unknown 보존. 소스 GitHub `main`. 실제 정글스카웃 호출 0.

하지 않은 일: 유료 API, 이메일/업체 연락, production 배포, 데이터 이관/삭제.


## 2026-09-06 후속 — 견적 입력·계산
- Jay가 프론트 개선을 확인하고, 견적 기능에 필요한 API·도메인·DB 로컬 구현을 승인했다.
- 수동 견적 입력/저장/계산/사양별 비교 구현 및 로컬 실측 완료. 독립 코드·시각 검토 PASS. 증거: docs/verification-quotes.md.
- 실제 공급처 연락, RFQ 회신 수집, 발주 판단/현금 예약, 유료 호출·배포는 이번 완료 범위가 아니다. 기존 승인 대기를 유지한다.


### Jay 귀가 후 운영 설정 확정 (별도 대화)
- 공식 Jungle Scout API 사용, 하루 최대20회로 명시 승인. main settings v2와 .env cap20 저장. 기타 누락 기준은 그대로 미확인 유지.
- America/Chicago 03:00 리서치 시작, 07:30 요약. 지정 Gmail 주소는 로컬 DB summaryEmail에 보관. Alibaba 등은 사이트 로그인 후 직접 연락. 자동 일정/발송이 구현·연결됐다는 뜻은 아님.
- 루트 .env.junglescout 준비: JS_API_KEY_NAME / JS_API_KEY. Git 제외, dev 시작 시 허용된 두 키만 서버 환경에 로드. 아직 키 입력/외부 호출 없음.
- 설정→커스텀 AI 화면, 암호화 키·주소·모델·일일 비용 초안 저장/편집 구현. 0015_custom_ai_profiles.sql만 main에 적용. 활성화/연결 테스트/실제 AI 호출은 미구현·비활성.
- API 회귀·설정 검증·웹 build PASS. IAB에서 저장→재로그인→복원 및 375/768/1280 화면 확인. 메인 작업의 서버/하위 에이전트는 건드리지 않음. 새 API는 메인 재기동 시 반영 필요.
- 동시 메인 작업의 saved-search-routes.ts rootDir 오류 및 authorize-attempt.ts 미정의 err로 API 전체 typecheck는 미통과. 해당 파일은 수정하지 않음.


### 2026-09-07 Composio Gmail·로그인 바로가기 (별도 대화 요청)
- /settings/connections 추가. Composio Gmail 전용 세션 생성→호스팅 인증 링크→서버 인증 상태·실제 Gmail 프로필 주소 확인 구현. 세션/MCP주소/인증링크 암호화 저장, 계정 소유권과 지정 업무 주소 불일치 차단. Callback 쿼리를 인증 증거로 사용하지 않음.
- .env.composio의 COMPOSIO_API_KEY만 서버 시작에 로드. 현재 키 미입력으로 실제 OAuth 미실행. SDK 추가·유료 호출·실제 메일 전송/수신 없음. 생성된 MCP 세션은 서버 저장되며 기존 자동 요약·회신 워커에 연결하는 작업은 아직 남음.
- Alibaba/Jungle Scout 앱 바로가기 및 바탕화면 Forge Kitchen 폴더의 .url 2개 생성. 일반 브라우저 프로필이 사이트 쿠키를 보관; 앱에는 쿠키 복사/인증 우회/클릭만으로 로그인 완료 표시 없음. 웹 자동화 bridge 연동은 별도 미완료.
- 0016만 main DB 적용. 메인 서버/하위 에이전트에 접촉하거나 재시작하지 않음. 다음 메인 재시작에서 새 API/env 반영 필요.
- 설정 미입력/원점 거부, 로컬 HTTP 세션·링크 재사용·암호화·소유권·다른 이메일·불허 URL 회귀 PASS. API/web typecheck와 web build PASS. 375/768/1280 실제 화면·링크 속성 확인. 증거 .omo/evidence/connections 및 apps/web/qa/connections.
- 구현 계약 출처: https://docs.composio.dev/reference/v3/api-reference/tool-router/postToolRouterSession 및 postToolRouterSessionBySessionIdLink, getToolRouterSessionBySessionIdToolkits, postToolRouterSessionBySessionIdExecute.


### 2026-09-07 Composio MCP 인증 방식 정정
- Jay의 키는 정상적인 Connect MCP consumer 키다. OMP의 동일 키·connect.composio.dev/mcp·x-consumer-api-key 구성을 읽기 전용 비교했고 initialize/tools list 모두200 확인. 앞선 REST401은 키 오류가 아니라 앱이 프로젝트 REST API 경로를 사용한 탓이었다.
- 프로젝트 REST 연결 구현을 제거하고 실제 MCP initialize/initialized/tools call과 HTTP session header, JSON/SSE 응답을 처리한다. MCP 세션 헤더를 기존 고정IP HTTPS helper에서 보존한다. env loader에서 Composio 키가 ApiEnv로 누락되던 문제도 수정.
- consumer 키는 기존 여러 Gmail 계정을 볼 수 있으므로 앱 사용자 제한을 추가하고, 기본 계정/alias가 아니라 settings summaryEmail과 일치하는 실제 user_info.emailAddress 계정만 선택한다. 실제 지정 Gmail active 확인·main DB 연결 저장 완료. 추가 OAuth 불필요. 메일 본문조회/발송0.
- MCP 로컬HTTP 회귀, 원점/설정 차단, 고정IP HTTP 회귀, API typecheck 및 웹build PASS. .omo/evidence/composio-mcp/verification.json. 메인 서버/하위 에이전트는 건드리지 않았으며 변경 코드의 상시프로세스 반영은 다음 메인 재기동 때 필요.

### 2026-09-08 — Opportunity Finder 검색 범위 확인 대기
- 실제 ASIDE의 로그인된 Jungle Scout 탭에서 Opportunity Finder 필터를 확인했다. 표시된 선택지는 Home & Kitchen이며 Kitchen & Dining은 없었다. Home & Kitchen을 체크해도 하위 선택지는 나타나지 않았고, 체크를 원복한 뒤 대시보드로 복귀했다. Search/Save Search/Export는 실행하지 않았다.
- Jay에게 비동기 질문: Home & Kitchen에서 발굴한 뒤 후보별 Kitchen & Dining 여부를 확인하는 방식을 허용할지, 기존 좁은 범위를 유지하며 웹 자동검색을 보류할지. 답변 전에는 범위를 넓히지 않는다.
- 독립 작업: CSV 후속 작업 생성이 null이면 import/후보/검색 실행 연결/이미 삽입한 job까지 모두 rollback하도록 보완. 이 보완이 자동 웹 내보내기 구현 완료를 뜻하지 않는다.

### 2026-09-08 — Standard 규격 판단 대상 확정
- Jay 응답: 실제 소싱할 대표 ASIN 기준으로 판단한다.
- 키워드의 다른 ASIN 치수·무게를 대표 상품의 근거로 대신 사용하지 않는다. 먼저 ASIN별 카탈로그 측정값과 단위·출처를 보존하고, 대표 ASIN 선택과 해당 상품의 규격 판정을 연결한다.
- 대표 ASIN 선택·규격 판정 연결은 아직 구현 중이며, 카탈로그 값 보존만으로 후보를 합격시키거나 overnight 전체 통과로 표시하지 않는다.

### 2026-09-09 — 추가 구현·최종 확인 승인
- 대표 ASIN: 전체 Jungle Scout 상품 DB 비교에서 단일 1위 ASIN이 확인되면 연구·규격 확인용 대표로 자동 선정한다. 직접 고른 ASIN은 보존하고 복수·불명확은 보류한다. 선택만으로 규격·소싱 사양을 확인 처리하지 않는다.
- 차별화: 필요한 기능 문장과 짧은 리뷰 발췌의 입력 확장 로컬 구현·합성 검증을 승인했다. 원문 암호화, 출처 연결, 개인정보 제외, 제공자별 범위 승인 후 전송 원칙을 유지한다. 실제 유료 호출과 외부 전송은 금지 상태다.
- 사용성: 최종 로컬 연결 검증 후 Jay가 지정한 비개발자 1명이 설명서 없이 확인한다. 에이전트가 제3자에게 연락하지 않는다.
- 세 답변은 구현 방향 승인이다. 구현 완료나 전체 SPEC 인수 증거는 아니다.

### 2026-09-10 — 저리뷰·변형 과다 판정 방침 확정
- Jay가 추천안을 승인했다: 리뷰 수·매출·API에 나열된 변형 수와 출처를 참고 관측값으로 표시한다.
- 별도의 수치 기준이 승인되기 전에는 저리뷰 판매 기회·변형 과다의 자동 판정을 unknown으로 유지한다. 임의 임계값이나 숨은 합격 조건을 추가하지 않는다.
- 이 질문은 답변 완료다. 같은 기준을 다시 묻지 않는다. 브랜드 소유·반품률·판매 제한의 근거 수집/판정·최종 GO 연결까지 완료됐다는 뜻은 아니다.
