# j-customer-auth-db 기능 명세

작성일: 2026-10-08. 상태: **구현·인수 시험 전**. [목록](features.md), [결정](decisions.md), [공통 기준](../../j-groupware/docs/suite-feature-specifications.md)을 따른다. 손님 계정은 Keycloak 회원과 별개다. 관리 화면은 j-groupware가 제공한다.

## 입력·출력·데이터

| 대상 | 최소 계약 |
| --- | --- |
| 손님 | tenant·손님 id·이름·로그인 ID·연락처·argon2id 비밀번호 해시. 등록 시 회원이 정한 영구 초기 비밀번호를 해시한다. 원문은 조회·로그에 없다. |
| 내부 관리 | j-customer-auth-db aud의 회원 Bearer. tenant는 claim에서만, 조회는 guest:read·변경/키 관리는 guest:write다. |
| API 키 | tenant·이름·스코프·키 해시·생성 시각·회수 상태. 원문은 발급 응답 한 번이며 외부 조회·손님 로그인은 유효 키를 요구한다. |
| 외부 로그인 | 고객 사이트 **서버**가 키와 로그인 ID·비밀번호를 보낸다. 성공은 손님 id·tenant를 담은 서명 JWT, 실패는 계정 없음/암호 불일치 동일 응답이다. |
| 외부 문서 | 실제 외부 경로·API 키 인증·성공/실패 schema를 OpenAPI에 표시한다. 내부 회원 관리 Bearer를 외부 API 키와 대체 사용하지 않는다. |

정상 흐름: 회원 화면 등록 → 내부 CRUD → 키 발급 → 사이트 서버 로그인 → JWT 서명 검증 → API 키로 손님 목록 조회 → 키 회수. j-talk은 이 서비스에 직접 로그인/회원 조회를 요청하지 않는다. 사이트 서버가 확인한 손님 id를 별도의 위젯 서명으로 전달한다.

## 기능별 계약

| 기능 ID | PMT Item | 입력·정상 동작·출력 | 권한·실패 경계 | 인수 시험 |
| --- | --- | --- | --- | --- |
| CA-01 | C3 | 검색·페이지·id→tenant 손님 목록/단건 | guest:read, 타 tenant id404·비밀번호 해시 응답 제외 | CA-T01 |
| CA-02 | C3 | 이름/로그인ID/연락처/비밀번호→손님 생성 | guest:write, ID 유일성·형식은 C2 고정·원문 저장 없음 | CA-T01 |
| CA-03 | C3 | 수정 필드/id→현재 tenant 수정·삭제 | guest:write, 없는/다른 tenant404·변경 실패 상태 보존 | CA-T01 |
| CA-04 | C3 | 검증 token→tenant·guest 권한·기본 거부 | 401/403·다른 tenant 쓰기 없음 | CA-T02 |
| CA-10 | C5 | 이름/스코프→랜덤 키 원문1회·해시 저장 | guest:write, 허용 밖 스코프 거절 | CA-T03 |
| CA-11 | C5 | 키 목록 요청→이름/스코프/시각/상태 | guest:write, 원문·해시 응답 제외 | CA-T03 |
| CA-12 | C5 | 키 id→회수 후 외부 인증 거절 | guest:write, 다른 tenant 키 조작 불가 | CA-T03 |
| CA-20 | C5 | 외부 API 키·검색/페이지→키 tenant 손님 목록 | guest:read 이상, Bearer 회원 token만으로 불가 | CA-T03 |
| CA-21 | C5 | 외부 쓰기용 스코프만 계약에 정의 | **이후 확장**: CRUD 외부 route는 첫 구현에 열지 않음 | CA-T03 |
| CA-22 | C4 | API 키+로그인ID/암호→손님JWT | 계정없음/암호틀림 동일401 계열, DB장애503 별도 | CA-T04 |
| CA-23 | C4 | 공개 JWKS 요청→서명 공개키 | private key·API 키 비노출; 알고리즘/kid 계약 일치 | CA-T04 |
| CA-24 | C4 | 손님별/IP별 실패 시도→제한 | 제한값 C2 고정, 초과429·다른 손님 경계 검증 | CA-T04 |
| CA-25 | C5 | 외부 API schema→OpenAPI 문서 | 내부 route·secret 예제 제외, 실제 응답과 일치 | CA-T03·CA-T04 |
| CA-30 | C1 | jgw_customer_auth·전용 계정·migration | 자기 DB만 접속, 손님/키 tenant 필수 | CA-T05 |
| CA-31 | C2 | 관리/키/로그인/JWKS DTO·오류·규칙 게시 | C4·C5·G13·사이트 예제가 동일 규격 사용 | CA-T05 |
| CA-32 | C8 | VM 화면등록→사이트 서버 로그인→외부조회 | 내부 API 비노출·공개 예외 경로만·해지 백업 | CA-T05 |

## 인수 시험

| ID | 관찰할 결과 |
| --- | --- |
| CA-T01 | 실제 DB의 CRUD·검색/페이지·단건, read 회원 쓰기403, tenant 입력 위조·타 tenant id404, 비밀번호 원문/해시가 조회 응답에 없음. |
| CA-T02 | 서명·issuer·aud·tenant·role 위반, 직접 내부 API의 기본 거부, JWKS 장애503, 거절 요청의 DB 변화 없음. |
| CA-T03 | 키 발급 원문1회·목록/DB 해시만·회수 즉시 무효, 스코프 거절·다른 tenant 키, 외부 목록/OpenAPI 일치·외부 쓰기 route 미제공. |
| CA-T04 | 사이트 서버 역할의 실제 로그인·JWT/JWKS 검증·만료·잘못된 서명, 없는 ID/틀린 암호 동일 응답, DB 장애·제한429, 브라우저에 API 키를 넣는 예제 없음. |
| CA-T05 | contracts 게시/설치·DB/migration·접속 격리, VM 설치·HTTPS·예외 경로·화면→외부 API 시나리오와 해지 백업. |

## 확정 관문

C2에서 JWT 알고리즘·수명·claim·JWKS 경로, API 키 헤더/랜덤 규격/스코프 포함, 로그인 ID 형식·tenant 안의 중복 응답·검색/페이지·필드 길이·제한값을 고정한다. C3에서 argon2id 패키지/버전/파라미터를 [OWASP 공식 자료](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)와 함께 기록한다. 키 원문과 서명 private key 저장을 혼동하지 않는다.

서명 키 교체·비밀번호 재설정·손님 셀프 가입·키 사용 시각/만료는 이후 범위다. CA-21은 현재 기능 수에 추적용으로 남기되 외부 쓰기 구현 완료를 요구하지 않는다.
