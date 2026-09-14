# 외부 단계 실행 준비 기록 — 2026-09-14

Jay가 유료 API·외부 메일/공급처 연락·Oracle·Cloudflare/R2 배포를 진행하도록 승인한 뒤, 실제 쓰기 전에 각 경계를 읽기 전용으로 확인했다.

## 확인된 상태

- 로컬 `pnpm typecheck` 통과.
- `pnpm verify:local -- --scenario integrated` 통과. 외부 action 0, 실제 provider 호출 0.
- `scripts/verify-edge-proxy.mjs` 통과. 실제 Cloudflare runtime은 아직 미검증.
- `scripts/verify-mail-connectors.mjs` 통과. 외부 연결 0.
- `scripts/verify-ai-business-contract.mjs` 통과. 실제 AI 호출 0.
- `scripts/verify-browser-task-delivery.mjs` 통과. 유료 agent 시작 0, 공급처 연락 0, main data 변경 0.
- Oracle 호스트 `hermes-server`는 Ubuntu 24.04 계열 Oracle ARM64/aarch64로 확인됐다. `/opt/forge-ops`와 `forge-ops-*` unit은 없고, 기존 `amazon-research-worker.service`가 별도로 실행 중이다. 기존 서비스는 중단하지 않았다.
- Cloudflare API token은 인증되지만 `forge-kitchen-ops` Worker는 아직 없고, R2 bucket list는 계정에서 R2가 활성화되지 않아 실패했다. Wrangler는 저장소 의존성으로 추가하지 않고 `pnpm dlx` 임시 실행만 사용했다.

## 실행을 막는 필수 입력

1. Cloudflare에 사용할 공개 HTTPS hostname과 Worker의 `API_ORIGIN`(Access Service Token으로 보호된 Tunnel origin). 현재 `wrangler.jsonc`의 두 값은 비어 있다.
2. Cloudflare Access Service Token의 client id/secret을 비밀 저장 경로로 전달하고, Tunnel을 Oracle localhost API에 연결할 권한.
3. R2 활성화 및 비공개 bucket 이름/권한. 현재 계정 API가 R2 미활성 상태를 반환한다.
4. Oracle에 새 `forge-ops` DB·전용 OS/DB role을 만들 수 있는 배포 창과 초기 관리자 bootstrap 방식. 기존 서비스와 포트/데이터를 분리해야 한다.
5. 실제 업무 메일 프로필의 송신/수신 주소와 승인된 공급처 수신 주소·RFQ 본문/수량. 현재 로컬 `.env`에는 외부 메일 프로필과 수신 대상이 없다.

이 값이 채워지기 전에는 Worker 생성, R2 bucket 생성, Oracle 서비스 설치, 유료 API 호출, 외부 메시지 발송을 실행하지 않는다. 템플릿 unit과 로컬 검증만으로 production 인수를 선언하지 않는다.
