# j-customer-auth-db 설계 결정

j-customer-auth-db만의 설계 결정을 적는다. 제품군 공통 결정은 [`j-groupware/docs/architecture.md`](https://github.com/wnwjdals7498/j-groupware/blob/main/docs/architecture.md)(이하 architecture.md)의 S 번호를 따르고 여기서는 링크만 한다. PMT는 통합 project `j-groupware-suite`의 분류 `j-customer-auth-db`에 같은 번호로 기록한다(S16).

정리일: 2026-10-07. 통합 정리에서 결정 번호를 다시 매겼다. 이전 번호는 끝의 대응 표를 본다.

## 0. 범위

- **범위:** 손님(고객의 고객) 정보 DB(CRUD), 손님 로그인 API, 확장 공개 API(API 키 인증) + OpenAPI 문서. 관리 화면은 j-groupware "손님" 메뉴다.
- **완료 기준:** 권한 있는 하위 회원이 화면으로 손님을 등록하고, 그 손님이 로그인 API로 인증되며, 외부 스크립트가 API로 목록을 조회한다.
- **배치:** 고객 서버의 선택 서비스다. 관리 API는 내부 포트로 j-groupware가 중계한다. 공개 API와 손님 로그인 API는 `/ext/customer-auth/` 예외 경로로 연다(architecture.md S6).
- **관련 공통 결정:** S2(서비스·DB), S3(권한), S4(토큰 전달), S6(예외 경로·남용 방지), S7(위젯 손님 구분자), S8~S14.

## 1. 데이터와 손님 인증

### 결정 1. 손님 DB
- **결정:** 고객 서버 PostgreSQL에 database `jgw_customer_auth`와 전용 계정을 둔다(S2, S9). 손님과 API 키 테이블에는 `tenant_id`를 둔다(S8).
- **이유:** 고객 서버에 DB 엔진이 하나뿐이고 도구를 재사용한다.

### 결정 2. 관리 화면 위치
- **결정:** 손님 관리 화면은 j-groupware "손님" 메뉴다(j-groupware 결정 10). 이 저장소는 API와 contracts만 만들고 자체 web 앱은 두지 않는다.
- **이유:** 고객 관리자는 j-groupware 하나에서 회원과 손님을 함께 관리한다(S5).

### 결정 3. 손님 관리 권한
- **결정:** 기능 role은 `guest:read`(손님 조회)와 `guest:write`(손님 등록·수정·삭제, API 키 발급·회수)다. `guest:write`는 `guest:read`를 포함한다. 두 role은 role client `j-customer-auth-db`에 있다(S3 카탈로그).
- **이유:** 운영사 realm의 `customer:*`와 이름이 겹치지 않는다.

### 결정 4. 관리 API 인증
- **결정:** j-groupware가 전달한 Bearer를 j-auth 기준으로 검증한다(aud `j-customer-auth-db`, S4). 허용 tenant와 `guest:read`/`guest:write`를 직접 검사하고, tenant는 토큰 claim에서만 정한다.
- **이유:** 권한 검사가 데이터를 가진 서비스에 남는다.

### 결정 5. 손님 로그인 API와 토큰
- **결정:**
  - 손님 로그인 API는 `/ext/customer-auth/` 예외 경로로 연다.
    - 호출자는 고객 사이트의 서버다. 손님의 브라우저가 아니다.
    - 확장 공개 API 키(결정 8, 스코프 `guest:read` 이상)를 함께 보내야 한다.
  - 성공하면 짧은 수명의 서명 JWT(손님 id, tenant)를 반환하고 공개키를 JWKS로 공개한다. 서명 알고리즘·수명·claim·JWKS 경로는 contracts에서 정한다.
  - 고객 사이트 서버는 이 결과로 손님을 확인한 뒤 상담 위젯에 서명한 손님 구분자를 넘길 수 있다(architecture.md S7). j-talk은 이 API를 호출하지 않는다.
  - 없는 손님과 비밀번호 틀림은 같은 실패 응답이다. DB 장애는 별도 오류다. 손님별·IP별 로그인 시도를 제한하고, gateway 요청 속도 제한도 함께 받는다(S6).
- **이유:** 손님 인증을 고객 사이트가 쓸 수 있는 실제 경로가 생긴다. API 키를 함께 요구해 아무나 비밀번호 대입을 하지 못하게 한다.

### 결정 6. 손님 초기 비밀번호
- **결정:** 하위 회원이 손님을 등록할 때 정한 비밀번호를 그대로 영구 비밀번호로 쓴다. 변경·재설정은 backlog다.
- **이유:** j-mail 의존을 만들지 않는다.

### 결정 7. 비밀번호 해시
- **결정:** argon2id로 해시한다. 패키지와 파라미터는 공식 근거(OWASP Password Storage Cheat Sheet, 패키지 저장소)와 함께 버전을 정확히 고정한다.
- **이유:** OWASP 권장 1순위 알고리즘이다.

### 결정 8. 확장 공개 API와 API 키
- **결정:**
  - `guest:write` 보유자가 j-groupware에서 API 키를 발급·회수한다.
  - 키 원문은 발급할 때 1회만 보여 주고 DB에는 해시만 저장한다. 키마다 스코프 `guest:read`/`guest:write`를 고른다.
  - 공개 API(손님 목록 조회 등)와 손님 로그인 API(결정 5)는 OpenAPI 문서로 제공한다(`@fastify/swagger`). 경로는 `/ext/customer-auth/`다.
- **이유:** 외부 스크립트 조회(완료 기준)와 고객 사이트의 손님 확인을 같은 키 모델로 처리한다.

## 2. 검증과 배포

### 결정 9. 테스트와 배포
- **결정:**
  - Vitest로 실제 j-auth·Keycloak·PostgreSQL을 대상으로 API 시나리오를 검증한다(S12). guest 권한 회원은 테스트가 j-auth 회원 관리 API로 만들고 지운다.
  - 화면 e2e는 j-groupware G13에서 한다.
  - 로컬 완료 후 고객 서버 VM에서 다시 검증한다(S13).
  - 폴더는 `apps/server`, `packages/contracts`이고, contracts는 레지스트리에 게시한다(S10, S11).
- **이유:** 화면이 j-groupware에 있으므로 이 저장소는 API 증명에 집중한다.

## 3. 작업 구성

PMT 통합 project 분류 `j-customer-auth-db`.

| Item | 완료 기준 요약 | 선행 |
| --- | --- | --- |
| C1 저장소 골격 | S11 골격, `jgw_customer_auth`·전용 계정·마이그레이션, 로컬 HTTPS·포트, Git 제외 env | j-auth I4, X1 |
| C2 contracts | 관리·로그인·공개 API 스키마, 손님 JWT claim·JWKS 경로, 오류 코드, 레지스트리 게시 | C1 |
| C3 손님 데이터·관리 API | 손님 테이블(tenant_id, argon2id), `@j-auth/contracts` 설치, 결정 4 검증, guest 권한 검사·기본 거부, 손님 CRUD, tenant 강제 | C2 |
| C4 손님 로그인 API + JWKS | 결정 5(API 키 필수, 서명 JWT, JWKS, 동일 실패, 시도 제한, tenant 경계) | C3, C5 |
| C5 공개 API + API 키 + OpenAPI | 결정 8(발급·회수, 해시, 1회 표시, 스코프, 목록 조회, OpenAPI) | C3 |
| C6 완료 기준 테스트 | 실제 의존성 Vitest: 손님 등록·권한 거절, API 키로 손님 로그인·JWT 검증, API 키 조회·회수, tenant 격리, 장애 오류 | C4, C5, j-auth I6 |
| C7 변경 요청 | 완료(Done) | - |
| C8 고객 서버 검증 | `provision-service`로 설치, systemd·내부 포트·`/ext/customer-auth/` 경로·HTTPS, j-groupware 화면 손님 등록 → 사이트 서버 역할 스크립트로 손님 로그인 → 외부 조회, VM 대상 C6 | C6, j-groupware G10·G13·G18 |

backlog: 손님 비밀번호 변경·재설정, 서명 키 교체, API 키 마지막 사용 시각·만료일, OIDC 전환, 손님 셀프 가입.

## 이전 번호 대응

| 새 | 이전 | 새 | 이전 |
| --- | --- | --- | --- |
| 1 | 1, 9 | 6 | 7 |
| 2 | 3 | 7 | 8 |
| 3 | 4, 11 | 8 | 6 |
| 4 | 5 | 9 | 10 |
| 5 | 2 (+외부 경로, API 키) | - | 0 → 3장 작업 구성, 6장 요청은 모두 반영되어 삭제 |
