# 과학 과목 기반 확장 로컬 검증 보고서

- 검증일: 2026-07-22 (Asia/Seoul)
- 작업공간: `/Users/hyunjun/Documents/Codex/tips_dashboard`
- 기준: `main` / `01fbcfcd32ec` (`origin/main`보다 1 commit 앞섬)
- 결론: 로컬 구현·정적 SQL 검증·자동 회귀·빌드는 통과했다. 원격 DB 적용, 실제 알림, commit·push·배포는 실행하지 않았다.

## 1. 구현 범위

- 고정 과목 registry를 영어·수학·과학으로 확장하고 unknown은 fail-closed 처리했다.
- 과학팀과 과학 원장을 영어·수학과 분리했다. 과학 등록은 고1~고3만 허용하며 레벨테스트 실시·생략 경로를 모두 지원한다.
- 과학 세부과목 stable key 5개(통합과학, 물리학, 화학, 생명과학, 지구과학)를 수업·교재·학사일정에 연결했다. 표시명·정렬·활성 상태 변경은 stable key를 유지한 채 현재 설정을 따른다.
- 기존 `별관 4강` 행의 과목 배열에 과학을 추가하는 update-only migration을 작성했다. 같은 이름의 강의실을 새로 만들지 않는다.
- 학사일정과 학교 연간보드에 과학 시험일·시험범위·세부과목을 추가하고 4열 보드, 고등부 생성 제한, legacy 읽기를 유지했다.
- 과학 Google Chat 연결은 별도 슬롯으로 추가했지만 `disconnected`, 무비밀, 미검증 상태로만 seed한다. 발송 플래그·규칙·cron은 켜지 않는다.
- 영어 단어 재시험은 영어 전용으로 유지하고, 과학 전용 월간보고·결재 템플릿은 추가하지 않았다.
- 공개 홈페이지는 별도 저장소 범위이므로 `public/` 파일을 수정하지 않았고 기존 `[팁스영어수학학원]` 브랜드도 바꾸지 않았다.

## 2. 자동 검증

| 항목 | 최종 결과 | 시간/비고 |
|---|---:|---|
| 전체 Node 테스트 | 1790/1790 통과 | real 8.35초, 실패·skip 0 |
| TypeScript | 통과 | real 1.11초 |
| 전체 ESLint | 오류 0 | real 11.19초 |
| 프로덕션 빌드 | 79/79 페이지 | `next build --webpack`, real 15.24초, compile 3.9초 |
| 등록 집중 회귀 | 664/664 통과 | 과학 1~3트랙, 선택 레벨테스트, 예약·알림·영수증 포함 |
| 과학 반·교재 집중 회귀 | 143/143 통과 | 전체 textbook 150/150 별도 통과 |
| 과학 학사일정 집중 회귀 | 48/48 통과 | drag·4열·동적 표시명·legacy 포함 |
| 알림 회귀 | 421/421 통과 | worker·연결·adapter 포함 |
| provider-zero | 3/3 통과 | provider 0회, `fetch` 0회 |
| 변경 공백 검사 | 통과 | `git diff --check` exit 0 |

ESLint는 오류 없이 통과했지만 500KB를 넘는 `ops-task-workspace.tsx`와 `textbook-operations-workspace.tsx`에 Babel deopt 안내가 있었다. 이는 이번 기능의 실패가 아니라 향후 측정 기반 분리 후보로 기록한다.

## 3. SQL 검증 경계

- 신규 순방향 migration 5개와 pgTAP source를 작성했다.
- PostgreSQL 17 parser와 PL/pgSQL AST로 migration/함수 구문을 검증했다.
- 등록 migration은 SQL 113 statements·PL/pgSQL 17 functions, 등록 pgTAP은 SQL 103 statements·PL/pgSQL 2 functions를 파싱했다.
- 과학 반·교재 migration은 SQL 21 statements·PL/pgSQL 2 functions, 과학 알림 migration은 SQL 33 statements·PL/pgSQL 11 functions를 파싱했다.
- 로컬에 `psql`, Supabase CLI, Docker 실행 파일이 없으므로 실제 PostgreSQL 적용과 pgTAP runtime은 실행하지 않았다. 따라서 DB runtime 통과나 운영 적용을 주장하지 않는다.

## 4. 로컬 경로 확인

최초 webpack dev watcher는 파일 핸들 한도 때문에 `EMFILE`과 잘못된 404를 냈다. 서버를 polling watcher로 재시작한 뒤 아래 12개 경로가 모두 HTTP 200으로 컴파일되고, 인증이 없는 브라우저에서는 정확한 `next` 파라미터를 가진 로그인 화면으로 이동함을 확인했다.

- `/admin/registration?fixture=registration-subject-tracks&fixtureRole=english_admin`
- `/admin/registration?fixture=registration-subject-tracks&fixtureRole=science_teacher`
- `/admin/settings/subjects`
- `/admin/settings/teachers`
- `/admin/settings/classrooms`
- `/admin/classes`
- `/admin/timetable`
- `/admin/textbooks`
- `/admin/academic-calendar/annual-board`
- `/admin/settings/notifications`
- `/admin/word-retests`
- `/admin/approvals`

브라우저 데이터 상태는 `인증 전 / unavailable`이다. 격리 브라우저에는 로그인 세션이 없었고 Chrome 연결도 이 환경에서 제공되지 않았다. 따라서 fixture 내부 화면과 로컬 Supabase 데이터의 실제 렌더링은 관찰하지 못했다. 로그인 입력, 저장, 알림 연결 검증, provider 호출은 시도하지 않았다. 자동 UI·서비스 계약은 전체 Node 테스트에 포함되어 통과했다.

## 5. 회귀·안전 감사

- `public/` 경로 diff: 0개.
- 기존 단어 재시험 dirty 파일 4개의 SHA-256과 numstat은 작업 전 기준과 동일하다.
  - `ops-task-model.js`: `5a8b2bab...99c98b`, 52/0
  - `ops-task-service.ts`: `c3444bcc...46b7`, 26/3
  - `notification-ops-task-producers.test.mjs`: `cefc8fc8...a2e48`, 21/1
  - `ops-task-model.test.mjs`: `a5a3b55d...9597`, 55/0
- tracked diff는 83개 파일, +4,115/-440이다. 신규 untracked migration·테스트·문서는 이 수치에 포함되지 않는다.
- `.pnpm-store`는 약 547MiB이며 삭제하지 않았다. `.gitignore`에 정확히 `/.pnpm-store/`만 추가해 수백만 줄 변경처럼 보이던 캐시 노이즈를 제거했다.
- 현재 `src`는 334개 파일, 133,456줄이다. 앱 자체가 450만 줄인 것은 아니었다.
- 과학 교재 저장은 화면에서 한 번 읽은 active-area map을 단건·일괄·상태 변경에 재사용해 저장 중 area RPC를 0회로 고정했다. 과목 capability와 세부과목 규칙도 중앙 helper를 사용한다.

## 6. Git·배포 상태

- `.git` 메타데이터가 read-only라 별도 `codex/` 브랜치·worktree·commit을 만들 수 없었다.
- 현재 과학 변경은 working tree에 있으며 stage·commit·push하지 않았다.
- Supabase migration 적용, Vercel 배포, Google Chat/Web Push/SOLAPI 실제 발송은 모두 미실행이다.

## 7. 다음 운영 게이트

1. PostgreSQL 실행 환경에서 `0900 → 0930 → 1000 → 1100 → 1200` 순서로 migration과 pgTAP을 staging에 적용한다.
2. 인증된 admin·science teacher 세션으로 위 12개 경로를 다시 열어 fixture와 실제 데이터 화면을 읽기 전용 확인한다.
3. 과학 원장·과학팀·별관 4강·5개 세부과목 운영 데이터를 지정한 뒤에만 과학 신규 등록을 연다.
4. 과학 Chat 연결은 별도 검증 절차를 거치되 runtime flag는 계속 끈 상태로 유지한다.
5. 그 후 별도 승인 범위에서 commit·push·배포한다.

광범위한 workspace 분해나 전역 성능 리팩터링은 이번 기능과 섞지 않았다. 현재 수치와 Babel deopt 안내를 기준선으로 삼고, 실제 프로파일링 결과가 생긴 뒤 별도 작업으로 진행하는 편이 유지보수성과 회귀 안전성이 더 좋다.
