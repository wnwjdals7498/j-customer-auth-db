# j-customer-auth-db 설계 결정

j-customer-auth-db 최소 구현에 필요한 설계 결정을 정리한다. 제품군 공통 기준은 `j-groupware/docs/architecture.md`를 따르고, 이 문서는 그 위에서 j-customer-auth-db가 정한 내용만 적는다. 각 결정은 PMT project `70b997a8-e2ac-4102-8dbb-e76e3aec9467`에 같은 번호의 `결정 N` 레코드로 기록되어 있다.

결정일: 2026-10-07

## 0. 범위

- **범위(architecture.md §4):** 고객의 고객(손님) 정보 DB(CRUD), 로그인 API, 확장용 공개 API(API 키 인증) + OpenAPI 문서. 관리 화면은 j-groupware "손님" 메뉴다(결정 3).
- **완료 기준:** 권한 있는 하위 회원이 UI로 손님을 등록하고, 그 손님이 로그인 API로 인증되며, 외부 스크립트가 API로 목록을 조회.
- **배치:** 고객 VM(tenant plane) 안에서 동작한다. 손님 인증은 Keycloak과 분리해 고객이 손님 데이터를 직접 소유한다.

## 1. 데이터

### 결정 1. 손님 DB 엔진
- **결정:** 고객 VM의 j-groupware PostgreSQL 인스턴스에 j-customer-auth-db 전용 database `jgw_customer_auth`와 전용 계정을 추가한다(architecture.md 3장 서비스 가입 모델, A안). 이 계정은 자기 database에만 접속하고 다른 서비스 database를 참조하지 않는다. 드라이버는 `pg`, 마이그레이션은 node-pg-migrate SQL 파일 방식, 쿼리는 SQL 직접 작성, 버전은 정확히 고정한다(j-groupware 결정 6-2와 동일).
- **이유:** MySQL도 기능상 문제는 없지만 고객 VM에 DB 엔진이 2종이 되어 메모리·백업·패치 부담이 늘고, node-pg-migrate는 PostgreSQL 전용이라 도구를 재사용할 수 없다.

### 결정 9. tenant 구분 컬럼
- **결정:** 모든 테이블(손님, API 키 등)에 `tenant_id`를 둔다. 데이터 접근 함수는 tenant를 필수 인자로 받아 모든 쿼리 조건에 강제한다. 서버 설정에 허용 tenant 목록(기본 1개)을 두고 목록에 없는 tenant 요청은 거절한다. 다른 tenant 데이터가 보이지 않음을 통합 테스트로 검증한다.
- **이유:** j-groupware 결정 6-1과 같은 규칙. VM을 여러 고객이 공유하게 되어도 재작업이 없다.

## 2. 손님 인증

### 결정 2. 손님 로그인 토큰
- **결정:** 손님 로그인 성공 시 짧은 수명의 서명 access token(JWT)을 반환한다. j-customer-auth-db가 공개키를 JWKS로 공개하고, j-talk 등 손님을 상대하는 서비스는 서명을 검증한 뒤 자체 세션을 만든다. (2026-10-07: j-approval은 내부 전자결재로 바뀌어 손님 JWT를 쓰지 않는다. j-approval 결정 1) 서명 알고리즘·수명·claim·JWKS 경로는 `packages/contracts`에서 확정한다.
- **이유:** j-auth 결정 6·j-groupware 결정 1과 같은 "공개키 서명 검증" 패턴이라 서비스 간 지식을 재사용한다.

### 결정 7. 손님 초기 비밀번호
- **결정:** 하위 회원이 손님 등록 시 비밀번호를 지정하고 그대로 영구 비밀번호로 쓴다. 손님 비밀번호 변경·재설정은 이후 범위(backlog)다.
- **이유:** j-groupware 결정 3과 같은 방식이고 j-mail 의존을 만들지 않는다.

### 결정 8. 비밀번호 해시
- **결정:** 손님 비밀번호는 argon2id로 해시한다. 패키지와 파라미터는 공식 근거(OWASP Password Storage Cheat Sheet, 패키지 저장소)와 함께 버전을 정확히 고정한다.
- **이유:** OWASP 권장 1순위 알고리즘.

손님 로그인 실패 처리는 j-auth 결정 7을 따른다: 없는 손님·비밀번호 틀림은 같은 실패 응답, DB 장애는 별도 오류, 로그인 시도 제한.

## 3. 관리 화면과 권한

### 결정 3. 손님 관리 화면 위치
- **결정:** 손님 관리 화면은 j-groupware 안의 메뉴로 둔다. 고객 관리자와 guest 권한을 받은 하위 회원이 j-groupware에 로그인해 사용한다. j-customer-auth-db는 API(관리 API, 손님 로그인 API, 확장 공개 API)와 contracts만 제공하고 자체 web 앱은 두지 않는다.
- **이유:** 운영사는 고객별로 분리된 그룹웨어를 판매하므로 고객 관리자는 j-groupware 하나에서 회원과 손님을 함께 관리한다. UI 패키지를 다른 저장소로 배포할 필요도 없어진다.

### 결정 4. 손님 관리 권한 이름
- **결정:** 고객 realm 기능 권한으로 `guest:read`(손님 조회), `guest:write`(손님 등록·수정·삭제, API 키 발급·회수)를 쓴다. j-auth 결정 16에 따라 role 전용 client `j-customer-auth-db`에 둔다.
- **이유:** 운영사 realm의 `customer:read`/`customer:write`와 이름 충돌을 피한다.

### 결정 11. tenant:admin 묶음에 guest 권한 포함
- **결정:** j-auth 고객 realm의 묶음 role `tenant:admin`이 처음부터 `guest:read`·`guest:write`를 포함한다. `tenant:admin` = `board:read` + `board:write` + `member:manage` + `messenger:use` + `guest:read` + `guest:write`. 하위 회원(`tenant:member`)에게는 회원 관리 API로 guest 권한을 개별 부여한다.
- **갱신(2026-10-07):** 식에 `messenger:use`를 넣었다. j-groupware 결정 16과 j-auth 결정 16에 이미 있는 권한이다. PMT에서는 이전 결정을 supersede했다.
- **갱신 2(2026-10-07):** 서비스 가입 모델(j-auth 결정 25)에 따라 고정 식을 규칙으로 바꾼다. j-customer-auth-db에 가입한 고객 realm에서 `tenant:admin`은 guest 두 role을 포함한다. 전체 식은 j-auth contracts 서비스 카탈로그 상수에서 계산하고 이 문서에는 다시 적지 않는다. 가입하지 않은 고객 realm에는 client `j-customer-auth-db`와 guest role, aud가 없다.
- **이유:** 고객 관리자가 별도 부여 없이 손님 관리와 하위 회원 권한 부여를 바로 할 수 있다. j-auth 결정 16 변경 요청(6장 R1)으로 전달한다.

### 결정 5. 관리 API 호출 인증
- **결정:** j-groupware 서버는 로그인 세션의 j-auth access token을 붙여 관리 API를 호출한다. 5분 만료는 j-groupware가 전달 전에 갱신해 해결한다(j-groupware 결정 2, 최소 구현 최종안으로 2026-10-07 확정). j-customer-auth-db는 j-auth 결정 19 기준으로 토큰을 검증하고(RS256, iss, `azp=j-auth`, aud에 `j-customer-auth-db`, `tenant` claim), 허용 tenant와 `guest:read`/`guest:write` 보유를 직접 검사한다. tenant는 토큰 claim에서만 정한다.
- **이유:** j-groupware 결정 3(j-auth 회원 관리 API 호출)과 같은 방식이라 권한 검사가 데이터 소유 서비스에 남는다.

### 결정 6. 확장 공개 API 키
- **결정:** `guest:write` 보유자가 손님 관리 화면에서 API 키를 발급·회수한다. 키 원문은 발급 시 1회만 보여 주고 DB에는 해시만 저장한다. 키마다 스코프 `guest:read`/`guest:write`를 선택한다. 공개 API는 OpenAPI 문서로 제공한다(`@fastify/swagger`).
- **이유:** 외부 스크립트 목록 조회(완료 기준)와 이후 쓰기 확장을 같은 모델로 처리한다.

## 4. 검증과 배포

### 결정 10. 테스트와 배포
- **결정:** Vitest로 실제 j-auth·Keycloak·PostgreSQL에 대해 API 시나리오를 검증한다. 화면 e2e는 j-groupware 쪽에서 한다. 로컬 완료 후 고객 VM에서 systemd 실행·로컬 인증서 HTTPS로 다시 검증한다. 관리 API와 손님 로그인 API는 내부 포트로만 열고, 확장 공개 API(API 키 인증)만 gateway 경로 `https://gw.<tenant>.jgw.test/ext/customer-auth/`로 노출한다(j-groupware 결정 17 예외, 2026-10-07). 비표준 기본 포트 + 설정 변경 가능(j-auth·j-groupware 결정 12 원칙).
- **이유:** 화면은 j-groupware에 있으므로(결정 3) 이 저장소는 API 증명에 집중한다.

저장소 골격은 j-groupware 결정 10처럼 j-messenger에서 workspaces·도구·scripts를 복사해 줄이고 버전을 같게 고정한다. 폴더는 `apps/server`, `packages/contracts`.

## 5. 작업 구성

### 결정 0. PMT 계층과 Item 구성
PMT 계층은 environment `j-groupware-suite` → repository `j-customer-auth-db`(`7047acd3-d76b-4c3e-89fe-aca7273983a9`) → project `j-customer-auth-db`(`70b997a8-e2ac-4102-8dbb-e76e3aec9467`)이다. Work W1 "j-customer-auth-db 최소 구현"의 완료 기준은 0장 완료 기준과 같다.

| 순서 | Item | 완료 기준 요약 | 선행 |
| --- | --- | --- | --- |
| C1 | 저장소 골격 | workspaces(apps/server, packages/contracts), j-messenger 도구 복사·버전 고정, 전용 database `jgw_customer_auth`·전용 계정과 마이그레이션, 로컬 HTTPS·비표준 포트, 비밀값은 Git 제외 env | j-auth I4 |
| C2 | contracts | 관리·로그인·공개 API 스키마, 손님 JWT claim·JWKS 경로, 오류 코드, `npm pack` 가능 | C1 |
| C3 | 손님 데이터·관리 API | 손님 테이블(tenant_id, argon2id), `@j-auth/contracts` vendor, j-auth 토큰 검증(결정 5), guest 권한 검사·기본 거부, 손님 CRUD, tenant 강제 | C2 |
| C4 | 손님 로그인 API + JWKS | 서명 JWT 발급, JWKS 공개, 동일 실패 응답, DB 장애 별도 오류, 시도 제한, tenant 경계 | C3 |
| C5 | 공개 API + API 키 + OpenAPI | 키 발급·회수, 해시 저장·1회 표시, 스코프, 손님 목록 조회, OpenAPI 문서 | C3 |
| C6 | 완료 기준 테스트 | 실제 의존성 Vitest: 손님 등록·권한 거절, 손님 로그인·JWT 검증, API 키 조회·회수, tenant 격리, 장애 오류 | C4, C5 |
| C7 | 변경 요청 | 6장 요청을 j-auth·j-groupware에 전달하고 등록 확인 (2026-10-07 사용자 지시로 C2 선행 해제, contracts `.tgz` 제공은 C2 이후) | - |
| C8 | 고객 VM 검증 | VM에서 systemd·내부 포트(j-groupware 중계)·HTTPS, `deploy/provision-service`로 database 생성, j-groupware 화면 손님 등록 → 손님 로그인 → 외부 조회, VM 대상 통합 테스트 | C6, C7, j-groupware G9·G10·G13(`07d0a8bc-c1fc-4672-9a27-f90aaed64b8c`)·G18 |

backlog: 손님 비밀번호 변경·재설정, 서명 키 교체, OIDC 전환, 손님 셀프 가입.

## 6. 다른 서비스에 넘길 변경 요청

2026-10-07 각 대상 프로젝트 PMT에 backlog 레코드로 등록했다. 같은 날 모두 반영되었다. R1~R3은 j-auth 결정 21(Item I2·I3·I4·I6), R4는 j-groupware 결정 18(Item G13)이다. C7은 완료 조건을 충족했다(PMT finish 대기).

| 번호 | 대상 | 요청 | PMT 레코드 |
| --- | --- | --- | --- |
| R1 | j-auth | 고객 realm에 role 전용 client `j-customer-auth-db`와 `guest:read`·`guest:write` 추가(결정 16 방식). `tenant:admin` 묶음에 guest 권한 포함(결정 11) | `ffb03202-7838-4224-988c-d1ac84a6d8c7` |
| R2 | j-auth | `j-auth` client audience mapper와 contracts aud 상수에 `j-customer-auth-db` 추가(결정 19) | `e2864443-1077-4274-9c5a-f6a7c7e8ea21` |
| R3 | j-auth | 회원 관리 API(결정 14)의 부여 가능 role에 `guest:read`·`guest:write` 추가 | `0c90f2b0-5203-4c3f-a10f-ade99fb3e933` |
| R4 | j-groupware | 손님 관리 메뉴(목록·등록·수정·삭제)와 API 키 발급·회수 화면, 권한 표(결정 4)에 guest 권한, 회원 관리 화면에서 guest 권한 부여, contracts `.tgz`는 C2 완료 후 vendor로 제공 | `a508853c-48e9-4225-9f29-7c9568a63826` |
