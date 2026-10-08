# j-customer-auth-db 기능 목록

j-customer-auth-db가 제공해야 하는 기능 목록이다. 근거는 [`decisions.md`](decisions.md)의 결정 번호와 제품군 공통 결정(`j-groupware/docs/architecture.md`의 S 번호)이고, 담당 Item은 PMT 통합 project 분류 `j-customer-auth-db`다. backend 코드와 독립 클라우드 API 검증을 완료했으며 UI·고객 VM·전체 인수는 미완료다. 현재 진척도는 j-groupware의 implementation-progress.json과 기능 명세를 따른다.

화면은 j-groupware "손님" 메뉴(GW-32·33)가 그린다. 이 저장소는 API만 만든다.

작성일: 2026-10-07

상세 동작·입출력·실패 처리·인수 시험은 [기능 명세](feature-specifications.md)를 따른다.

## 1. 손님 관리 API (내부, j-groupware 중계)

호출: j-groupware 서버, 사용자 Bearer(aud `j-customer-auth-db`).

| ID | 기능 | 핵심 동작 | 권한 | 근거 | Item |
| --- | --- | --- | --- | --- | --- |
| CA-01 | 손님 목록·조회 | tenant 손님 목록(검색·페이지), 단건 조회 | `guest:read` | 결정 3·4 | C3 |
| CA-02 | 손님 등록 | 이름·로그인 ID·연락처, 비밀번호(영구, argon2id 해시) | `guest:write` | 결정 6·7 | C3 |
| CA-03 | 손님 수정·삭제 | 정보 수정, 삭제 | `guest:write` | 결정 3 | C3 |
| CA-04 | 권한·tenant 검사 | Bearer 검증, guest 권한 검사·기본 거부, tenant는 claim에서만, tenant 격리 | - | 결정 4, S8 | C3 |

## 2. API 키 (내부, j-groupware 중계)

| ID | 기능 | 핵심 동작 | 권한 | 근거 | Item |
| --- | --- | --- | --- | --- | --- |
| CA-10 | API 키 발급 | 이름·스코프(`guest:read`/`guest:write`) 지정, 원문 1회 반환, 해시만 저장 | `guest:write` | 결정 8 | C5 |
| CA-11 | API 키 목록 | 이름·스코프·생성 시각(원문 없음) | `guest:write` | 결정 8 | C5 |
| CA-12 | API 키 회수 | 즉시 무효화 | `guest:write` | 결정 8 | C5 |

## 3. 외부 API (`/ext/customer-auth/`, API 키 인증)

호출: 외부 스크립트, 고객 사이트 서버.

| ID | 기능 | 핵심 동작 | 키 스코프 | 근거 | Item |
| --- | --- | --- | --- | --- | --- |
| CA-20 | 손님 목록 조회 | 키의 tenant 손님 목록 | `guest:read` | 결정 8 | C5 |
| CA-21 | 손님 쓰기 | 등록·수정·삭제(이후 확장, 스코프만 정의) | `guest:write` | 결정 8 | C5 |
| CA-22 | 손님 로그인 | 로그인 ID·비밀번호 확인 → 서명 JWT(손님 id, tenant) 발급, 실패 응답 동일, DB 장애 별도 오류 | `guest:read` 이상 | 결정 5 | C4 |
| CA-23 | JWKS 공개 | 손님 JWT 서명 공개키 | 공개 | 결정 5 | C4 |
| CA-24 | 로그인 시도 제한 | 손님별·IP별 제한 + gateway 속도 제한 | - | 결정 5, S6 | C4 |
| CA-25 | OpenAPI 문서 | `@fastify/swagger`로 외부 API 문서 | 공개 | 결정 8 | C5 |

## 4. 기반·운영

| ID | 기능 | 핵심 동작 | 근거 | Item |
| --- | --- | --- | --- | --- |
| CA-30 | 저장소 골격·DB | `jgw_customer_auth`·전용 계정·마이그레이션 | 결정 1, S2·S11 | C1 |
| CA-31 | contracts | 관리·로그인·공개 API 스키마, JWT claim·JWKS 경로, 오류 코드, 게시 | 결정 9, S10 | C2 |
| CA-32 | 고객 서버 검증 | 설치·해지 스크립트, 내부 포트·`/ext/customer-auth/`, 화면 등록 → 사이트 서버 역할 로그인 → 외부 조회 | S13·S14 | C8 |

## 5. 범위 밖·backlog

손님 비밀번호 변경·재설정, 서명 키 교체, API 키 마지막 사용 시각·만료일, 손님 로그인을 OIDC 제공자 방식으로 바꾸기, 손님 셀프 가입.
