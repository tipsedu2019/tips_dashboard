# 홈페이지 콘텐츠 관리

## 범위와 진입

관리자 사이드바 **관리 → 홈페이지 관리** (`/admin/public-content`)에서 선생님 소개, 공개 후기, 성적 공유를 관리한다. `current_dashboard_role() = 'admin'`인 계정만 사용할 수 있다. 운영 계정/반 배정용 `teacher_catalogs`와 홈페이지 콘텐츠는 별도이며, 홈페이지의 교사를 숨기거나 삭제해도 운영 교사 계정에는 영향을 주지 않는다.

채용 지원서 확인은 기존 **관리 → 채용 지원서** (`/admin/recruiting`)에서 계속 처리한다. 이 CMS는 지원서나 학생 성적 원장으로부터 개인정보를 자동 수집하지 않는다.

## 관리자 사용 흐름

- **직접 추가/수정:** 내용을 입력하고 `내용 검토`에서 저장할 모든 항목과 공개 상태를 확인한 뒤 적용한다. 이름·과목·소개·사진·영상·공개 여부를 수정할 수 있다. 선생님 순서는 같은 과목 안에서 위/아래 이동하거나 표시 순서 값을 수정한다.
- **숨김/삭제:** 초안으로 저장하면 공개 목록에서 숨긴다. 삭제도 별도 확인 후 적용되며, 홈페이지 관리 행만 삭제한다.
- **한 번에 가져오기:** CSV, TSV, XLSX 또는 엑셀 표 붙여넣기를 사용한다. 양식의 첫 줄 항목 이름이 필요하다. 한 번에 최대 500행이며 오류가 있으면 아무 행도 적용하지 않는다. 다음 확인 화면에서 `모두 초안`(기본) 또는 `모두 공개`를 선택한다. XLSX 첫 시트의 날짜 형식과 1900/1904 날짜 체계를 지원한다.
- **검색:** 이름·학교·시험·후기 원문·선생님을 검색하고 과목/공개 상태를 조합한다. 페이지당 10/15/20개를 선택한다.
- **업로드:** PNG/JPEG/WebP 8MB, MP4/WebM 40MB 이내. 파일을 바꾸면 저장 예정 미리보기가 바뀐다. 선택 해제 시 이전 미리보기도 제거한다. 사진/영상이 웹에서 사용할 최종 파일이어야 하며 업로드 자체가 캐릭터 영상을 생성하지는 않는다.
- **공개 확인:** 화면 아래 공개 미리보기 링크는 공개 사이트의 해당 페이지를 새 탭으로 연다. 원본 편집 흐름은 남는다.

후기·성적은 마스킹한 공개 이름만 저장한다. `김ㅇ민`처럼 이미 승인된 마스킹은 유지하며, 복합 이름의 각 이름도 가린다. 후기 본문 앞뒤 공백과 줄바꿈, 성적의 빈 점수·소수 점수·등급·석차는 보존한다.

## 최초 자료 연결

비어 있는 관리 목록에서 `기존 홈페이지 자료 가져오기`를 실행하면 현재 승인된 선생님 7명, 후기 110건, 성적 3,804건을 한 트랜잭션으로 가져온다. 관리자에게 종류별 수량을 먼저 표시한다. 원본 승인 seed는 `src/features/public-content/data/approved-seed.json`이며, 기존 캐릭터 연결(`legacyId`), 원문, 성적 source ID를 유지한다.

같은 적용 요청을 다시 보내도 중복 저장하지 않는다. 기존 관리 자료가 있으면 초기 가져오기를 거부한다. 원본에는 내용이 같은 성적 행 13건이 포함되어 있어 내용 기준으로 임의 중복 제거하지 않는다. 새로운 파일을 별도 가져오기로 다시 적용하는 것은 새 행 추가이며, 자동으로 기존 행을 병합하지 않는다.

## 운영 연결 전제

현재 구현·검증은 로컬이다. 원격 migration 적용, 운영 공개 전환, 실제 Storage 업로드는 이 문서 작성 과정에서 수행하지 않았다.

연결 시 필요한 구성:

1. 승인 후 `supabase/migrations/20260912074228_public_site_content_management.sql` 적용. 기존 `auth.uid()`, `current_dashboard_role()`와 Supabase Storage 스키마를 사용한다.
2. 기존 Supabase URL/anon key 및 서버 전용 service role key 연결. service key는 업로드 서명과 공개된 파일의 짧은 서명 발급에만 서버에서 사용한다.
3. `PUBLIC_CONTENT_MANAGEMENT_ENABLED=true`로 관리자 기능만 켜고, `PUBLIC_CONTENT_PUBLIC_READ_ENABLED`는 비활성 상태로 둔다. 승인된 초기 자료를 관리자 화면에서 가져온 뒤 수량과 공개 상태를 검토한다. 이 동안 공개 GET/asset은 `503 content_not_enabled`여서 기존 승인 사이트가 유지되고 빈 목록이 노출되지 않는다.
4. 공개 사이트의 `/api/public-content`와 `/api/public-content/assets/*` GET 경로를 CMS API와 연결하고, 준비된 자료를 확인한 뒤 **마지막에** `PUBLIC_CONTENT_PUBLIC_READ_ENABLED=true`로 공개 읽기를 활성화한다. 두 설정은 별도이다. 이후 관리자 편집 기능을 일시 중단해도 공개 읽기 설정을 유지하면 기존 공개 내용은 남는다. 관리자 쓰기 API는 로그인한 대시보드에서만 호출한다.
5. 기존 `/assets/landing/...` 파일은 공개 사이트가 소유한다. 관리자 컴포넌트 `assetOrigin`은 기본 `https://tipsedu.co.kr`이며 로컬 fixture는 공개 preview origin을 주입한다. 서버 목록의 기존 파일 URL 기준은 `PUBLIC_CONTENT_SITE_ORIGIN`으로 설정할 수 있다. 새 Storage 파일은 서명 URL을 그대로 사용한다.

관리자 화면을 공개 사이트의 `/admin` 프록시로 여는 경우에는 `PUBLIC_CONTENT_ALLOWED_ORIGINS`에 브라우저가 사용하는 공개·관리자 origin을 쉼표로 명시한다. 서버가 보는 요청 URL의 origin과 실제 브라우저 Origin이 다를 수 있기 때문이다. 값은 경로·와일드카드·말미 `/` 없는 정확한 HTTPS origin으로 지정한다. 이 설정은 기존 bearer 사용자 확인과 admin 권한을 대체하지 않는다. 읽기 API에는 인증 토큰이나 service key를 브라우저에서 추가하지 않는다.

공개 API는 `?kind=teachers|reviews|results`별 `{ok:true,schemaVersion:1,kind,records}`를 반환한다. **성공한 빈 records는 권위 있는 빈 목록**이다. 서비스 미연결/실패 때만 공개 사이트가 승인된 정적 fallback을 사용한다. 일반 응답은 CDN 60초 + stale-while-revalidate 120초이며, `?refresh=1` 요청은 no-store다.

미디어는 private bucket `public-site-media`에 저장한다. 현재 공개된 교사의 이미지/영상으로 참조되는 경로만 공개 asset API가 600초 서명 URL로 연결한다. 이미 발급한 서명 URL은 만료 전까지 유효하므로 숨김·삭제가 기존 URL을 즉시 무효화하지는 않는다. 업로드 후 저장하지 않거나 교사 행을 삭제해도 파일을 즉시 삭제하지 않는다. 운영 연결 시 참조되지 않는 파일의 정리 정책을 별도로 정해야 한다.

## 검증과 범위

- `node --experimental-strip-types --test tests/public-content-contract.test.mjs tests/public-content-xlsx.test.mjs`: 20개 통과. 입력/마스킹, 원문·점수 보존, 승인 seed, 인증·권한·origin, 공개 필드/빈 목록/cache, 실제 XLSX ZIP/날짜 변환 포함.
- `node --experimental-strip-types scripts/verify-public-content-local-db.mjs`: 외부 주소를 받지 않는 독립 Docker PostgreSQL을 만들고 제거한다. migration, RLS/권한, 원자 저장, 요청 재시도, 버전 충돌, null/타입 검증, 생성·수정 각각 5개 동시 요청, 삭제, 3,921건 초기 적용을 14개 그룹으로 검증한다. 결과는 `artifacts/public-content-20260912/database-results.json`.
- DB 검증은 Supabase PostgreSQL 17.6.1.159를 실제 실행한다. `current_dashboard_role`은 이 격리 DB에만 만든 역할 fixture이며, Storage API 미포함 이미지라 buckets/objects 두 테이블도 정책 DDL 검증용 최소 fixture다. Storage HTTP 서비스에 실제 파일을 저장한 증거는 아니다.
- 실제 관리자 컴포넌트와 API 핸들러를 메모리 store에 연결한 3196 브라우저 검증 및 Next 빌드/route 검증은 통합 담당의 별도 결과를 확인한다. 로그인 fixture/메모리 저장이 실제 운영 계정·실제 DB 저장을 증명하지 않는다.
