# 나중에 Jay가 점검·참여해야 하는 항목

에이전트가 로컬에서 끝내지 않는 일만 적는다. 구현 가능한 코드 작업과 섞지 않는다.

## 사용자 참여

- ASIDE 브리지 다시 연결. 현재 로컬 dev는 web/API 200이지만 BRIDGE_CYCLE_FAILED가 남을 수 있다.
- 제3자 사용성: 로컬 통합 후 Jay가 지정한 비개발자 1명이 설명서 없이 로그인·오늘·후보·견적·설정. 에이전트는 연락하지 않는다.
- 실제 유료 Jungle Scout 호출, 공급처 이메일 발송, 견적 회신, 아침 메일, Oracle/Cloudflare/R2 배포. 금지 해제 전까지 R6.
- 브랜드 소유권·실제 반품률·판매자 제한의 실측 근거 수집(아마존/브랜드 레지스트리 페이지). 지금은 운영자 기록만 GO에 연결됨.
- 차별화 실물 확인과 유료 AI 제공자 호출. 로컬은 합성·unknown 유지.
- 최종 점검 후 커밋/푸시는 Jay가 원할 때.

## 최종점검 때 보면 되는 로컬 증거

- R4: scripts/verify-unattended-flow.mjs
- R5 화면 계약: scripts/verify-unattended-ui.mjs
- 발주 GO 시장조건: scripts/verify-order-api.mjs
- 토큰 대비: scripts/verify-contrast.mjs
- 기존 375/768/1280: apps/web/qa/workflows/ 및 today-settings-contact-clone-fidelity.md
- verify-local --scenario all 은 아직 exit 2. overnight 전체 인수로 쓰지 말 것.

## 2026-09-12 추가 점검
- 공식 API 17건은 아직 재호출하지 않음. 현재 메인에서 5건 HTTP 200만 확인.
- 새로 추가된 Amazon shortcut과 settings stale approval copy는 live page에서 최종 캡처할 것.
- `pnpm typecheck`, unattended flow/UI, order API PASS 상태를 기준으로 다음 세션을 시작.

## 2026-09-12 final local checkpoint
- Local web/API healthy; ASIDE device connected. Core local verifier suite is green.
- Main DB intentionally has 20 evidence-held candidates, 4 budget-held candidates, and 1 web-session hold. Do not auto-convert unknowns or spend remaining calls without Jay approval.
- Two browser tasks may be delivered while ASIDE is reading; result submission depends on a valid searchable candidate surface.

## Provenance
- 운영/fixture 후보 provenance 분리: 현재 메인 후보 25개가 모두 synthetic.kitchen.v1 import로 생성되어 문자열 필터는 안전하지 않음. 별도 append-only provenance schema 검토 필요.
