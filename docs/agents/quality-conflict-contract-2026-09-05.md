# Q-09 일정 충돌 업무 연결 계약 개선

기준 main: `64a2e7b0`, 작업 브랜치: `codex/conflict-task-contract-20260905`. 기존 checkout과 지난 개선 브랜치는 보존했다. GitHub open Issues는 조회 시 0개였다. 이번 범위는 통계의 충돌 집계→업무 상태 조회→명시적 업무 등록 및 권한별 연결 응답이다.

## 원인과 수정

| 발견 | 실제 근거와 사용자 영향 | 수정과 검증 |
| --- | --- | --- |
| 선생님·강의실 충돌 입력 거부 | 기존 최종 집계 `20260813194812_dashboard_statistics_sources.sql`가 `source.studentIds`에 학생 합집합을 넣었다. 최종 normalizer `20260726035612_dashboard_conflict_task_producer.sql`는 두 유형의 학생 식별 목록이 비어 있어야 한다. 운영의 합성 입력으로 `22023: dashboard_conflict_input_invalid`, normalizer line 71을 확인했다. 한 행의 오류가 전체 연결 조회를 막았다. | 새 forward migration에서 두 source 값만 빈 배열로 바꾼다. `affectedStudentIds`는 보존한다. 클라이언트 projection도 이전 캐시 응답의 표시용 학생 목록을 RPC identity에서 제거한다. 시험·학생 충돌의 학생 ID는 그대로 보존한다. |
| 조회 재시도가 등록 실행 | `ConflictWarning`의 조회 catch가 등록 catch와 같은 `error` 상태를 만들었다. ‘등록 실패 · 다시 시도’ 버튼이 `createDashboardConflictTask`를 호출했다. 조회 실패 복구를 누른 사용자가 의도하지 않은 업무 생성을 시도하게 됐다. | `lookup-error`를 분리하고 ‘상태 확인 다시 시도’는 조회 effect만 재실행한다. 조회 중 등록 버튼은 제공하지 않는다. 열람자도 조회 재시도 가능하고 등록은 기존 역할로 제한된다. 명시적 등록 실패의 재시도는 유지한다. 조회 오류의 원시 DB 문자열은 사용자 안내로 바꾼다. |
| 열람자 응답의 nullable boolean | 기존 최종 `dashboard_conflict_task_visible_v1`의 OR 조건에 nullable `secondary_assignee_id` 비교가 포함됐다. 운영의 합성 레코드에서 `can_open: null`을 확인했다. 실제 업무 ID는 숨겨졌지만 엄격한 클라이언트 boolean 검증을 통과하지 못했다. | 별도 forward migration에서 기존 허용 조건 전체를 `coalesce(..., false)`로 감싼다. 허용 대상을 늘리지 않고 unknown을 거부한다. 실제 생성된 업무를 다른 viewer가 조회하는 pgTAP에서 `linked=true`, `canOpen=false`, 빈 task ID를 검증했다. |

마이그레이션은 CLI 2.115.0의 `migration new`로 생성했다. 기존 migration은 수정하지 않았으며 새 두 파일을 순서·SHA-256과 함께 테스트 manifest에 추가했다. 집계 함수의 새 본문은 이전 본문과 비교 시 `studentIds` 두 줄만 다르고, visibility 함수는 COALESCE 처리만 다르다. 함수 security invoker/definer, search_path, ACL, 역할·RLS 조건과 업무 생성·idempotency·발송 함수는 유지했다.

## 검증 근거

- DB RED: 기존 전체 migration을 적용한 격리 DB에서 새 통계 검사 55개 중 2개 실패. 실제 집계 결과를 `list_dashboard_conflict_task_links_v1`에 전달해 운영과 동일한 `22023`을 재현했다.
- UI RED: 실제 React 컴포넌트 테스트에서 조회 실패의 잘못된 등록 표현과 viewer 재시도 부재를 확인했다. 별도 projection 검사도 기존 코드에서 실패했다.
- DB GREEN: 최종 migration 체인에 대해 통계 55개 + 업무 생성/권한/중복/알림 미생성 34개, 총 89개 통과. `--lint`, `--postdeploy-contract`를 포함한 마지막 격리 실행도 통과했다. 실제 알림 provider에 연결하지 않았다.
- Node: 관련 상호작용·서비스·통계·SQLSTATE·쿼리 예산·무료 요금제 검사 **214개 통과**. 신규 동작 검사는 4개다.
- 워크플로 보호: `supabase-migration-layout.test.mjs` **36개 통과**, migration layout 및 domain SQLSTATE verifier 통과. 워크플로 해시를 무시하지 않고 검토한 새 파일 내용으로 갱신했다.
- 앱: production build, TypeScript, 변경 TS/TSX 및 새 테스트 lint 통과. 이후 변경은 SQL·CI·검토 문서뿐이며 앱 소스는 빌드한 내용과 동일하다.
- 브라우저: 기존 로그인 세션의 `localhost:3025`에서 **운영 DB의 기존 응답을 읽는 새 앱**으로 9건 전체 조회 성공. 기존 연결 1건과 등록 가능 8건을 확인했다. 원시 오류/조회 실패 없음, 확인한 console error/warn 0개. 390px와 1440px에서 가로 넘침 없음, 스크린샷 확인. viewport를 복원했다. 실제 업무 등록·알림 버튼은 누르지 않았다.
- 위 브라우저 결과는 새 클라이언트와 기존 운영 DB의 호환성 증거다. 새 DB 함수와 viewer 계약은 격리 DB에서 검증했으며 운영 적용을 뜻하지 않는다. 강제 네트워크 장애·viewer 로그인 UI는 DOM 테스트로 검증했다.
- 로그: `/tmp/tips-conflict-{ui-red,projection-red,sql-red,sql-verified,sql-final,final-unit,build,types,lint}.log`. 배포/운영 적용 상태는 아래와 별도로 구분한다.

## 검증 방법에서 배운 점

기존 통계 overlap fixture에는 학생이 없어 생산자→소비자 간 계약 오류가 드러나지 않았다. 학생이 있는 수업으로 생성한 실제 JSON을 소비 RPC에 넣는 검사로 바꾸어 오류를 검출했다. 또한 이전 업무 생성 테스트가 현재 스키마에서 실행되도록 pgTAP `has_table`의 schema-aware overload, 학교 `high` 코드, 자동 생성 교사 catalog와의 fixture 충돌을 수정했다. 검증 기준을 약화하지 않고 기존 테스트를 끝까지 실행한 결과 viewer의 NULL 응답까지 드러났다.

반복 비용을 줄이기 위해 UI 검사 4개를 기존 free-tier CI에, 두 SQL 파일을 기존 격리 schema-contract CI에 연결했다. 새로운 MCP/패키지/전역 스킬은 설치하지 않았다. 검토한 테스트 추가만 반영한 워크플로 해시를 갱신하고 기존 비밀값·운영 적용 통제를 유지했다. 서버 응답시간이나 작업시간 감소는 측정하지 않았으므로 성능 향상으로 주장하지 않는다.

## 공식 자료와 적용 조건

확인일: 2026-09-05, Supabase JS 설치본 2.108.2, CLI 2.115.0, PostgreSQL 검사 major 17, Next 16.1.1 / React 19.2.3.

- [Supabase RPC 공식 문서](https://supabase.com/docs/reference/javascript/rpc): 함수 이름과 인자 객체 경계 확인. 인자는 클라이언트 projection과 최종 서버 계약을 함께 검증한다. [공식 changelog](https://supabase.com/changelog.md)도 확인했으며 이번 문제를 설명하는 관련 API 변경은 발견하지 못했다.
- [PostgreSQL 17 논리 연산자](https://www.postgresql.org/docs/17/functions-logical.html): FALSE OR NULL이 NULL이라는 공식 동작을 합성 레코드와 실제 viewer 계약 검사에 연결했다.
- 설치된 `supabase` 0.1.2와 `superpowers` 6.3.0의 원인 추적·실패 테스트 우선 방식을 적용했다. 외부 코드/MD를 복제하지 않았고 기존 출처·라이선스 대장을 유지했다. 재사용 지침은 공급자와 소비자 경계 검증 한 줄만 프로젝트 스킬에 추가했다.

## 상태와 다음 우선순위

이 회차는 로컬 구현·검증·커밋 범위다. main/운영 배포/운영 DB migration 적용은 아직 하지 않았다. 운영 반영 시 두 forward migration을 순서대로 적용하고 기존 캐시 응답, 관리자와 viewer의 연결 상태를 각각 확인한다.

후속 Q-10: 기존 `create_dashboard_conflict_task_v1_impl`가 업무 상태 불일치 `dashboard_conflict_stale`에 `40001`을 사용하는 구간 15곳을 운영 최종 정의에서 확인했다. 이번 변경은 이 함수에 손대지 않았고 기존 pgTAP의 현재 동작 증거를 유지한다. 이를 정상 정책으로 채택하지 않는다. 다음 묶음에서 정확한 SQLSTATE 재현→비재시도 업무 충돌 코드→pgTAP/클라이언트 처리 검증 순서로 고친다. 동시성·발송을 포함한 전체 앱 검토는 여전히 별도 범위다.
