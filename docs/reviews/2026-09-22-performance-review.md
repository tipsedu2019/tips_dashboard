# TIPS 전체 성능 리뷰와 개선 계획

작성일: 2026-09-22 · 상태: **진단·계획 완료, 개선 구현 전**

현재 우선순위는 **반복 조회와 전체 데이터 계산을 줄이고, 간헐적인 조회 실패의 원인을 분리하는 것**이다. 서버 증설이나 전면 재작성부터 시작할 근거는 확보되지 않았다. 학생 목록 중복 요청, 교재 목록·요약의 DB 비용, 휴보강 승인 전체 조회, 요청 취소 누락, 미디어 직렬 처리, 큰 초기 JS를 확인했다.

## 1. 검토 기준과 한계

| 항목 | 확인한 상태 |
| --- | --- |
| 최초 로컬 체크아웃 | `main`, `9f962dfcd68d18788f68eb1754d61fe1c3b1d75f` |
| 최종 코드·빌드·테스트 기준 | fetch한 `origin/main`, **`b0f16bf5e5001edcdb25410fd68a8be3297adde3`** |
| 검토 방식 | 최신 커밋을 별도 임시 디렉터리에 구성하여 조사. 원래 작업트리의 코드·기존 문서 변경은 유지 |
| 운영 브라우저 | 로그인된 Chrome의 `https://tipsedu.co.kr/admin/*`, 2026-09-22 18시대 KST, 일반 네트워크·기존 브라우저 캐시 |
| 운영 DB | linked `tips dashboard`, PostgreSQL 17.6, 서울. 운영 migration 마지막 `20260922064700` |
| DB 정의 검증 | 교재 주요 읽기 함수와 업무 목록·통계 함수는 운영 정의와 최신 migration 체인 대조. 동적 패치 포함 |
| 배포 동일성 | Vercel deployment/runtime 조회가 403, project 조회는 connector schema 오류. **운영 앱의 배포 SHA는 미확인** |
| 실행 범위 | 읽기 전용 운영 관측, 로컬 production build, 실제 코드+mock transport 재현, 선택 테스트 |
| 수행하지 않은 작업 | 앱 수정, 운영 데이터 변경, 실제 승인·발송, DB migration 적용, 배포, 부하 테스트 |

최신 소스와 운영 관측은 별도 증거다. 아래 브라우저 시간은 요청 시작부터 완료/중단까지이며 화면 완성 시간·DB 실행시간·p95가 아니다. 표본이 적으므로 전체 사용자 성능이나 실패율로 일반화하지 않는다. 실제 모바일 INP/LCP/CLS, CPU profile, 운영 pooler·Disk I/O·CPU 시계열은 이번에 확보하지 않았다.

공개 홈페이지 화면은 다른 저장소 소유다. 이 리뷰는 내부 앱과 이 저장소가 제공하는 공개 데이터·미디어 API까지 포함한다. 종료된 독립 전자결재는 개선 대상에서 제외했다.

## 2. 우선순위 요약

P1은 먼저 처리할 운영 지연·불필요한 주요 비용, P2는 다음 단계의 성능 개선이다. P0 장애나 데이터 손상은 이번 검토에서 확정하지 않았다.

| ID | 우선순위 | 발견 사항 | 근거 수준 | 권장 조치 |
| --- | --- | --- | --- | --- |
| R1 | P1 | 등록·대시보드 조회 실패와 시간표 요청 중단; 등록·대시보드는 재진입 후 회복 | 운영 실패 관측, 원인 미확정 | 요청/DB/네트워크 구간 상관측정, 등록 목록·통계 계획 점검 |
| R2 | P1 | 교재 목록과 요약이 전체 파생계산을 각각 수행 | 최종 SQL + 운영 DB 실행시간 | 공통 계산 중복 제거, 페이지 표시용 보강과 집계 분리 |
| R3 | P1 | 학생·수업 페이지 이동마다 통계·필터 선택지를 재조회 | 운영 재현 + 실제 hook probe | 필터 범위별 metadata 재사용·명시 무효화 |
| R4 | P1 | 휴보강 승인 1건에 브라우저·서버 전체 context 조회가 연속 발생 | 실제 호출부·서비스·API 확인 | 단건·날짜·강의실 범위 조회, 공통 deadline |
| R5 | P2 | 업무 현황이 상태 이력을 상관 조회하지만 `task_id` 선두 인덱스가 없음 | 운영 인덱스 + 비실행 EXPLAIN | 필요한 인덱스 검증, 대상 업무부터 좁히기 |
| R6 | P2 | 시간표·달력 범위 전환에서 이전 요청을 취소하지 않음 | 실제 hook/service probe | AbortSignal을 hook→service→transport로 전달 |
| R7 | P2 | 수업계획·일정 생성 검색 중간값마다 요청 시작 | 코드 + curriculum hook probe | 입력/검색 확정값 분리, IME·debounce 처리 |
| R8 | P2 | 홈페이지 관리 미디어 서명 직렬 처리, 공개 미디어의 반복 전체 목록 조회 | 실제 서버 함수 + mock transport | 일괄 서명, 공개 여부 최소 존재 조회 |
| R9 | P2 | 등록·업무가 같은 큰 초기 JS entry를 사용 | 최신 production build | 공통 목록 핵심과 선택 기능의 로딩 경계 분리 |

## 3. 운영에서 측정한 기준선

아래는 Chrome DevTools Protocol의 실제 요청 관측이다. 요청들은 대부분 병렬이므로 시간을 합쳐 화면 로딩 시간으로 계산하면 안 된다.

| 동작 | 관측 요청 | 요청 시간 / 결과 |
| --- | --- | --- |
| 학생 새로고침 | profile → 통계·필터·목록 | profile 574ms, 이후 3개 각각 1,306 / 1,323 / 1,356ms, 모두 200 |
| 학생 다음 페이지 | 같은 통계·필터 + 새 목록 | 1,206 / 1,205 / 963ms, 모두 200. `1–10` → `11–20` 확인 |
| 교재 첫 진입 | 옵션·업무요약·목록·목록요약 | 1,086 / 1,167 / 1,036 / 1,155ms, 모두 200. 362건 중 10행 |
| 등록 첫 진입, 09:39:17 UTC | 목록·통계 | 각각 7,999 / 8,000ms에 `ERR_ABORTED`; 화면에 페이지 로드 실패 |
| 같은 등록 진입 | runtime 2개 / capabilities | 11,993 / 15,001ms에 중단, capabilities는 23,771ms 후 200 |
| 이어 시간표·대시보드 진입 | 시간표 range / workload·daily brief | 요청 중단 관측, 대시보드 로드 실패 표시 |
| 등록 재진입 | runtime 2개 + 통계·목록 | 105 / 153 / 1,139 / 1,164ms, 모두 200으로 회복 |
| 대시보드 재진입 | workload·daily brief | 552 / 501ms, 모두 200으로 회복 |

등록 capabilities의 HTTP/3 timing은 전송 완료 약 1.8ms, 응답 헤더 시작 약 23,769ms였다. 대부분 응답 대기였지만 DB SQL 실행, API/connection 대기, 네트워크 중 어디가 원인인지는 이 자료만으로 구분하지 못한다.

운영 DB의 18:34:46 KST 스냅샷은 client 연결 14, lock wait 0, idle transaction 0이었다. 실패 이후 별도 스냅샷도 lock wait 0이었다. **사후 정상 스냅샷이 실패 당시의 대기 부재를 입증하지는 않는다.**

`pg_stat_statements` reset은 2026-08-13이다. 누적 평균을 현재 속도로 쓰지 않고 다음 짧은 구간 증거를 우선했다.

- 교재 목록: 09:37:29→09:39:25 UTC, 동일 authenticated queryid 호출 **1회 증가**, DB 실행 **907.36ms** 증가.
- 교재 요약: 같은 구간 호출 **1회 증가**, DB 실행 **1,035.37ms** 증가.
- 브라우저의 1,036/1,155ms와 가까워 DB 비용을 우선 개선할 근거가 된다. 요청 ID를 연결한 추적은 아니므로 완전한 단일 요청 상관관계로 표현하지 않는다.
- 업무 목록·통계: 09:37:29→09:40:38 UTC 각각 +10회/+12회, 구간 평균 **2,376.51/2,767.60ms**. 여러 task type·사용자의 요청이 섞일 수 있어 등록 한 화면의 평균이라고 해석하지 않는다.

## 4. 항목별 개선 설계

### R1. 간헐적 timeout을 먼저 분해한다

실패와 회복을 모두 관측했으므로 상시 장애로 단정할 수 없다. timeout을 무작정 늘리면 대기와 중복 작업이 더 길어질 수 있다. 역할·메뉴·필터·요청 ID별 시작, 인증, DB, 첫 응답, 완료/취소를 분리해 기록하는 것이 먼저다. 요청 입력 원문, 학생 이름·연락처, access token은 기록하지 않는다.

등록 쿼리에는 점검할 구체적 구조가 있다. [업무 번호 목록 SQL 227행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/supabase/migrations/20260831031913_ops_task_numbered_pages.sql#L227)과 683행은 전체 eligible 후보를 평가하고, [등록 통계 SQL 22행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/supabase/migrations/20260818083818_optimize_registration_task_stats.sql#L22)은 별도 집계를 계산한다. 최종 summary view에는 상담·시험·청강 보강이 있다. 실행계획이 불필요한 join을 제거할 수 있으므로 코드만 보고 모든 보강이 매번 실행된다고 가정하지 않는다.

개선 후보는 등록 목록에 필요한 key/표시값과 통계 membership을 좁히고 같은 범위의 집계 재요청을 줄이는 것이다. 이미 적용된 `force_custom_plan`, soft archive, 상담 `내 담당`, 빈 과목 문의, RLS와 권한별 결과는 보존한다. 대표 authenticated 실행계획을 격리 환경에서 확보한 뒤 비용이 확인된 부분만 바꾼다.

### R2. 교재 목록·요약의 중복 파생계산을 줄인다

[교재 읽기 SQL 125행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/supabase/migrations/20260831123610_textbook_inventory_numbered_reads.sql#L125)의 helper는 교재 분류, 제목 중복, 재고 이동 집계, 최신 실사 등을 전체 후보에 계산한다. 같은 파일 222행의 목록과 269행의 요약이 각각 이 helper를 부른다. 페이지 제한은 그 뒤에 적용된다. [클라이언트 hook 208행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/src/features/textbooks/use-textbook-numbered-data.ts#L208)도 첫 진입/필터 변경에서 둘을 요청한다. 페이지 이동 때마다 요약을 재조회하는 문제는 이미 해결돼 있다.

먼저 같은 key 집합의 계산을 한 번 수행하는 결합 읽기 또는 공통 projection을 비교한다. 결합 RPC로 목록이 느린 요약까지 기다리는 새 병목이 생기지 않는지도 검증한다. 목록 표시용 위치 정보는 페이지 ID를 확정한 뒤 보강한다. 교재 수정 때만 바뀌는 분류·정규화 값의 사전 계산은 다음 후보다. 재고는 출고·반품·실사 원장과 맞아야 하므로 장기 캐시만으로 우회하지 않는다.

최신 실사용 인덱스도 후보지만 현재 해당 표는 21행으로 작다. 전체 집계보다 먼저 효과를 보장하지 않는다. `EXPLAIN (ANALYZE, BUFFERS)`는 격리 환경의 대표 데이터·권한에서 실행한다.

### R3. 페이지와 metadata의 수명을 분리한다

[use-management-records.ts 841–860행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/src/features/management/use-management-records.ts#L841)은 모든 페이지 요청에서 통계·필터·목록을 시작한다. 동일 필터로 5페이지를 읽는 실제 hook probe는 **목록 5 + 통계 5 + 필터 5 = 15 RPC**였다. 세 요청은 병렬이고 목록을 먼저 표시할 수 있지만, 불필요한 DB 작업이 남는다.

actor·role·로그인 세션 수명·목록 종류·정규화 필터로 metadata key를 만들고 page/pageSize/sort만 바뀌면 재사용한다. 처음에는 hook 수명 안에서 공유하여 변경 범위를 제한한다. metadata가 pending이면 같은 promise를 사용하되 페이지 취소가 공유 metadata를 함께 취소하지 않게 한다.

필터 변경, 명시 새로고침, 관련 저장, 수강/대기/퇴원·수업 관계 변경, 참조 선택지 변경, 로그아웃·권한 변경 시 무효화한다. 짧은 freshness TTL과 재진입 갱신도 둔다. 같은 5페이지에서 **15→7 RPC**가 목표다. 이는 요청 수 **53% 감소 목표**이며 화면 속도가 53% 빨라진다는 뜻은 아니다.

수업계획도 [use-academic-workspace-data.ts 117행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/src/features/academic/use-academic-workspace-data.ts#L117)의 `includeScopeMetadata: true`를 같은 범위에서는 재사용하도록 바꿀 수 있다. 서비스의 metadata=false 계약은 이미 존재한다.

### R4. 휴보강 승인을 대상 한 건의 범위로 좁힌다

[makeup-request-service.ts 630행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/src/features/makeup-requests/makeup-request-service.ts#L630)과 821–856행에서 승인 전 7개 context 테이블, 조건부 전체 이벤트, 단건 detail을 읽는다. 그 후 [승인 API 263행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/src/app/api/makeup-requests/approve/route.ts#L263)은 다시 수업·휴보강·학사일정·강의실 전체를 읽는다. 같은 API 76–89행의 `select('*')` 루프는 1,000행씩 끝까지 순회하며 공통 deadline이 없다. 휴강만 있고 보강이 없는 승인도 충돌 검사 전 이 네 조회를 수행한다.

브라우저는 단건 최신 detail과 필요한 actor 정보만 읽고, 서버는 보강 날짜·강의실·활성 상태에 맞는 충돌 후보만 조회한다. 기존 `get_makeup_collision_context_v1` 계약의 재사용 여부를 최종 함수 기준으로 검토한다. 보강이 없는 경우 충돌 context 조회를 건너뛰고 공유 timeout/취소를 추가한다.

이는 코드로 확인한 누적 데이터 비례 비용이며 실제 승인을 실행해 운영 시간을 재지는 않았다. 변경 검증은 격리 DB에서 수행하고 잠금·동시 승인·멱등성·소스 변경 검증·외부 발송 경계를 보존한다. 전송 중단은 저장 실패의 증거가 아니므로 불확실한 결과를 재시도할 때 기존 request ID로 확인해야 한다.

### R5. 업무 현황의 이벤트 조회에 맞는 인덱스와 범위를 적용한다

[workload SQL 45행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/supabase/migrations/20260922012306_dashboard_workload_reads.sql#L45)은 전반·퇴원 업무마다 상태 이벤트의 최신 시간을 구한다. 운영 `ops_task_events`에는 `task_id` 선두 인덱스가 없었다. 단일 이벤트 조회의 **실행하지 않은 EXPLAIN**은 Seq Scan을 보였다. cost 1767.59는 추정 비용이지 밀리초가 아니다. 휴보강 이벤트에는 관련 인덱스가 이미 있어 같은 지적을 적용하지 않는다.

`(task_id, after_value, created_at DESC) WHERE field_name='status'` 또는 기존 이력 조회도 돕는 더 일반적인 후보를 비교해 최소 인덱스를 고른다. helper에 업무 범위를 전달하고 관련 부모 ID부터 좁힌다. 상태 이력 없음의 fallback, 같은 상태 재진입, 요약과 상세 건수, 역할별 허용 행이 동일해야 한다. 현재 데이터에서 큰 속도 개선을 보장하지 않으며 증가 데이터에서 buffer 접근과 p95를 비교한다.

### R6. 화면을 떠난 범위 요청을 실제로 취소한다

[academic hook 155행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/src/features/academic/use-academic-workspace-data.ts#L155), [operations hook 132행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/src/features/operations/use-operations-workspace-data.ts#L132)은 오래된 응답의 화면 반영만 막는다. range service에는 8초 timeout만 있고 외부 취소가 전달되지 않는다. 시간표·달력 각각 3범위 전환 probe에서 취소는 **0회**, unmount 후에도 0회였다.

hook에 AbortController를 두고 날짜·actor·role·enabled 변경 및 unmount 때 직전 요청을 취소한다. 기존 deadline과 signal을 합치고 revision guard도 유지한다. 3범위 전환 뒤 앞 2개 취소, 마지막만 활성 상태가 목표다. 클라이언트 취소가 DB 실행도 즉시 중단한다고 보장하지는 않는다.

### R7. 검색 입력 중간값의 요청 발행을 줄인다

[수업계획 263행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/src/features/academic/curriculum-workspace.tsx#L263)과 [일정 생성 2298행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/src/features/operations/class-schedule-workspace.tsx#L2298)은 raw search를 서버 요청에 연결한다. curriculum hook에 `''→a→ab→abc→abcd`를 각각 전달하자 **5 RPC**가 출발했다. 앞 4개를 취소해도 발행 자체가 줄지는 않는다.

입력 표시값과 서버 검색값을 분리하고 200–300ms trailing debounce, 한글 조합 완료 후 검색, Enter 즉시 실행, 지우기·선택 필터 즉시 반영을 적용한다. 50ms 간격 4글자 입력은 초기 1+최종 1=**2 RPC 목표**다. 페이지 1 초기화, URL·Back 복원, 이전 수락 행과 포커스 유지, debounce로 추가되는 대기 시간을 함께 검증한다. 다른 메뉴는 타이핑 요청 수를 먼저 측정한 뒤 확대한다.

### R8. 미디어 처리의 직렬 왕복과 반복 전체 조회를 줄인다

[content-routes.ts 213행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/src/features/public-content/server/content-routes.ts#L213)은 선생님마다 사진·영상의 signed URL을 차례로 기다린다. 20명×2파일이면 **최대 40회 직렬 호출**이다. 실제 handler에 호출당 20ms인 mock을 연결한 결과 40회, 최대 동시성 1, 약 850ms였다. 실제 운영 시간이 아니라 구조 재현값이다.

같은 페이지의 고유 storage path를 모아 [`createSignedUrls`](https://supabase.com/docs/reference/javascript/file-buckets-createsignedurls) 한 번으로 서명하고 기존 부분 실패·정적 `/assets/` 처리·권한·TTL을 유지한다. API 제약이 있다면 제한된 동시성으로 대체한다.

또한 [content-store.ts 243–267행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/src/features/public-content/server/content-store.ts#L243)은 공개 업로드 파일 하나의 노출 여부를 확인할 때 공개 선생님 전체를 읽는다. mock에서 파일 5개→전체 목록 조회 5회였다. CDN miss마다 반복되므로 공개 상태·파일 경로의 최소 존재 조회로 좁힌다. cache TTL만 늘려 비공개 전환 반영을 늦추지 않는다.

### R9. 처음 받는 코드와 선택 후 필요한 코드를 나눈다

[등록 페이지](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/src/app/admin/registration/page.tsx#L1)와 업무 페이지가 같은 `OpsTaskWorkspace`를 사용한다. [workspace 182행](https://github.com/tipsedu2019/tips_dashboard/blob/b0f16bf5e5001edcdb25410fd68a8be3297adde3/src/features/tasks/ops-task-workspace.tsx#L182) 이후에는 등록 calendar, 등록 생성 폼, 재시험 dialog 등이 정적 import로 연결된다. 선택 시에만 보이는 일부 기능도 공통 초기 entry에 포함된다. 등록 상세 편집기는 이미 dynamic import이므로 이 항목에서 제외한다.

최신 build의 초기 HTML script를 합산했다. modern browser 기준으로 `noModule` polyfill을 제외했고, gzip은 파일별 압축값 합계다. 공통 framework/auth/shell도 포함되어 **메뉴를 옮길 때마다 이 크기를 새로 전송한다는 뜻은 아니다.**

| 화면 | JS 파일 | 원본 KiB | gzip KiB |
| --- | ---: | ---: | ---: |
| 대시보드 | 20 | 951 | 285 |
| 학생 / 수업 | 각각 33 | 1,362 | 408 |
| 등록 / 업무 | 각각 28 | **1,718** | **490** |
| 교재 | 28 | 1,322 | 388 |
| 휴보강 | 27 | 1,178 | 354 |
| 통계 | 20 | 925 | 278 |
| 홈페이지 관리 | 22 | 961 | 291 |

등록·업무 공통 chunk 하나는 원본 674KiB/gzip 173KiB였다. 이 전체가 제거 가능하다는 뜻은 아니다. route별 목록 핵심을 분리하고 달력·생성 폼 등 실제 선택 기능을 지연 로딩한다. 기존 상세 deep link, dirty state, 최초 dialog 열기, 포커스 복원을 지켜야 한다. [Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading) 방식으로 적용하되 추가 로딩 단계가 첫 조작을 늦추지 않는지 실제 브라우저에서 비교한다.

## 5. 실행 계획과 완료 기준

모든 수치는 **목표 또는 검증 조건**이며 달성 결과가 아니다. 각 단계를 작은 변경으로 분리하고 앞 단계의 성과를 측정한 뒤 다음 단계로 진행한다.

| 단계 | 작업 | 주요 파일·경계 | 검증 입력과 완료 기준 |
| --- | --- | --- | --- |
| 0. 기준선 | 최신 커밋 작업공간 확보, 실패 fixture 복구, 요청·DB 상관측정 | 테스트 fixture, query timing, 브라우저 관측 | 역할/데이터/viewport/cache 조건 고정. 실패를 성공 표본에서 제외하지 않음. 배포 SHA 별도 확인 |
| 1A. 반복 조회 | R3 metadata key·수명·무효화 | management hook, academic hook | 동일 필터 5페이지 15→7 RPC. 저장·필터·권한 변경 시 정확히 갱신. 늦은 응답이 이전 scope를 복원하지 않음 |
| 1B. 요청 제어 | R6 취소, R7 검색 commit | academic/operations hooks·services, 검색 입력 호출부 | 3범위 중 2개 취소; 50ms 간격 4글자 검색 5→2 RPC. IME·Enter·Back·실패 재시도 유지 |
| 2A. DB 비용 | R2 교재 계산 중복 제거 | 교재 read helper·목록/요약 RPC·hook | 0/10/15/20행, 필터·반품·실사·음수 재고 일치. 동일 조건 DB 실행시간을 현재 관측 약 0.9–1.0초 대비 절반 이하로 낮추는 목표. 목록 표시가 요약 대기 때문에 느려지면 재설계 |
| 2B. DB 계획 | R1 등록 계획 분해, R5 이벤트 인덱스·범위 | 최종 ops 함수 체인, workload SQL | 실제 역할별 EXPLAIN, 단계/담당/검색별 결과 동등. 합성 데이터 10배에서 buffer와 p95 비교. 인덱스 쓰기 비용 확인 |
| 2C. 승인 경로 | R4 단건·범위 조회 | makeup service, approve route, collision contract | 휴강만/보강만/둘 다/환불/충돌/동시 승인/재시도. 관련 없는 행 1천→1만 증가에 전체 전송량이 비례하지 않음. 격리 DB·no-send 검증 |
| 3A. 미디어 | R8 batch signing·최소 존재 조회 | content routes/store | 20×2파일에서 서명 API 1회. 중복·누락 파일 처리. 공개→비공개·교체·삭제·익명 접근 계약 유지 |
| 3B. 초기 JS | R9 entry·선택 기능 분리 | route entry, ops workspace/calendar/create | 동일 build에서 초기 raw/gzip 감소, CPU long task·목록 ready 개선. deep link와 첫 dialog 열기 회귀 없음 |
| 4. 배포 검증 | 기능·성능 회귀 확인 후 순차 배포 | CI, pgTAP, migration receipt, browser | 로컬→PR CI→DB 적용→Production Ready→실제 화면/요청 확인을 각각 기록. 이 보고서는 배포를 수행하지 않음 |

단계 1A/1B는 DB 계약 변경이 적고 요청 수 감소를 명확히 검증할 수 있어 먼저 시행할 가치가 크다. 교재 SQL과 휴보강 승인은 정확성·동시성 영향이 있으므로 별도 변경으로 검증한다.

측정 지표는 요청 수, 전송량, 첫 목록 표시, 입력 후 최종 결과 표시, API/DB 실행시간, 취소·timeout·실패율, 초기 JS와 long task다. staging에서는 대표 입력당 충분한 반복 표본을 모아 p50/p95와 최대치를 보고, 운영은 수동 부하를 만들지 말고 정상 사용의 비식별 telemetry로 확인한다. 표본 수와 기간을 항상 함께 적는다.

사용자 체감 목표 초안은 주요 목록 전환 p95 1초 이내, 첫 진입 p95 2초 이내다. 현재 달성값은 아니며 기기·망 조건별 기준선 후 조정한다. Web Vitals는 field p75 기준 LCP 2.5초, INP 200ms, CLS 0.1 이하를 참고한다. 내부 앱의 업무 완료 시간과 함께 평가한다. [Web Vitals 기준](https://web.dev/articles/vitals)

## 6. 선행 정리와 추가 조사

**관측성:** 전체 메뉴의 일관된 RUM, Server-Timing, route/auth/DB/cache 단계 측정, 번들 byte budget은 확인되지 않았다. 일부 ops/registration `performance.mark`와 기능 계약 테스트는 존재한다. 이를 없다고 뭉뚱그리지 않고 필요한 구간에만 보완한다. `useReportWebVitals` 같은 기존 프레임워크 기능부터 검토한다. [Next.js 공식 API](https://nextjs.org/docs/app/api-reference/functions/use-report-web-vitals)

**테스트:** 아래 21개 기존 실패의 주요 원인은 fixture의 `stateLabel: '계획 완료'`가 최신 validator의 `회차 미생성/일정 연장 필요/일정 편성`과 맞지 않는 점이다. 일정 편집 전용 경로에서 이미 비활성화한 일반 목록 요청을 기대하는 테스트도 있다. 최신 계약으로 fixture를 맞춘 뒤 전체 21건이 실제로 해소되는지 재확인해야 한다. 테스트 제외로 통과 처리하지 않는다.

**RLS·인덱스 후속:** 운영 advisor의 auth initplan 38, 중복 permissive 정책 73, 중복 인덱스 1은 공유 DB 전체 숫자다. TIPS 문제 개수로 세지 않는다. `dashboard_notifications`의 row-independent `auth.uid()/current_dashboard_role()` 직접 호출은 좁은 initplan 개선 후보이고, 중복 정책 통합은 역할별 허용 행 동등성부터 확인한다. 현재 작고 체감 근거가 없는 중복 인덱스 정리는 낮은 우선순위다. unused index·unindexed FK 목록을 일괄 삭제·생성 작업으로 사용하지 않는다. [Supabase RLS 지침](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select)

**추가 측정 대상:** 통계 API cache-hit의 인증·권한·claim 단계, 동시 계산 중 503 busy 비율, 공개 class detail의 cache miss, auth→첫 업무조회 지연, 모바일 입력 반응, 대량 시간표 DOM. 이들은 이번에 병목으로 확정하지 않았다.

## 7. 이미 개선된 부분과 유지할 계약

- 관리 목록은 서버 페이지네이션과 10/15/20행 제한을 사용한다. 10행 표에 가상화를 일괄 도입할 근거는 없다.
- 번호 페이지 controller는 이전 요청 취소·늦은 응답 차단·기존 행 유지·실패 재시도를 이미 처리한다. R6은 별도의 날짜 range 경로에 한정한다.
- 교재는 활성 탭과 페이지의 읽기 경계가 있고, 페이지 이동 시 요약을 재사용한다. 과거의 기본 화면 17개 전체 테이블 조회 문제는 현재 문제로 재사용하지 않았다.
- 통계는 actor/role/tab/filter/range별 10분 캐시, in-flight 중복 방지, 취소 경계가 있다.
- 등록 상세 편집기 지연 로딩, 최신 일정 편집 전용 경로의 일반 목록 읽기 억제, 9/5 custom-plan 수정은 이미 적용돼 있다.
- UI 공통 컴포넌트·토큰, 번호 페이지·정렬, 저장된 설정, 권한·RLS, SQLSTATE·잠금·멱등성, 재고 정합성, 공개 API의 개인정보·cache invalidation, no-send 경계를 유지한다.

## 8. 실행 검증과 보존 자료

| 검증 | 결과 | 해석 |
| --- | --- | --- |
| 최신 커밋 production build | 성공. webpack compile 11.1초, TypeScript 및 80개 static page 생성 통과 | 기존 설치 의존성 사용. 깨끗한 dependency install·운영 배포 증거는 아님 |
| 성능·조회 계약 9개 테스트 파일 | **247/247 통과** | query surface, migration scope, management progressive/numbered service, academic/operations scoped reads, task stats·dashboard·statistics cache |
| 화면/페이지·캐시 6개 테스트 파일 | **144개 중 123 통과, 21 실패** | 실패는 `academic-operations-numbered-pagination.test.mjs`에 집중. 최신 fixture 계약 불일치 확인 |
| 서버/API 관련 4개 테스트 파일 | **31/31 통과** | public content, public class detail cache, statistics auth/resource pressure |
| 프런트 probe | 재현 성공 | 실제 hook/service + mock RPC. 요청 수와 취소 상태 증거 |
| 서버 fixture | 재현 성공 | 실제 handler/store + mock transport. 미디어 서명·목록 조회 횟수 증거 |
| 운영 브라우저/DB | 정상·실패·회복 및 교재 실행시간 관측 | 소수 표본. 전체 메뉴 p95·배포 동일성·모바일 성능 인증은 아님 |

테스트 묶음에는 일부 공통 파일이 포함되므로 숫자를 합쳐 고유 테스트 총수로 표시하지 않는다. 앱 수정이 없는 리뷰 작업이며, 실패한 기존 테스트를 이번에 고쳤다고 주장하지 않는다.

보존 자료는 [performance-20260922](performance-20260922/README.md)에 있다. 최신 소스 줄 번호는 위 고정 커밋 링크를 기준으로 한다. 원래 작업트리가 오래된 상태이므로 로컬 파일의 줄 번호가 다를 수 있다.

쿼리 우선순위는 누적 평균만 보지 않고 짧은 구간의 호출 수·실행시간 차이와 현재 정의를 함께 확인했다. [Supabase pg_stat_statements](https://supabase.com/docs/guides/database/extensions/pg_stat_statements)
