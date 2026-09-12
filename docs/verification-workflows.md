# 로컬 승인·발주·복구 검증

실제 업체 연락·유료 API·배포를 검증했다고 주장하지 않는다. 모든 발송은 개발 Mailpit의 `.invalid` 합성 주소이며, 인수 검사는 `data/acceptance-db.json`이 가리키는 전용 DB에서 수행한다. 원래 작업 공간의 승인 기준은 v1 그대로다.

## 확인한 흐름
- 공급처 출처·사양 일치 근거 → 불변 RFQ → 명시적 승인 → outbox → 로컬 SMTP receipt. 반복 승인·동시 실행에도 같은 action은 한 번만 전송.
- 실제 SMTP 수락 직후 child 프로세스 강제 종료: 전송 결과 미확인으로 복구하고 동일 Message-ID/수신자/제목/본문의 Mailpit receipt만 조회. 재전송 없음.
- SMTP 수락 뒤 DB 저장 실패: 살아 있는 worker의 다음 cycle에서 동일 복구. 다시 시작하거나 다시 보내지 않음.
- 회신 원문과 메시지 ID를 보존. 같은 메시지의 중복 기록은 재사용하고 서로 다른 원문을 덮어쓰지 않음. HTML은 일반 텍스트로 표시.
- 설정 17항목의 저장과 적용을 분리. 동시 승인에서는 한 버전만 적용, 오래된 요청은 거절. 누락 세 필드의 보완 제안은 main에서 미승인 상태로 유지.
- 발주 판단은 quote/spec/settings snapshot을 묶은 불변 packet으로 검토. GO 승인 시 현금 예약, HOLD/거절은 예약 없음. 실제 발주·결제·공급처 전송을 실행하지 않음.
- `$3,000` 한도에서 동시 `$2,600` 예약 두 건 중 한 건만 승인. 반복 클릭은 같은 결과. 명시 취소로 가용 현금 복원. 예약 금액 아래로 설정 한도를 낮추면 요청을 보존한 채 적용 차단.

## 실행 명령
- `pnpm verify:local -- --scenario approvals`: 설정 승인, RFQ, process-kill 복구, 전송 후 DB 실패 복구.
- `pnpm verify:local -- --scenario orders`: 원가·현금 반올림, stale 조건, 실제 인증 API 생성/승인/취소.
- `pnpm verify:local -- --scenario budget`: 삭제 없는 전용 DB 검증. cap3/0, 동시 중복, 캐시, 재시도 예산, DB 불가, 실제 child 종료, 다음 UTC 날짜에도 불확실 요청 재전송 금지. 미연결 transport는 예약 전 차단, 정산 중복 차감 금지.
- `pnpm exec tsx scripts/verify-worker-replay.mjs`: 오래된 stage/input version 큐 작업이 이미 결정된 후보를 되돌리지 않음.
- `pnpm exec tsx scripts/verify-api-errors.mjs`: 서버 오류 메시지/로그에 합성 비밀 sentinel 미노출. 승인 설정 행 누락을 기본값으로 대체하지 않음.
- `pnpm exec tsx scripts/verify-simulator-boundary.mjs`: 로컬 시험 전송의 타 origin/redirect 차단.

발주 실제 실행 결과는 `.omo/evidence/2026-09-06-order-decision-backend/order-api.log`, `order-acceptance.log`; 독립 코드 재검토는 `.omo/evidence/order-backend-integration-code-review.md`의 APPROVE.

## 화면
`apps/web/qa/workflows/`에 Today/Settings/Contact 각각 375/768/1280 창 폭의 최종 JPEG 9개, `metrics.json`, `captures.json` 저장. 네이티브 스크롤바 15px를 제외한 본문 raster 폭은 360/753/1265. 모든 화면의 가로 넘침 없음. Contact 승인 버튼 44px, 미검증 후보 승인 비활성, 회신 `<b>` 문자열은 텍스트로만 표시. Settings의 미승인 변경안은 현재 적용값과 구분.

발주 화면과 보안 throttle는 후속 통합·실제 화면 검증 진행 중. 전체 SPEC 또는 최종 외부 인수 완료가 아니다.

## 후속 완료 근거
- 발주 실제 UI: 별도 `forge_ops_acceptance_3351fb245f24` DB, 비밀번호 다음 TOTP 로그인, GO 요청 저장·새로고침 복원, 승인 후 2600 예약/400 가용, 명시 해제 후 0 예약/3000 가용 및 해제 사유 보존. 생성한 합성 예약은 모두 해제. 실제 주문·결제 0. 테스트 서버와 임시 합성 인증 파일 정리.
- 발주 캡처: `apps/web/qa/orders/`의 pending/reserved/released × 3폭 + 실제 작업 공간의 unknown-settings-375. 초기 scroll 위치 때문에 보이던 캡처 밖 skip-link는 제품 변경 없이 scrollY=0에서 재촬영했다. viewport override는 선택된 탭에 적용되므로 활성 탭과 innerWidth 일치를 검증 후 촬영했다.
- 현재 실행 로그: `.omo/evidence/workflow-integration/`의 approvals/auth/orders/budget/worker-replay/api-errors/typecheck/web-build 로그. 소스 대응은 source-hashes.json, 직접 화면 관찰은 browser-order.json.
- 인증: `pnpm verify:local -- --scenario auth` PASS. 실제 API에서 초기 2FA 등록, 로그인 challenge, TOTP 5회 실패 후 차단, 복구 경로 우회 차단, 동시 비밀번호 실패 최대5, 예외 로그·응답 비밀 미노출을 확인. 새 설정은 absolute12h session과 production origin whitelist를 적용한다.
- 전체 패키지 타입 검사 PASS. 실제 메일 계정 활성화/IMAP·제공자·일정·공식 API 결과 소비·운영 복원 등은 IMPLEMENTATION_STATUS.md의 미완료 항목으로 남아 있다.

## 2026-09-06 업무 메일·승인 이동 후속
- 업무 메일 설정은 암호화/write-only 저장, 사용 승인 요청·검토·거절·중지까지 연결했다. 사용 승인은 실제 연결 성공이 아니며 UI는 연결 미확인을 유지한다.
- 영구 SMTP 인증/발신 주소 거절은 해당 설정 버전만 중지. 수신 주소 영구 거절은 자동 재전송하지 않고, DATA/소켓 불확실 결과는 unknown으로 유지한다. 알려진 미전송은 취소 가능하며 재승인의 전송 상태는 현재 approval만 표시한다.
- 검증: `pnpm exec tsx scripts/verify-mail-connectors.mjs`, `scripts/verify-mail-profile.mjs`, `scripts/verify-contact.mjs`, `scripts/verify-contact-persistence.mjs`, `scripts/verify-candidate-navigation.ts`, 전체 `pnpm typecheck`, `pnpm --filter @forge-ops/web build` PASS. 명령별 로그·소스 해시는 `.omo/evidence/mail-integration/`에 보존.
- 실제 브라우저: 별도 합성 DB에서 비밀번호→6자리 인증→메일 저장→승인 요청→새로고침→오늘 검토→사용 승인→중지 확인. 중지 뒤 미저장 입력 보존/오경고 없음, 다른 탭 변경은 덮어쓰기 거부/입력 보존, 명시 다시 불러오기로 복구 확인. `apps/web/qa/mail/`.
- 후보 상세는 다음 행동→모르는 것→근거 순서. 상세/목록/오늘에서 연락·발주 검토 화면으로 직접 연결. 실제 두 승인 대기 후보와 미확인 대기 후보를 375/768/1280에서 확인. `apps/web/qa/navigation/`, `apps/web/qa/evidence/`.
- 테스트 서버·임시 합성 인증 파일 종료/정리. main 설정v1·미승인 보완 요청 유지, 업무 메일 미설정. 실제 외부 연결/메일/결제/배포0. 현재 dev supervisor PID53872.
- 전체 SPEC 완료 아님. 자동 IMAP 회신 수집, 나머지 공식 API/예산 속도·backoff, 제공자/플래너/보안 기기·복구·백업/운영 인수는 남아 있다.

## 2026-09-06 CSV 입력 경계·검증 진입점
- keyword 열이 없는 다른 표를 첫 열 키워드로 추측하지 않는다. 대소문자/공백 정규화 후 중복 열 이름, 명시된 US 이외 marketplace는 전체 가져오기 전에 422로 거절한다. invalid import는 후보 수를 바꾸지 않는 격리 API 회귀 검증 통과.
- 가져오기 화면에 데이터 행별 한국어 오류를 최대10개 표시하고, 서버 오류/확인 불가 결과를 0개 성공으로 바꾸지 않는다. 실제 파일 선택기로 3종 invalid CSV를 확인했고 375/768/1280 가로 넘침 없음. 증거 apps/web/qa/imports, .omo/evidence/csv-import.
- 현재 PASS 명령: pnpm verify:local -- --scenario mail / reimport / api-validation / subscriptions; pnpm typecheck; pnpm --filter @forge-ops/web build. mail은 실제 React busy-control 렌더 검증을 포함한다. api-validation은 local HTTP 응답 소비/근거/캐시/오래된 callback 검증이며 실제 유료 요청이 아니다.
- 메일 백엔드·프런트 코드·시각 독립 재검토 APPROVE. CSV 후속 독립 검토 진행 중. 미사용 fontsource 의존성 제거, 승인된 자체 호스팅 폰트 유지.
- 현재 dev supervisor PID33060. main 메일 미설정/설정 v1 미승인 보완 요청 유지. 실제 외부 메일/유료 호출/결제/배포 없음. 자동 회신 수집·제공자·플래너·운영/보안 나머지는 계속 미완료이며 all 시나리오는 여전히 전체 합격을 선언하지 않는다.

### 이번 묶음 독립 검토 결과
- 메일 전송 코드: `.omo/evidence/mail-integration-code-review.md` APPROVE (blocker 없음).
- 메일·후보 이동 UI 코드/시각: `.omo/evidence/mail-navigation-ui-code-review.md`, `.omo/evidence/mail-ui-clone-fidelity.md` APPROVE.
- CSV 가져오기 코드/시각: `.omo/evidence/csv-import-guard-code-review.md`, `.omo/evidence/csv-import-ui-clone-fidelity.md` APPROVE. 정상적인 공백·대소문자 keyword/marketplace 입력 성공도 추가 회귀 검증 PASS.
- 남은 작은 제약: 데이터 행 없는 header-only CSV는 구체적인 행 오류 없이 일반 안내를 표시한다. 일부 기존 verifier의 길이·패키지 내부 경로 의존성은 유지보수 항목이다. 기능 blocker나 외부 호출 성공으로 과장하지 않는다.
- 전체 SPEC 목표는 계속 활성이다. 자동 회신 수집/제공자 역할·예산/플래너·요약/보안 기기·복구/운영 복원과 실제 외부 인수는 아직 완료하지 않았다.


## 2026-09-06 수신함·원문 기반 견적 통합
- IMAP 회신의 암호화 원문·첨부·커서와 중복/충돌 분류, 수동 RFQ 연결, 원문에서 확인된 견적 조건의 자동 저장을 연결했다. 부분 비용과 위험 미확인은 보류다.
- 원문의 수량/MOQ/운송 조건/확인 시각 없이 연결 견적을 기록할 수 없다. 원문·유효일은 고정하며 운영자 비용 근거는 별도로 저장한다. 원문에 없는 공급처 비용을 견적/측정으로 표시할 수 없다. 별도 자료는 명시적 수동 견적 경로로 기록한다.
- `pnpm verify:local -- --scenario inbox`, `pnpm typecheck`, `pnpm --filter @forge-ops/web build` PASS. inbox는 실제 로컬 TLS IMAP 수신, 프로세스 재시작 커서·견적 중복 방지, API/원문 변조 차단, React 입력 검증을 포함한다. 이전 mail/orders 회귀 결과도 `.omo/evidence/inbox-integration/`에 보존.
- IAB 합성 DB에서 비밀번호→6자리 인증, 자동 견적 보류, 운영자 비용 보완→GO(합성 숫자), 새로고침 근거 복원, 동일 재저장2건 유지, 누락 조건 저장 차단과 별도 수동 이동을 확인. `apps/web/qa/inbox/recapture-metrics.json`와 375/768/1280 이미지. 실제 공급처/시장 검증 아님.
- main dev PID60788, 0012/0013 마이그레이션 적용. 활성 메일0/JS cap0. 로그인 뒤 main 수신함은 아직 별도 재검증 전이며 합성 통합 흐름과 구분한다. 초기 Vite/API 시작 순서로 session proxy 오류1회가 기록되었고 API 정상 기동을 확인했다.
- 최신 소스81개 해시/전체 파일 whitespace 검사 기록 갱신. 독립 코드·시각 재검토 진행 중. 실제 외부 연결·메시지·유료 호출·배포0. 전체 SPEC 완료 아님.
