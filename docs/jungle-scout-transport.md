# Jungle Scout 공식 전송 경로

공식 HTTPS 전송 어댑터를 구현했으며, 현재 로컬 설정에서는 활성화하지 않았다. 이 문서는 실제 유료 호출 승인이 아니다.

## 호출 경계

- 고정 origin `https://developer.junglescout.com`과 기존 다섯 endpoint·HTTP method만 허용한다. 다른 origin, userinfo, fragment, 알 수 없는 경로·method, US 이외 또는 중복 marketplace를 차단한다.
- POST는 해당 endpoint의 JSON:API type과 attributes 객체가 필요하다. 인증 헤더로 사용할 수 없는 키 값은 전송 전에 비활성 처리한다.
- DNS 응답 전체의 공인 IP 여부를 확인하고 그 IP에 연결한다. 원래 Host/SNI와 인증서 이름을 검증한다. 리다이렉트를 따라가지 않으며, 기존 30초 timeout·4MiB 응답 한도를 사용한다.
- `executeJsQuery`의 DB 승인 한도·예약·속도 제한을 통과한 뒤에만 전송한다. HTTP 응답 없는 불확실한 결과는 예약을 유지하고 자동 재전송하지 않는다.

## 명시적 활성화 설정

현재 worker는 development만 지원한다. 유료 호출과 계정 사용이 별도로 승인된 뒤 운영 설정에 아래 항목이 모두 필요하다.

- `.env`: `JS_TRANSPORT=official`
- `.env`: `JS_ACCOUNT_SCOPE`에 동일 실제 API 계정을 구별하는 영구 ID 지정. 소문자 영문·숫자와 `. _ -`만 사용하며 최대128자다.
- `.env.junglescout`: 발급받은 `JS_API_KEY_NAME`, `JS_API_KEY`. 이 파일은 서버 시작 때 허용된 두 키만 로드한다.
- 승인된 앱 설정의 `jsDailyWireCap`이 양수여야 한다. 호출자가 더 높은 한도를 지정해도 승인된 한도를 넘지 못한다.

키 파일만 있어서는 활성화되지 않는다. production은 현재 차단된다. official과 simulator를 동시에 지정하면 차단하며, `JS_TRANSPORT=disabled`는 전송을 비활성화한다. 이 작업에서는 활성화 설정이나 실제 키를 바꾸지 않았다.

`JS_ACCOUNT_SCOPE`는 API 키 자체나 키 이름이 아니다. 같은 실제 계정에서 키만 교체할 때 이 값을 바꾸면 안 된다. 어댑터는 이 ID의 hash로 공식 계정 namespace를 만들고 호출자가 넘긴 임의 scope보다 우선한다. 따라서 시뮬레이터·다른 계정의 cache를 재사용하지 않으며, 동일 계정의 키 교체로 불확실한 요청의 재전송 방어를 우회하지 않는다.

## 키 교체 후 확정된 인증 실패 복구

`0021_js_credential_revision.sql`은 operation에 마지막 전송 승인의 credential hash를 보관하는 nullable 컬럼을 추가한다. 원문 키를 DB에 넣지 않는다. 예산 대기 중 생성된 요청에는 키를 먼저 기록하지 않고, 실제 attempt 승인과 같은 SQL 문에서 갱신한다.

이전 전송이 확실한401/403이고 마지막 키 hash와 현재 키 hash가 다를 때만 새 generation을 만든다. 같은 잘못된 키는 자동 재시도하지 않는다. 키 기록이 없는 과거 실패도 키가 바뀌었다고 추측하지 않는다. 429/5xx의 대기·재시도 횟수와 모든 generation의 미확인·진행 중 요청 차단은 유지한다. 새 키의 요청도 현재 승인 한도 안에서 별도로 예약한다.

## 검증과 남은 일

`pnpm verify:local -- --scenario js-transport`는 다섯 요청, 헤더, 경로·DNS 경계, 합성 HTTP 응답, 실제 격리 DB의 승인 한도·동시 중복 방지·계정별 cache·키 교체 시 unknown 예약 보존을 검증한다. 외부 HTTPS 호출이나 실제 Jungle Scout 응답을 검증한 것으로 표시하지 않는다.

기존 `pnpm verify:local -- --scenario api-validation`과 `pnpm typecheck`도 통과했다. 증거는 `.omo/evidence/js-official/verification.json`과 실행 로그에 있다.

현재 후보 worker는 Product Database 결과를 소비한다. 나머지 네 endpoint의 결과를 후보 근거와 파이프라인에 연결하는 작업, 실제 계정·응답 인수, production 실행 권한과 활성화 운영 절차는 남아 있다. 전체 SPEC 완료가 아니다.
