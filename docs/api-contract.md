# C2 API 계약 0.1.0

2026-10-08. C2의 구현자 결정 범위를 고정한다. 상담 위젯의 T2 방문자 정책과는 별개다.

내부 경로는 `/customer-auth/guests`(GET 목록, POST 생성), `/:id`(GET, PATCH, DELETE), `/customer-auth/api-keys`(GET, POST), `/:id`(DELETE 회수)다. 회원 RS256 Bearer는 j-auth의 정확한 issuer·tenant·단일 aud `j-customer-auth-db`·azp `j-groupware`·회원 sid를 만족해야 한다. 읽기는 `guest:read` 또는 `guest:write`, 변경 및 키 관리는 `guest:write`만 허용한다. Cookie는 거부한다. 서비스 키는 이 서버의 회원 인증을 대체하지 않는다.

손님/키 id는 UUID, tenant는 외부 설정 및 검증된 회원 claim에서만 정한다. 이름은 공백 제거 후 1~120자, 연락처는 공백 제거 후 0~256자이며 제어문자는 거부한다. 로그인 ID는 대소문자 변환 없이 `[a-z0-9][a-z0-9._-]{2,63}`이며 tenant 안에서 유일하고 중복은 409다. 생성 비밀번호는 Unicode 12~128자/UTF-8 512바이트 이하이며 공백을 보존한다. 수정은 이름·로그인 ID·연락처만 허용한다. 비밀번호 변경·재설정은 제공하지 않는다. 알 수 없는 필드(tenant 포함)는 400이다. 요청 본문은 16KiB 이하이다.

목록은 `q`(최대 120자, 이름/ID/연락처의 literal 부분 문자열), `limit`(기본 50, 1~100), `cursor`를 받는다. UUID 오름차순 keyset 페이지다. cursor는 HMAC-SHA256로 tenant·검색어·마지막 id에 묶고 외부 설정의 독립 256비트 키를 사용한다. 타 tenant·다른 검색어·조작 cursor는 400이다. 목록·단건에는 tenant·비밀번호 원문·해시를 반환하지 않는다.

외부 경로는 `GET /ext/customer-auth/v1/guests`, `POST /ext/customer-auth/v1/login`, `GET /ext/customer-auth/v1/jwks`, `GET /ext/customer-auth/openapi.json`이다. 외부 쓰기 route는 제공하지 않는다. 목록/로그인은 사이트 **서버**가 `X-JCADB-API-Key`를 보낸다. 키는 `jcadb_`+32 랜덤 바이트의 base64url(43자), DB에는 SHA256 해시만 저장한다. 발급 응답은 `{apiKey,secret}` 201 한 번이며 목록/회수 응답에는 metadata만 있다. `guest:write`는 read를 포함한다. 알 수 없는/빈/중복 scope는 400. 회수 완료 후 새 인증은 즉시 거부하며 먼저 시작한 인증 트랜잭션이 끝날 때까지 회수는 대기한다. 외부 API는 Cookie/Authorization을 거부해 회원/손님 JWT 혼용을 막는다. JWKS와 OpenAPI는 공개다.

로그인은 `{loginId,password}`를 받아 `{accessToken,tokenType:"Bearer",expiresIn:300}`을 반환한다. JWT는 RS256(RSA 최소 2048비트), `kid=base64url(SHA256(SPKI 공개키))`, issuer=`https://gw.<tenant>.jgw.test/ext/customer-auth`, aud=`j-customer-auth-db-guest`, sub=손님 UUID, tenant·typ=Guest·iat·exp를 포함하며 수명은 300초다. 외부 PKCS8 private key는 읽기 전용/비공개 파일로 전달한다. JWKS에 private material은 없다. 이 JWT는 API 키나 j-auth 회원 JWT를 대체하지 않는다. 키 교체는 이후 범위다.

로그인 ID 없음과 암호 불일치는 동일 401 `invalid_credentials`다. 없는 ID도 dummy Argon2id 검증을 실행한다. DB/JWKS 장애는 503이며 내부 오류/SQL/키를 응답하지 않는다. 실패를 포함한 모든 유효 API 키 로그인 시도는 tenant별 peer IP 60회/60초, loginId 10회/300초의 PostgreSQL 고정 시간창으로 제한한다. 성공/실패 및 서버 재시작에도 카운터는 유지된다. Argon2 작업 동시 실행은 프로세스당 4개이며 초과는 429다. 프록시 헤더는 신뢰하지 않아 직접 호출자가 IP를 위조할 수 없다. gateway는 실제 원격 IP의 별도 제한을 제공해야 하며 backend IP 제한은 gateway 연결 주소를 기준으로 동작한다. gateway 예외 경로/속도 제한 연결은 별도 설치 검증이다.

비밀번호는 정확히 `@node-rs/argon2` 2.2.2, Argon2id v19, memory=19456KiB, iterations=2, parallelism=1, output=32바이트, 랜덤 salt로 저장한다. 근거: [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [공식 패키지](https://github.com/napi-rs/node-rs/tree/main/packages/argon2). Fastify 5.12.5와 [호환되는 Swagger 9](https://github.com/fastify/fastify-swagger#compatibility)의 9.9.1을 고정해 외부 route의 실제 schema에서 OpenAPI를 만든다. 내부 관리 route/secret 예제는 숨긴다.

오류는 `{error,message}`다. 400 invalid_request, 401 unauthenticated/invalid_credentials, 403 forbidden, 404 not_found, 409 conflict, 429 rate_limited, 503 unavailable이다. 비밀번호·키·서명 private key·토큰은 로그에 남기지 않는다. 응답은 JWKS(공개 300초 캐시) 외에 no-store다. C8 VM·UI·gateway 검증 및 registry 게시는 코드 구현/로컬 설치 검사와 구분한다.
