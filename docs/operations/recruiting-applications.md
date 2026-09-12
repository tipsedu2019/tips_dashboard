# 상시 채용 지원서 운영

이 변경은 로컬 구현입니다. 원격 마이그레이션 적용, 환경변수 활성화, 배포, 실제 지원서 저장·삭제·발송은 수행하지 않았습니다. 현재 기본 설정에서는 공개 접수가 `503 recruiting_unavailable`을 반환합니다.

## 접수 계약

`POST /api/recruiting/applications`, JSON, 최대 **16,384 UTF-8 bytes**. URL query를 사용하지 않습니다. 공개 조회 API는 없습니다.

| 필드 | 조건 |
| --- | --- |
| requestId | UUID v4. 같은 내용의 네트워크/503 재시도는 같은 값, 내용 수정은 새 값 |
| name | 2–80자 |
| phone | 숫자 8–15자리, 앞의 `+` 허용. 입력의 공백/괄호/하이픈 제거 |
| subject | 영어 / 수학 / 과학 |
| experience | 1–2,000자 |
| motivation | 10–3,000자 |
| portfolioUrl | 선택, 1,000자 이내 HTTPS URL. URL 내 계정정보 금지. 서버가 URL을 가져오지 않음 |
| talentPoolConsent | 반드시 JSON boolean `true` |
| consentVersion | 현재 `talent-pool-v2` |
| website | 선택, 빈 문자열. 화면에서 숨기는 honeypot |

성공은 `201 {ok:true,applicationId,receivedAt}`입니다. 같은 요청의 재전송도 같은 접수번호와 시간을 반환합니다. 제출 내용이나 연락처를 되돌려주지 않습니다. 응답은 `no-store, private`입니다.

오류는 `{ok:false,code,fieldErrors?:{[field]:string}}`입니다. `400 invalid_request`, `408 request_timeout`, `413 payload_too_large`, `415 unsupported_media_type`, `403 origin_not_allowed`, `409 request_id_reused`, `410 application_no_longer_retained`, `429 rate_limited`(+ `Retry-After`), `503 recruiting_unavailable`를 사용합니다. 503/연결 오류는 저장이 안 됐다고 단정할 수 없으므로 동일한 `requestId`로 재시도합니다. 삭제된 요청의 410을 받으면 자동으로 새 요청번호를 만들어 재제출하지 않습니다.

지원서나 토큰을 URL, 콘솔, analytics, 오류보고, session replay에 넣지 않습니다. 폼 내용을 브라우저 저장소에 보관하지 않습니다. 로그 수집기/APM에서 요청 본문과 Authorization을 수집하지 않도록 운영 설정도 확인합니다.

## 필요한 운영 설정

다음은 **서버 전용** 설정입니다. 로컬 `.env.local`을 변경하지 않았습니다.

| 환경변수 | 값/역할 |
| --- | --- |
| `RECRUITING_APPLICATIONS_ENABLED` | 마이그레이션/정리 작업/동의문구 확인 후 `true` |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버에서 접수 RPC를 호출할 키. `NEXT_PUBLIC_` 접두사 금지 |
| `SUPABASE_URL` 또는 기존 `NEXT_PUBLIC_SUPABASE_URL`/`VITE_SUPABASE_URL` | 같은 프로젝트의 URL |
| 기존 `NEXT_PUBLIC_SUPABASE_ANON_KEY`/`VITE_SUPABASE_ANON_KEY` | 관리자 API의 사용자 토큰 검증 및 RLS 클라이언트 |
| `RECRUITING_RATE_LIMIT_SECRET` | 최소 32자 무작위 서버 비밀. HMAC용이며 모든 인스턴스에서 같게 유지 |
| `RECRUITING_ALLOWED_ORIGINS` | 실제 폼과 관리자 화면의 정확한 origin을 쉼표로 구분. 경로/와일드카드/말미 `/` 금지. 예: `https://tipsedu.co.kr,https://실제-관리자-도메인` |

관리자 삭제에도 origin 목록이 필요합니다. 개발 미리보기는 명시한 `http://127.0.0.1:3189`/`http://127.0.0.1:3190`만 허용할 수 있습니다. 외부 HTTP origin은 허용하지 않습니다. 브라우저는 동일 origin으로 요청하고 프록시가 POST 본문·Content-Type·Origin·상태·Retry-After를 보존해야 합니다. CORS로 임의 외부 사이트를 열지 않습니다.

IP 원문을 저장하지 않습니다. Vercel 환경(`VERCEL=1`)의 `x-vercel-forwarded-for`만 HMAC 입력으로 사용하며, 다른 환경 또는 누락/잘못된 IP는 공통의 보수적인 IP 예산을 사용합니다. 임의 `X-Forwarded-For`를 신뢰하지 않습니다. Vercel 외 환경은 신뢰 프록시 설계를 별도로 검토하기 전까지 이 동작을 유지합니다. [Vercel 요청 헤더](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for)

현재 공개 프로젝트의 기존 `/api/:path*` 외부 rewrite는 dashboard Vercel 프로젝트를 향합니다. 이 **서로 다른 Vercel 프로젝트를 지나는 경로에서 최종 IP 헤더가 실제 방문자를 보존하는지는 아직 실운영 검증하지 않았습니다.** Vercel 문서는 프록시 뒤의 X-Forwarded-For를 덮어쓰며 외부 IP를 그대로 전달하지 않는다고 설명합니다. 따라서 최종 hop이 중간 프록시 IP로 표시되면 여러 방문자가 같은 5회/시간 예산을 공유할 수 있습니다. 이는 문서에 근거한 운영상 가능성이며, 현재 production 경로에서 관측된 현상으로 주장하지 않습니다. 활성화 전에 실제 rewrite 경로의 신뢰 헤더 동작을 개인정보 저장 없이 확인하고, 필요한 경우 검증된 Trusted Proxy/서명된 서버 간 IP 전달 설계를 적용합니다. 이 확인 없이 일반 클라이언트의 X-Forwarded-For를 대체값으로 신뢰하거나 IP 예산을 조용히 해제하지 않습니다. [Vercel X-Forwarded-For 정책](https://vercel.com/docs/headers/request-headers#x-forwarded-for)

DB의 원자적 quota는 전체 100회/시간, IP fingerprint 5회/시간, 연락처 fingerprint 3회/일입니다. 경계는 UTC 고정 시간/일 창입니다. 재시도 성공은 quota를 소비하지 않습니다. 거절된 시도도 상위 예산을 소비할 수 있습니다. fingerprint는 최대 2일 + 정리 지연 뒤 삭제됩니다. CAPTCHA/전화 소유 확인/메시지 발송은 이번 범위에 없습니다. Origin 확인만으로 봇을 인증하는 것은 아니므로 DB quota도 함께 적용합니다.

`RECRUITING_RATE_LIMIT_SECRET` 교체는 기존 요청 hash를 바꾸므로 재시도에 409가 날 수 있습니다. 단순 정기 재시작 때 재생성하지 않습니다. 유출 등으로 교체할 때에는 접수를 잠시 닫고 이 영향을 안내합니다.

## 배포 시 프록시 IP 비교 확인

`GET /api/recruiting/applications`에는 임시 운영 진단이 있다. 서버 전용 `RECRUITING_PROXY_PROBE_SECRET`을 별도 무작위 32자 이상으로 설정하고, 정확한 `Authorization: Bearer <일회용 키>`를 보낸 경우에만 사용할 수 있다. 이 키는 `RECRUITING_RATE_LIMIT_SECRET`이나 Supabase 키를 재사용하지 않는다. 키가 없거나 짧은 경우, 인증 실패, GET 이외 메서드 또는 query가 있는 요청은 `405`다. 공개 지원서 조회 기능이 아니며 지원서·인증·quota 테이블과 네트워크를 전혀 사용하지 않는다.

성공 응답은 `{addressHash,resolved}`만 포함한다. `addressHash`는 현재 접수 제한에 사용하는 `clientAddress` 결과를 일회용 키로 HMAC-SHA256 처리한 값이고, `resolved`는 유효한 주소를 얻었는지 표시한다. 응답은 `no-store, private`이며 원문 IP·키·hash를 서버 로그에 쓰지 않는다. 운영자도 키를 URL/명령 기록에 넣거나 응답 hash를 공유 로그에 출력하지 않는다.

1. 일회용 키가 포함된 검수용 배포에서 같은 네트워크로 dashboard 직통 URL과 `https://tipsedu.co.kr/api/recruiting/applications`에 각각 인증된 GET을 보낸다. 비교 프로그램 메모리 안에서 두 `addressHash`의 동일 여부와 두 `resolved`가 true인지 확인하고, 결과 boolean만 기록한다. 실제 POST나 지원자 입력은 필요 없다.
2. 동일한 두 경로에서 시험용 `X-Forwarded-For`, `X-Real-IP`, `X-Vercel-Forwarded-For`를 바꾼 GET을 보낸다. 플랫폼이 신뢰 헤더를 올바르게 보정하여 비교 결과가 원래 요청과 같아야 한다. 클라이언트가 보낸 `X-Forwarded-For`를 신뢰하는 대체 처리를 넣지 않는다.
3. 경로별 hash가 다르거나 unresolved이면 프록시 IP 경계가 확인되지 않은 것이다. 접수의 실제 IP 제한이 정상이라고 보고하지 않고, 경로/플랫폼 헤더를 수정한 뒤 다시 검증한다. 같은 네트워크에서의 일치가 모든 proxy 조합을 증명하는 것은 아니다.
4. 검증 후 **`RECRUITING_PROXY_PROBE_SECRET`을 제거하고 그 설정이 반영된 배포를 완료**한다. 이전 키를 포함한 GET도 `405`인지 확인한다. 접수 활성화·rate-limit 키는 별개로 유지한다. 진단 코드와 GET export도 후속 정리에서 제거할 수 있다. 기존 검수 deployment URL은 운영 진단 키가 남지 않도록 폐기하거나 보호한다.

## 보관·삭제

사용자가 확정한 신규 접수 정책은 **2년(730일), talent-pool-v2**입니다. `src/features/recruiting/recruiting-policy.ts`의 기간·동의 버전과 공개 폼 고지/전송 버전을 함께 맞춥니다. 마이그레이션은 기존 `365` + `talent-pool-v1`, 신규 `730` + `talent-pool-v2` 두 쌍만 허용합니다. 새 공개 접수는 v2 동의를 요구하며, 기존 지원서의 v1 동의 버전·보관기간·만료일은 소급 변경하지 않습니다. 접수마다 저장된 만료일을 기준으로 조회와 자동 파기를 처리합니다. 기존 신청자를 2년으로 연장하는 데이터 수정은 포함하지 않습니다.

`recruiting_applications`는 개인정보와 서버가 기록한 동의 시각·버전·만료 시각을 보관합니다. `recruiting_application_receipts`는 요청 UUID, 접수 UUID, 접수/만료 시각만 보관합니다. 명시적 삭제 시 지원서 내용과 request hash는 삭제되고, receipt의 접수 UUID는 FK에 의해 NULL이 됩니다. 남은 무작위 요청 UUID는 원래 보관 만료일까지 늦은 재시도의 재저장을 막습니다. 지문 테이블은 단기 abuse 방어용입니다.

모든 새 테이블에 RLS가 적용됩니다. anon은 테이블/RPC 권한이 없습니다. authenticated는 기존 `current_dashboard_role()`이 **admin**이고 유효한 사용자일 때만 기간 내 지원서를 SELECT/DELETE할 수 있습니다. staff/teacher/viewer는 읽거나 삭제할 수 없습니다. 수정/추가 권한도 없습니다. 접수·파기 RPC의 PUBLIC/anon/authenticated EXECUTE는 회수하고 service_role에만 부여합니다. 기존 인증 함수/권한은 수정하지 않습니다. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [함수 권한](https://supabase.com/docs/guides/database/functions#function-privileges)

관리자는 **관리 → 채용 지원서**(`/admin/recruiting`)에서 이름·연락처·과목·접수일·만료일 목록과 경력·지원 동기·선택 링크·동의 기록을 열람합니다. 목록은 10/15/20개씩 조회합니다. 삭제 요청자의 본인을 기존 업무 방식으로 확인한 뒤 지원서 상세의 **삭제 요청 처리 → 지원서 영구 삭제**를 누릅니다. 삭제는 되돌릴 수 없습니다. CSV/파일 내보내기나 발송 기능은 없습니다.

## 자동 파기와 복구

CLI로 생성한 `supabase/migrations/20260911102816_recruiting_applications_private_intake.sql`을 승인된 배포 절차에서 적용해야 합니다. 기존 `pg_cron`이 없으면 migration은 `recruiting_requires_pg_cron`으로 실패합니다. Migration은 테이블·권한·함수만 설치하며 작업 예약이나 초기 파기를 실행하지 않습니다. 설치 직후에는 정리 성공 시각이 없으므로 접수가 unavailable로 닫혀 있습니다.

Migration 성공 후 승인된 DB 운영자가 `scripts/operations/activate-recruiting-retention.sql`을 명시적으로 실행합니다. 이 파일은 자동 migration chain 밖에 있으며 `RECRUITING_APPLICATIONS_ENABLED=false`인 상태에서 적용합니다. `recruiting-retention-cleanup`을 매시 13분(`13 * * * *`)에 예약하고 초기 파기를 한 번 실행합니다. 예약과 초기 파기는 한 transaction이며 어느 쪽이든 실패하면 롤백합니다. 같은 DB 운영자 재실행은 동일한 이름의 작업 하나를 유지합니다.

함수 `public.purge_expired_recruiting_applications_v1()`은 만료 지원서, receipt, quota를 삭제한 후 `recruiting_retention_status.last_succeeded_at`을 갱신합니다. 정상 작동 시 물리 삭제는 만료 후 다음 실행(최대 약 1시간)입니다. RLS는 만료 즉시 조회에서 제외합니다.

정리 성공이 3시간 이상 오래되면 관리자 화면에 경고하고 새 접수 RPC는 unavailable(공개 API 503)을 반환합니다. 이것은 운영자에게 알림을 보내는 기능이 아니므로 DB 모니터링에서 해당 상태를 확인해야 합니다.

승인된 운영자 DB 세션에서 아래 **읽기**로 상태를 확인할 수 있습니다. 개인정보를 조회하지 않습니다.

```sql
select jobid, jobname, schedule, active from cron.job
where jobname = 'recruiting-retention-cleanup';
select last_succeeded_at from public.recruiting_retention_status;
select status, start_time, end_time from cron.job_run_details
where jobid = (select jobid from cron.job where jobname='recruiting-retention-cleanup')
order by runid desc limit 5;
```

실패하면 접수 활성화를 끄고 DB/pg_cron 가용성, 작업 활성 상태, 권한, lock/statement timeout을 먼저 해결합니다. **실제 삭제를 수행하는 복구**도 운영 승인 범위에서 같은 `scripts/operations/activate-recruiting-retention.sql` 파일을 실행합니다. 설치용 migration을 재실행하거나 다른 cron 작업을 제거하지 않습니다.

성공 시각과 다음 예정 작업의 성공을 확인한 후 접수를 다시 엽니다. 타임아웃이 반복되면 만료 행 규모/잠금을 확인하고 정리 배치를 조정합니다. 만료 행은 일반 관리자 조회에서 숨겨지므로 장애 중 수동 정리는 승인된 DB 운영자가 파기 함수로 수행합니다. 이 코드가 공급자 백업·PITR 사본까지 삭제하는 것은 아닙니다. 공급자의 백업 보존 정책을 별도로 관리하고, 백업 복원 시 만료 정리를 실행한 후에 사이트/접수를 다시 공개합니다.

## 검증 재현

```sh
node --test --experimental-strip-types tests/recruiting-intake.test.mjs
node scripts/verify-recruiting-local-db.mjs
```

첫 명령은 네트워크를 모의 처리합니다. 두 번째는 별도 이름의 임시 Docker DB를 만들며 host 포트를 열지 않고 외부 DB URL을 받지 않습니다. Migration 직후 cron/정리 성공 기록이 없고 접수가 닫혀 있음을 확인한 뒤 활성화 SQL을 명시적으로 두 번 적용하여 작업이 하나만 유지되는지 검증합니다. 이후 실제 새 테이블/RLS/RPC와 pg_cron 확장을 검증하고 컨테이너를 제거합니다. 기존 운영 역할 해석 함수는 로컬 fixture로 대체합니다. 결과는 `artifacts/recruiting-20260911`에 기록합니다. 기존 관리자 로그인/원격 전체 migration chain/실제 고객 데이터의 운영 검증과는 별개입니다.
