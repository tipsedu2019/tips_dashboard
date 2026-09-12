# 홈페이지 관리·채용 접수 배포 후보 — 2026-09-13

## 후보와 범위

최신 `origin/main` `b7afcf3466997880382f6d8ce3ea2fc0800e8b2d`에서 만든 `codex/public-renewal-backend-20260913`에 기존 승인 구현을 선별 이식했다. 원본은 `tips_dashboard-classes-apple-20260911`의 작업 파일이며 기준 HEAD는 `5c94199f298ffb5c6193e59c64ae4ac94ffe7254`다. 원본의 수업 UI·PublicSelect·공용 공개 화면은 이식하지 않았다. 수업 summary API는 별도 담당의 변경이다.

이 기능의 원본 범위는 37개 파일이다. `src/features/public-content/**`, `src/features/recruiting/**`, 관리자 페이지 2개, 해당 관리자/공개 API route 7개, 기존 migration 2개, 전용 테스트 4개와 DB/browser 검증 스크립트 4개, 운영 문서 2개, 메뉴 관련 4개 파일이다. `app-sidebar.tsx`, `command-search.tsx`, `navigation.ts`, `admin-shell.test.mjs`는 이전 파일 전체를 덮지 않고 최신 main에 검토한 최소 diff를 적용했다. 추가로 메뉴 회귀 테스트를 채용과 CMS 양쪽 경로로 확장했고, CMS 문서에 공개 `/admin` 프록시의 허용 Origin 설정을 보충했다. 이 릴리스 기록은 새 문서다.

기존 마이그레이션 파일과 승인 seed는 원본 바이트를 유지했다. 새 migration, 운영 teacher 계정 변경, 자동 seed 실행, 이메일·메시지 발송 기능은 추가하지 않았다.

## 로컬 검증 완료

- `node --experimental-strip-types --test tests/public-content-contract.test.mjs tests/public-content-xlsx.test.mjs tests/recruiting-intake.test.mjs tests/admin-shell.test.mjs`: 66개 통과. 실제 role 기반 메뉴와 API 권한, 입력·마스킹, XLSX 날짜, 원문·점수 보존, 초기 승인 자료, 공개 빈 목록/cache/fallback, 730일/v2 동의, origin/body/quota 응답, 서버 adapter 계약을 포함한다.
- 해당 feature/route/메뉴/테스트 대상 ESLint: 오류 없음.
- 후보 전체 `tsc --noEmit --incremental false`: 통과.
- `scripts/verify-public-content-local-db.mjs`: 격리 Supabase PostgreSQL 17.6.1.159의 14개 검증 그룹 통과. 실제 migration/RLS/ACL/SQLSTATE, 원자 저장·실패 롤백·재시도·버전 충돌·생성/수정 동시성, 초기 3,921건 보존을 검증했다.
- `scripts/verify-recruiting-local-db.mjs`: pgTAP 39개, 중복 요청 8회에 지원서 1개, 동일 IP 동시 10건 중 5건 허용, 실제 pg_cron worker 성공 확인. 새 730일/v2 정책과 이전 365일/v1 보존을 포함한다.
- DB 컨테이너는 외부 URL이나 host port를 받지 않으며 종료 시 제거했다. 각각 `artifacts/public-content-20260912/database-results.json`, `artifacts/recruiting-20260911/database-results.json`에 기록했다.

이 검증의 auth 역할과 Storage 스키마는 격리 fixture다. 운영 사용자 로그인, Storage HTTP 업로드, 전체 운영 migration chain, 공개→dashboard rewrite의 IP 전파, 실제 지원서 제출·삭제 또는 발송을 증명하지 않는다. 통합 build와 후보/운영 URL 검증은 배포 총괄이 별도로 수행한다.

## 활성화 순서

1. 운영 read-only 점검으로 현재 migration ledger와 아래 두 파일의 부재/동일성을 확인한다. 기존 `auth.uid()`, 최종 `public.current_dashboard_role()`, `storage.buckets`/`storage.objects`, `cron.job`가 있어야 한다. 이전 날짜의 migration이므로 단순 전체 DB push로 다른 보류 migration까지 적용하지 않는다.
2. 서버 전용 Supabase URL, 기존 anon key, `SUPABASE_SERVICE_ROLE_KEY`를 준비한다. 키의 값은 이 문서·로그·클라이언트에 기록하지 않는다. 최초 배포에서는 `PUBLIC_CONTENT_MANAGEMENT_ENABLED`, `PUBLIC_CONTENT_PUBLIC_READ_ENABLED`, `RECRUITING_APPLICATIONS_ENABLED`를 false/미설정으로 유지한다.
3. 승인된 DB 절차로 `20260911102816_recruiting_applications_private_intake.sql`을 먼저, `20260912074228_public_site_content_management.sql`을 다음에 선별 적용한다. 전자는 pg_cron이 없으면 실패하고, 매시 13분 정리 작업과 초기 1회 파기를 예약/실행한다. 두 기능의 테이블은 새로 생성된다. 후자는 private `public-site-media` bucket을 생성한다.
4. backend 배포 후 관리자/API route 존재, 익명 401/권한 없는 사용자 403, feature-disabled 공개 GET/접수 503을 확인한다. 공개 사이트 프록시는 POST 본문, Authorization, Content-Type, Origin, 오류 상태, Retry-After를 보존해야 한다.
5. CMS는 `PUBLIC_CONTENT_MANAGEMENT_ENABLED=true`만 먼저 켠다. `PUBLIC_CONTENT_ALLOWED_ORIGINS`에 실제 public/admin HTTPS origin을 정확하게 명시하고 `PUBLIC_CONTENT_SITE_ORIGIN=https://tipsedu.co.kr`로 기존 승인 미디어 위치를 맞춘다. API 공개 읽기는 계속 닫는다.
6. 관리자가 `/admin/public-content`에서 `기존 홈페이지 자료 가져오기`의 수량을 확인하고 명시적으로 적용한다. 7명·110건·3,804건, 총 3,921건을 보존하며 동일 요청 재시도는 중복을 만들지 않는다. 기존 행이 있으면 초기 가져오기를 거부한다. 이 작업을 migration/배포가 자동 실행하지 않는다.
7. 관리자 목록과 공개 상태를 확인한 후 마지막으로 `PUBLIC_CONTENT_PUBLIC_READ_ENABLED=true`를 켠다. 성공한 빈 목록은 의도적인 빈 목록이므로, 초기 자료가 없는 채로 먼저 켜지 않는다. 공개 GET/asset rewrite와 실제 media 로드를 확인한다.
8. 채용은 `RECRUITING_ALLOWED_ORIGINS`에 실제 폼 및 관리자 origin, `RECRUITING_RATE_LIMIT_SECRET`에 모든 인스턴스가 공유할 32자 이상 고정 비밀을 설정한다. `recruiting-retention-cleanup` 활성 상태·최근 성공 시각·다음 실제 실행을 확인하고 아래 IP 경계 검증을 마친 뒤 `RECRUITING_APPLICATIONS_ENABLED=true`를 켠다. 새 신청은 730일 보관의 `talent-pool-v2` 동의를 요구한다. 접수처는 `/admin/recruiting`이며 이메일 알림/전송은 없다.

## 남은 운영 확인과 제한

- **Proxy IP 예산:** 서버는 `VERCEL=1`일 때 `x-vercel-forwarded-for`만 신뢰한다. 공개 Vercel에서 dashboard Vercel로 외부 rewrite한 요청이 실제 방문자별 IP를 보존하는지는 운영 경로에서 확인해야 한다. 누락/중간 프록시 IP면 방문자들이 보수적인 5회/시간 예산을 공유할 수 있다. 임의 `X-Forwarded-For`를 신뢰하도록 우회하지 않는다. 연락처 3회/일·전체 100회/시간 예산도 유지된다.
- **Retention:** 정리 성공이 3시간 이상 오래되면 접수는 503으로 닫히며 관리자 경고가 나온다. 이것은 운영자에게 메시지를 보내는 모니터가 아니다. DB 작업 상태의 운영 점검이 필요하다. 기존 v1 기간을 2년으로 소급 연장하지 않는다.
- **Media:** private Storage HTTP의 실제 업로드/서명 URL, 공개된 교사만 접근 가능한 asset endpoint를 운영에서 검증해야 한다. 이미 발급된 서명 URL은 600초 동안 유효하며 미사용 업로드의 정리 정책은 별도다.
- **실제 저장:** 본 작업은 원격 push/deploy/migration, 관리자 seed 적용, 실제 파일 업로드, 지원서 제출/삭제, 이메일·메시지 전송을 수행하지 않았다.
- **중단:** 관리 편집 중단은 `PUBLIC_CONTENT_MANAGEMENT_ENABLED=false`로 공개 읽기와 분리할 수 있다. 공개 API 문제 때 읽기를 닫으면 승인 정적 fallback이 유지된다. 채용 장애 시 `RECRUITING_APPLICATIONS_ENABLED=false`로 접수를 닫고 원인을 해결한다. 데이터 테이블을 제거하는 rollback은 하지 않는다.

## 참고한 공식 문서

[RLS와 명시적 권한](https://supabase.com/docs/guides/database/postgres/row-level-security), [함수 권한](https://supabase.com/docs/guides/database/functions), [Supabase 변경 기록](https://supabase.com/changelog). 2026-09-13 확인한 변경 기록의 extension version pinning 변경은 이 두 migration에 영향이 없다(새 extension version을 지정하지 않음). 역할 정책·발송 범위는 기존 TIPS 계약을 유지했다.
