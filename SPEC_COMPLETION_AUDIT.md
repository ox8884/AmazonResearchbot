# SPEC 완료 대조와 고정 잔여 목록

**Jay의 “다음작업해보자”, “계속해” 요청으로 재개.** 상세 이력과 다음 단계는 .omo/plans/grounded-differentiation.md. 전체 SPEC 미완료 상태이며 목표를 완료 처리하지 않는다.

2026-09-09. 기준: 계약서-SPEC.md, PRODUCT.md, Jay 승인 DESIGN.md 및 최신 사용자 결정.
개별 검증 통과를 전체 인수 완료로 합산하지 않는다. 유료 API·외부 전송·배포·기존 데이터 삭제 금지 유지.

## 완료 판정 범위

| SPEC | 상태 | 확인한 동작과 남은 경계 |
|---|---|---|
| 1. 후보 파이프라인 | 통합 검증 필요 | CSV20 후보 생성·중복 방지·출처·재실행 검증 존재. 동일 후보의 전체 연결 증거는 없음. |
| 2. JS 웹/CSV | 완료: 기록된 로컬 수집 흐름 | ASIDE 실제 검색·50행 다운로드·서명·암호화 import 증거: .omo/evidence/saved-search-export/verification.md. 전체 후속 흐름은 R4. |
| 3. 공식 API | 완료: 로컬 구현 검증 / 실제 제공자 통합 검증 필요 | 5 endpoint·예산·캐시·pagination·공통30일·family 집계·재시작 검증. .omo/evidence/order-market-api-validation.log의 9개 로컬 시나리오. 실제 유료 호출은 금지로 미검증. |
| 4. 소싱·견적·판단 | 통합 검증 필요 | 사양별 비교·계산·승인·최신 시장 조건·현금 예약 검증 존재. 차별화 사양부터 같은 후보의 흐름은 R2/R4. 실제 연락·회신은 R6. |
| 5. Oracle 24시간 운영 | 통합 검증 필요 | 실행 권한 방어·배포 템플릿 검증은 존재. production-authority/verification.json은 템플릿 미설치 상태. 실제 Oracle/Cloudflare/R2·재부팅·장애 복구 인수는 미완료. |
| 6. UI/사용성 | 통합 검증 필요 | 승인 디자인 기반 화면·KO/EN·375/768/1280·unknown/stale 동작 증거 존재. 전체 시나리오·AA 전체·제3자 인수는 R5. |
| 7. 조건부 구독 OAuth | 완료: 허가 없는 연결 차단 | 허가되지 않은 adapter 활성화 차단 검증. 미허가 제공자의 활성화 자체를 필수 구현으로 추가하지 않는다. |
| 8. 커스텀 AI | 구현 필요 및 통합 검증 필요 | 제공자·역할·암호화·활성화·예산·재시도 로컬 검증 존재. 근거 기반 차별화 입력은 R2, 실제 제공자 호출은 R6. |
| 9. 무인 실행·요약 | 구현 필요 및 통합 검증 필요 | planner·내부 요약·로컬 메일 구성요소 검증 존재. verify:local --scenario all은 전체 인수 미완료로 exit2. 한 번의 무인 연결 검증은 R4. 실제 아침 이메일은 R6. |
| 10. 보안·복구 | 완료: 기록된 로컬 항목 / 통합 검증 필요 | 로그인·TOTP·제한·기기·암호화·감사·백업·격리60테이블 복원 증거 존재. 전체 보안 인수 및 production RPO/RTO는 미완료. |

과거 실행 PID나 HTTP 응답은 현재 가동 증거로 재사용하지 않는다. 2026-09-09T21:25:51Z 확인에서 API /api/health는200·ok/development, 웹5173은200, 최근90초 내 연결된 bridge1개였다. 증거: .omo/evidence/representative-auto-runtime.json. 시작 직후 BRIDGE_CYCLE_FAILED 기록과 최신 연결 상태를 구분한다. 이후 편집한 worker 코드의 메인 프로세스 반영은 아직 하지 않았다.
현재20파일 검증 manifest는 .omo/evidence/order-market-source.sha256. 이후 변경 파일은 기존 검증 범위에서 제외하고 영향 검증을 다시 수행한다.

## 필수 잔여 고정

| ID | 상태 | 수락 조건 |
|---|---|---|
| R0 | 로컬 재가동 확인 / bridge 주의 | 2026-09-10 재시작 후 web 5173=200, API /api/health 200 development. Docker postgres 기존 볼륨으로 복구. BRIDGE_CYCLE_FAILED 기록 있음. 제3자·최종 인수는 아님. |
| R1 | 완료: 로컬 구현·연결 검증·코드 검토 | 단일 ASIN 선정·수동 보존·복수 보류·미귀속 근거 무효화 구현. 같은 후보의 signed 규격 접수→예약→worker 재평가·캐시 재사용 통과. 기존 spec 보존·동시 선정1회·수동 override·rollback/stale 검증. 독립 검토 APPROVE. 메인 반영/전체 연결은 R0/R4. |
| R2 | 완료: 로컬 제안·사양 연결 및 UI/코드 검토 | 암호화 입력/승인, 근거 연결 변경 제안→사전 target→최초 소싱 사양 재사용/recovery와 UI/기존 verifier 통합. 제안별 정확한 원문 ref 링크 및 suggestions 없는 화면 확인, 코드 CLEAR/APPROVE. 시장평가 pass는 합성 precondition이므로 전체 무인 연결/실제 차별화 확인 완료는 아님. |
| R3 | 관측 표시·GO 연결 완료 / 실측 근거 수집은 나중 | 저리뷰·변형 과다는 관측만 표시. 브랜드/반품/판매제한은 운영자 기록으로 GO 생성·승인에 연결됨(verify-order-api PASS). 아마존 페이지에서 근거를 자동 수집하는 일은 LATER_INSPECTION.md. |
| R4 | 로컬 연결 검증 존재 / 최종 인수 전 | scripts/verify-unattended-flow.mjs PASS: 20행 import, 독립 보류1, 동일 파이프 후보2명, RFQ 4건 pending, 재실행 0, 캐시, 외부행위0. 차별화는 unknown(4/5 합격). 20명 전원 RFQ와 실제 연락은 아님. 증거 .omo/evidence/unattended-flow-verification.md. 최종 화면/제3자는 R5, 유료·배포는 R6. |
| R5 | 로컬 화면 계약 검증 존재 / 제3자·AA 전체 전 | verify-unattended-ui.mjs PASS: 오늘 목록 승인 라벨 KO/EN, 독립 보류, 시장위험 표시, RFQ 2건 pending. 기존 today/settings/contact 375/768/1280 시안 대조 APPROVE 재사용. 제3자 사용성과 전체 axe 스캔은 미실행. |
| R6 | 통합 검증 필요: 현재 금지로 미실행 | 실제 유료 제공자·이메일·공급처 연락·Oracle/Cloudflare/R2 배포 및 운영 인수. 로컬 simulator/Mailpit로 대체 완료 처리하지 않음. |

R4 로컬 승인 대기 달성은 원래 SPEC의 실제 RFQ 발송·견적 회신 대기·아침 이메일·클라우드 운영 인수를 뜻하지 않는다. 해당 경계는 R6로 유지한다.

## 확정 결정

- 전체 Jungle Scout 상품 DB 조회 결과를 시장 1위 가격 비교 범위로 사용.
- Home & Kitchen 발굴 후 후보별 Kitchen & Dining 분류 확인.
- Standard 규격은 실제 소싱 대표 ASIN 기준.
- 단일 1위 ASIN만 연구·규격 확인용 대표로 자동 선정. 수동 선택 보존. 복수·불명확 보류. 선정 자체로 규격/사양 확인 처리 금지.
- 기능 문장·필요한 짧은 리뷰 발췌의 로컬 구현/합성 검증 승인. 원문 암호화·개인정보 제외·출처 연결·제공자별 범위 승인 후 전송. 실제 외부 전송 금지 유지.
- 로컬 통합 후 Jay 지정 비개발자1명 사용성 확인. 에이전트가 연락하지 않음.

현재 구현 방향에 대한 추가 결정 대기는 없다. 사용자 참여·최종점검 목록은 LATER_INSPECTION.md. 제3자 지정·실제 외부 인수 준비는 추후 사용자 참여 항목이며, 금지 해제를 요청하거나 추정하지 않는다.

## 예상 범위와 불확실성

중간 규모 구현3묶음(R1–R3), 큰 연결 검증1묶음(R4), 실행 복구/사용성(R0/R5). 허용된 로컬 작업은 집중 작업일 기준2–5일 수준의 계획 추정이며 약속이 아니다. R6와 제3자 일정 제외.
차별화 원문과 실제 변경 사양의 의미 연결, 제공자 자료의 귀속/누락, 공급처 사양 일치, 재시작·재전송 시 발견될 연결 결함 때문에 오차가 크다.

개별 검사 통과, 테스트 수, 코드량으로 전체 완료율을 계산하지 않는다. 각 R 항목은 실제 산출물·사용 동작·검증 근거가 생긴 뒤 갱신한다.
