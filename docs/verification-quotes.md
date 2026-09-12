# 견적 입력·저장·손익 비교 검증 — M3 부분 구현

2026-09-06. Jay가 기존 프론트-only 제한을 풀고 필요한 API·도메인·DB의 로컬 구현을 승인했다. 기존에 승인한 디자인을 유지했다.

## 구현된 경로

후보 선택 → 비교 사양의 불변 revision 생성 → 같은 사양에 견적 기록 → 현재 승인 설정으로 독립 계산 → 저장/새로고침/사양별 비교.

- 사양: 재질, 치수·단위, 포장, 요구사항, 요청 수량, 출처. 변경 시 새 revision.
- 견적: 공급처/출처/원문, 확인 시각, 유효일, 수량과 MOQ, 운송 조건, 14개 비용의 값·분류·출처·시점, 위험 확인 근거.
- 저장은 append-only. 기존 spec/quote UPDATE와 DELETE를 DB trigger가 거부한다.
- `GET /api/candidates/:id/sourcing`, `POST /api/candidates/:id/specs`, `POST /api/candidates/:id/quotes`. 기존 세션·2FA gate를 재사용하고 신규 mutation은 승인된 웹 origin만 허용.
- 각 견적별 비용만 계산한다. 다른 후보의 사양 ID는 거부하고, 화면에서 서로 다른 사양의 견적을 섞지 않는다.
- Decimal 원값으로 기준을 비교한 뒤 표시값만 반올림한다. 저장 당시 settings version/assessment를 보존하면서 현재 기준으로 재계산하고 stale 여부를 반환한다.
- 미확인 비용은 null/HOLD. 근거 없는 명시적 0은 거부. 위험 확인 미완료, 유효일 미확인/만료는 HOLD. 발송·발주·결제는 실행하지 않는다.

## 명령과 결과

| 명령 | 결과 |
|---|---|
| `pnpm verify:local -- --scenario economics` | PASS: A/B, 미확인 운임, 위험/만료/유효일 gate, 0 이하 분모, 기준 변경, 정확한 경계값, 34.999% 반올림 오판 방지, 출처/시점 누락 |
| `pnpm verify:local -- --scenario sourcing` | PASS: 실제 로컬 인증 API/DB 저장과 재조회, 잘못된 수량/MOQ/출처 거부, 타 origin 403, 무세션 401, 타 후보 사양 404 |
| `pnpm --filter @forge-ops/domain typecheck` | PASS |
| `pnpm --filter @forge-ops/api typecheck` | PASS |
| `pnpm --filter @forge-ops/web typecheck` | PASS |
| `pnpm --filter @forge-ops/web build` | PASS |
| `git diff --check` | PASS |

기존 verify-local 런처에서 Node DEP0190(shell 옵션) 알림이 출력되지만 명령은 exit 0이다. 이번 작업에서는 런처의 기존 실행 방식을 재설계하지 않았다.

### 계약서의 합성 계산 결과

| 입력 | 광고 전 이익/마진 | 광고 후 이익/마진 | ROI | 출시 현금 | 판정 |
|---|---|---|---|---|---|
| A: 제품5+운임1, 수량300 | 14 / 46.67% | 12 / 40.00% | 200.00% | 2,600 | GO |
| B: 제품4+운임1, 수량600 | 15 / 50.00% | 13 / 43.33% | 260.00% | 3,800 | CAUTION |
| C: A의 운임 미확인 | 미확인 | 미확인 | 미확인 | 미확인 | HOLD |
| D: 화면 직접 입력, A와 같은 금액, 위험 미확인 | 14 / 46.67% | 12 / 40.00% | 200.00% | 2,600 | HOLD |

A/B/C는 API 검증 스크립트로 저장했다. D는 실제 브라우저 폼에서 입력하고 저장했다. 모든 자료는 명시적인 합성 QA 자료이며 실제 시장·공급처·수익성 증거가 아니다.

기준 변경 회귀는 실제 저장된 A를 읽어 메모리 안의 다음 설정(한도2500/버전+1)으로 API 응답 생성기를 실행했다. 현재 판정 CAUTION/stale true, 저장 당시 GO와 기존 버전 보존을 확인했다. 실제 DB의 승인 설정은 바꾸지 않았다.

## 실제 브라우저 증거

`apps/web/qa/quotes/`의 JPEG 원본:

- `comparison-1280.jpg`, `comparison-768.jpg`, `comparison-375.jpg`: 실제 인증 API에서 읽은 4개 합성 견적.
- `comparison-en-375.jpg`: 영어 표시와 판정 사유.
- `form-375.jpg`, `cost-inputs-375.jpg`, `spec-form-375.jpg`: 실제 입력 UI. 빈 비용/분류는 미확인, 입력 후 추정/견적 분류 전환 확인.

375/768/1280에서 페이지 가로 넘침 없음. 첫 두 견적의 계산 영역 y좌표가 데스크톱 862/862, 태블릿 1004/1004로 일치했다. 모바일은 견적 순서대로 세로 반복한다. 비용 입력 좌우 padding16, 최소 높이44, 기존 색·Noto Sans KR variable·8px 모서리를 유지했다.

직접 수행: UI로 D 저장 → 위험 미확인 보류 → UI로 r2 생성 → r2 견적0 → r1 재선택/새로고침 → 기존4개 유지. 비용 값, 상태, 판정 사유가 DB 결과와 일치했다.

## 남아 있는 범위

이번 구현은 수동 견적 평가 경로다. 공급처 자동 수집, RFQ 연락 승인/전송/회신 수집, 발주 결정과 현금 예약은 아직 연결하지 않았다. 전체 M3나 최종 무인 시나리오 완료를 뜻하지 않는다.

로컬 `QA 견적 계산 검증 · 실제 제품 아님` 후보와 사양2개/견적4개를 검증 증거로 남겼다. 기존24개 후보·기준값을 삭제하거나 덮어쓰지 않았다. 새 dependency 설치, 유료 호출, 외부 전송, 배포, Git push 없음. 로컬 개발 스택만 재시작했고 0005 migration을 추가 적용했다.

독립 코드 검토 PASS. 시각 검토에서 카드 제목을 시안의 16px로 맞추고 판정을 오른쪽으로 배치했다. 최종 CSS로 7개 캡처를 갱신했고 새 독립 시각 검토도 PASS / APPROVE, 차단 사항 없음으로 완료했다.

DB 후속 증거: `verification-quotes-state.json`에 0005 적용 시각과 사양2/견적4를 기록했다. 합성 레코드의 no-op UPDATE를 각각 실행했고 두 immutable trigger가 거부했다. 각 트랜잭션은 항상 ROLLBACK하여 값을 변경하지 않았다.
