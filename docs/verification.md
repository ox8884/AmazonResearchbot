# 검증 명세와 실행 기록

## 2026-09-06 후속 구현

견적 입력·저장·손익 계산의 실제 로컬 검증은 [verification-quotes.md](verification-quotes.md)에 기록했다. 아래 내용은 최초 계획 당시의 검증 명세이며 전체 시나리오를 실행했다는 뜻이 아니다.

애플리케이션·`pnpm verify:local`은 M1 이후 제공한다. 이 문서는 PLAN 검증 계약을 옮겨 적는다. 아래 시나리오를 돌렸다고 말하지 않는다.

시뮬레이터 결과는 실제 리서치·전송·배포 증거를 대체하지 않는다.

## 로컬 실행 계약 (M1에서 구현)

cwd 신규 저장소 루트. Node 24, pnpm, Docker Desktop. production credential 없음.

- `pnpm dev` → web `http://localhost:5173`, API `http://localhost:3001`, Mailpit `http://localhost:8025`
- `APP_ENV=development`, 실제 외부 HTTP deny
- `pnpm verify:local -- --scenario all` → 시나리오별 관측 출력

## 시나리오

| 이름 | 관측해야 할 것 |
|---|---|
| csv20 | 합성 `tests/fixtures/opportunity-finder-20.csv` 20 서로 다른 키워드 → 후보 20, 각 nextAction 1개, 원본 hash·행 연결. 1개 web_session 대기여도 나머지 19 전진. 같은 파일 재업로드 → 40개 아님. 합성 CSV를 실제 export 합격으로 쓰지 않음 |
| evidence | missing/null/`< 450`/빈칸이 0·450·pass가 되지 않음. 리뷰 2000+ 상품 2개면 탈락. pass3/unknown2는 통과 아님. 1위 가격 17·80 inclusive. 점유율 35/55는 `<` 미충족. 같은 parent 3 variation 매출 3번 합산 금지 |
| budget | cap3 + 서로 다른 요청 20 → wire ≤3. cap0 → 0. 동일 쿼리 동시 20 → wire 1, 캐시 재실행 0. 429→500→200은 예산 3. 예산 2면 세 번째 wire 0. DB 실패 → 외부 0. 응답 보류 중 worker 재시작 → 중복 송신 0, unknown 표시 |
| economics | 견적 A: 전14/46.67%, 후12/40.00%, ROI 200%, 현금 2600 → GO. B: 전15/50%, 후13/43.33%, ROI 260%, 현금 3800 → CAUTION. A단가+BMOQ 혼합 금지. A 운임 unknown이면 계산 불가. 견적 0건은 탈락 아님. A 예약 2600 후 다른 2600 승인 차단 |
| approvals | 미승인 초안 2건 → 메일 0. 승인 후 Mailpit 정확히 2, 견적 대기. 더블클릭/kill → 중복 0. 승인 후 본문 변조 → 409 `APPROVAL_STALE`, 전송 0. 예산 3000→2500 승인 후 A는 CAUTION, 이전 평가 오래됨. 미승인 설정 불변 |
| providers | 로컬 모델 엔드포인트 2개. 역할 분기. 미승인 수신 0. 테스트 허가 1건만. 키 sentinel 평문 0. OAuth 강제 선택 → process/DNS/HTTP/secret 0 |
| security | 비밀번호/TOTP 5회 잠금이 재시작 후에도 유지. 2FA 미완료 거부. CSRF·다른 origin·비로그인·stale 거부. SSRF 목록 차단. CSV/회신 injection이 렌더·연락·예산 변경을 만들지 않음. 암호 변조 fail-closed |
| overnight | 가짜 시계 00:10→08:00, 실제 로컬 API/DB/worker/Mailpit. 사전 연결·요약 승인 후 사용자 mutation 0인 동안 후보 전진, 아침 요약 1. daily_run 중복 0. 이 단축을 하룻밤 실증이라 부르지 않음 |

## 화면 실측 (앱 구현 후)

도구가 있을 때 `/` `/candidates/:id` `/sourcing` `/settings`를 375/768/1280 촬영. 한국어 긴 키워드, 영어, 빈/오류/미확인, 키보드만, 200% 확대. WCAG AA. F11 대조표는 `DESIGN.md` §12.

헤드리스 스크린샷만으로 “화면을 봤다”고 하지 않는다. 제3자 사용성은 실제 관찰 기록.

## 라이브·프로덕션

승인 ID 없이 `verify:live`를 만들지 않는다. 미준비 계정은 없는 것을 적고 외부 합격을 보류한다. 재부팅 합격은 승인된 시각의 실측 없이는 불가.

## M0에서 한 검증

- `계약서-SPEC.md`와 승인된 PLAN을 문서에 반영.
- 제안 색 대비율을 계산해 DESIGN.md에 기록 (본문 쌍 모두 ≥4.5:1).
- `design/screens.html`을 브라우저에서 375/768/1280으로 열어 시안을 확인 (앱 동작 합격 아님).

## 2026-09-07 일일 planner·내부 요약

`pnpm verify:local -- --scenario planner`, `pnpm exec tsx scripts/verify-settings.ts`, `pnpm exec tsx scripts/verify-candidate-view.mjs`, `pnpm typecheck` 통과. 상세 결과와 소스23개 해시: `.omo/evidence/daily-planner/integration.json`. 독립 코드·시각 검토 승인. 실제 외부 발송이나 전체 SPEC 합격을 뜻하지 않는다.

메인0020 적용, 기존 로그인과 설정v2 보존. 아래 초기 캡처 당시에는07:30 전이었으며, 이후 실제예약생성은 다음 실행기록으로 확인했다. 요약이 있는 화면은 격리 합성 DB이며, 빈 화면은 메인 로컬 앱이다. 검토한 전체 캡처6개:

- `apps/web/qa/summaries/summary-375.png`
- `apps/web/qa/summaries/summary-768.png`
- `apps/web/qa/summaries/summary-1280.png`
- `apps/web/qa/summaries/main-empty-375.jpg`
- `apps/web/qa/summaries/main-empty-768.jpg`
- `apps/web/qa/summaries/main-empty-1280.jpg`

메인 빈화면3개는 브라우저가 반환한 JPEG 형식에 맞춰 확장자만 정정했다. 픽셀 내용은 검토된 캡처와 동일하다. CSS 폭·nativeDPR·파일hash는 `apps/web/qa/summaries/main-empty-check.json`.


## 2026-09-07 실제 예약 요약·일일 로컬 백업

- DB 실제시계 기준 `2026-09-07T12:30:18.826Z`에 시카고07:30 내부요약1건생성. 가짜시계/응답없이실제브라우저에서기준v2·기간·후보링크25개확인. 외부메일은not_sent.
- pnpm dev의관리하위프로세스가일일암호화백업생성. 완료파일검증뒤감사기록1건,별도프로세스및앱전체재시작뒤동일ID재사용. 실제유료API기록3건증가없음.
- `pnpm verify:local -- --scenario daily-backup` 및 `pnpm verify:restore -- --target isolated` PASS. 자동백업·수동복원회귀/실패복구/동시실행/새프로세스/손상/키교체/다음날검증. 검증후run-ID전용파일폴더정리.
- 근거: `.omo/evidence/daily-backup/verification.json`, `main-check.json`, `scheduled-summary-ui.json`. 실제화면사진은Git제외 `data/qa/scheduled-summary-2026-09-07.jpg`에만보관.
- Oracle/R2·실제외부메일·production권한·retention/RPO/RTO·전체SPEC합격은아직아니다.
