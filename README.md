# j-customer-auth-db

손님 정보 DB·인증과 사이트 서버용 API. 관리 화면은 j-groupware가 제공한다.

Part of the j-groupware suite. See `j-groupware/docs/architecture.md`.

Node.js 22.18 이상, 전용 PostgreSQL 18 DB/계정 `jgw_customer_auth`를 사용한다.
`apps/server`는 loopback HTTPS 서버, `packages/contracts`는 DTO·규칙이다.
관리 Bearer, API 키, 손님 JWT를 각각 검증하고 다른 인증 수단으로 대체하지 않는다.
상세 규칙은 [API 계약](docs/api-contract.md), 범위는 [기능 명세](docs/feature-specifications.md)를 따른다.

설치 후 `npm run check`로 build·typecheck·단위 시험·lint·format을 실행한다.
시작은 외부 env를 지정해 `node --env-file=/외부/파일 apps/server/dist/main.js`로 실행한다.
[env 예제](deploy/customer-auth.env.example)의 placeholder는 실제 외부 설정으로 교체해야 한다.
TLS/CA·서명 private key는 체크아웃 밖의 보호된 경로에 둔다. 포트 3001은 사용하지 않는다.
시작 시 migration은 자기 DB의 전용 비특권 계정만 허용하고 적용된 SQL checksum 변경을 거부한다.

실제 j-auth·Keycloak·OIDC Authorization Code·단일 audience 교환과 PostgreSQL을 연결한 시험은
`j-groupware/tests/bff/customer-auth.integration.test.ts`다. 두 저장소를 build한 뒤
그 저장소의 격리 환경·`TMPDIR` 지침으로 해당 파일을 실행한다.
환경이 없으면 실패하며 통합 시험을 건너뛰어 통과로 표시하지 않는다.
이 저장소의 `npm run test:integration`은 이 교차 저장소 시험을 실행한다.
contracts registry 게시, installer/gateway 연결, 정식 UI와 C8 실제 VM 인수는 별도 미완료다.
