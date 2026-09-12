# 대표 ASIN의 Standard 규격

Jay가 선택한 실제 소싱 대표 ASIN에만 적용한다. 키워드의 다른 상품, 제품 본체 치수, 운송용 외부 박스, 추정 사양을 대신 쓰지 않는다.

2026-09-09 UTC에 ASIDE에서 확인한 [Amazon US Product size tiers](https://sellercentral.amazon.com/help/hub/reference/GG5KW835AHDJCH8W)의 2026-01-15 시행 표를 기준으로 한다. Small/large standard의 합집합은 포장된 판매 단위의 긴 변18in, 중간 변14in, 짧은 변8in, 무게20lb 이하 범위다. 경계값을 포함한다.

[Dimensional weight](https://sellercentral.amazon.com/help/hub/reference/G53Z9EKF8VVZVH29)에 따라 부피무게는 세 변(in)의 곱/139로 계산하고 실제 포장 단위 무게(lb)와 큰 값을 비교한다. 세트 상품은 묶여 판매되는 포장 전체 기준이다. 여기서는 Standard 여부만 판정하며 개별 수수료·소형/대형 요율은 계산하지 않는다.

`assessStandardSize`는 출처와 관측 시각이 있는 measured 자료만 받고, 정확한 ASIN·us·packaged_unit·inches/pounds 및 양의 유한 측정값을 확인한다. 미확인·단위 미지원·출처 불완전·다른 ASIN은 unknown이다. 일반 카탈로그 치수에서 포장 여부를 추론하지 않는다.

`parseAmazonPackageMeasurements`는 Amazon US 상품 URL과 상세 ASIN 행이 요청 ASIN과 같을 때만 명시적인 Package Dimensions/Package Weight를 읽는다. 치수 행에 함께 기록된 무게도 지원하며 ounces는16으로 나눠 pounds로 변환한다. 일반 Item Dimensions/Item Weight를 대체 근거로 쓰지 않는다. 충돌·미지원 형식은 미확인이다.

현재 파서·판정 함수, 사양 전 서명 작업의 서버 생성·수신·재검증 등록, ASIDE 수집기와 기기별 기능 표시가 구현됐다. 실제 공개 페이지의 item-only 자료가 암호화 영수증으로 저장되고 미확인으로 남는 흐름까지 검증했다. 메인0038과 실제 Jay ASIDE 기기가 활성화됐으며 로컬 실행기가 연결 프로그램을 함께 시작한다. 일반 카탈로그 값만으로 후보가 자동 합격하지 않는다. 전체 야간 자동화 인수는 별도 남은 작업이다.
