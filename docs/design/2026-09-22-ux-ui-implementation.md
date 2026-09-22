# UX/UI 개선 구현·검증 기록

2026-09-22 · `codex/ux-ui-refinement-20260922` · 기준 `bc64ea648afeb38cce706795f0eda25a5d8696ff`

[원본 리뷰](2026-09-22-full-ux-ui-review.md) · [승인된 실행 계획](2026-09-22-full-ux-ui-improvement-plan.md)

## 반영 범위

| 계획 | 반영한 동작 | 주요 파일 |
|---|---|---|
| T9 / T1 / F14 | 캘린더 중립 일정 면·종류 표식·제목 줄바꿈, 날짜/검색/보기/생성 위치, 최초 조회 상태 구분, 한 주 복구에서 같은 상세·권한 사용 | `calendar-main.tsx`, `calendar.tsx`, `academic-calendar-workspace.tsx` |
| T1 / T4 | 전반·퇴원 검색 기본 노출, 검색 범위와 정렬 분리, 학생/수업/현재 행동 중심 기본 열, 기존 열 폭 보존, 조회 실패와 정상 0건 분리 | `ops-task-workspace.tsx` |
| T1 / T2 / T4 | 휴보강 상태별 추천 열, 공용 필터, 모바일 중첩 카드 제거, 제출 오류를 처리 창 안에 표시하고 메모 보존 | `makeup-request-workspace.tsx` |
| T4 / F08 | 재시험 표 관계, 학생/점수/결과/다음 행동 중심, 부가 정보 열 설정, 키보드 너비 조절, 계보/계정 연결 경고 보존 | `ops-task-workspace.tsx` |
| T8 | 알림 채널의 장애 격리·채널 재시도, 탭/저장바 정리, 홈페이지 수동 탭과 연결 패널·공용 목록 면, 채용 중복 제목 제거·삭제 후 초점 복귀, 교재 ‘정리’ 명칭 통일 | notifications / public-content / recruiting / textbooks |
| T2 / T3 | 프로필 고정 header/footer·스크롤 body·필드 검증, 모바일 실제 경로 이동 시 닫기·현재 메뉴 재선택, 가장 구체적인 경로만 활성화 | `nav-user.tsx`, `nav-main.tsx`, `app-sidebar.tsx`, `sidebar.tsx` |
| T5 | 수업 상세 총원을 30개 관계 페이지와 분리해 반환·표시 | `use-management-records.ts`, `management-page.tsx`, 새 migration |
| T6 | 정규화 일정 preview의 날짜별 신규/기존 표시, 전부 기존일 때 확정 비활성, 미리보기는 초안을 변경하거나 저장하지 않음 | `class-schedule-workspace.tsx` |
| T7 | 학교 표시 정렬과 저장 순서 분리, 필터 뒤의 오류 행으로 복귀, 학교/선생님/강의실 반복 제어 이름 | master workspaces |

공용 `useDataTableColumns`에 `defaultVisible`을 추가했다. 저장된 boolean을 우선하고 기존 소비자는 모두 표시 기본값을 유지한다. 공통 토큰을 덮어쓰지 않았으며 메뉴별 표현을 `DESIGN.md`에 기록했다. 전자결재와 수업그룹 기능은 재도입하지 않았다.

## 검증 환경과 증거

원본 checkout의 기존 수정은 보존했다. 합성 데이터만 사용하는 `scripts/qa/ux-refinement-fixture-server.mjs`를 통해 실제 Next 화면을 확인했다. 브라우저 `127.0.0.1:3270` → Next `3271`, 합성 backend `3272` 구성이다. 미등록 데이터 경로는 501, Next에 대한 쓰기 요청은 405로 차단하며 운영 환경변수·세션·개인정보를 사용하지 않는다.

재현:

```sh
node scripts/qa/ux-refinement-fixture-server.mjs
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3272 NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-only NEXT_PUBLIC_FALLBACK_ADMIN_EMAILS=fixture@example.invalid node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3271
```

`http://127.0.0.1:3270/__fixture`에서 시작한다. `POST http://127.0.0.1:3272/__control`의 `mode`로 normal/empty/error/loading/dense를 전환한다. `/__evidence`는 합성 요청 기록만 반환한다.

화면 증거는 로컬 `output/ux-refinement/`에 있다. 캘린더만 동일 데이터·1440×900/390×844의 전후 캡처를 확보했다. 다른 메뉴는 개선 후 캡처와 기존 코드/공용 계약을 대조했으며 동일 조건의 전후 픽셀 비교로 주장하지 않는다.

- 캘린더: 첫 조회 503 → 실패 표시 → 같은 범위 수동 재시도 → 45개 합성 일정 복구. 원래 운영의 일시 실패 원인은 이 재현만으로 확정할 수 없다.
- 전반: 긴 수업명·3행, 기본 검색/열/현재 행동을 1440px에서 확인. 모바일 페이지 가로 넘침 없음.
- 휴보강: 긴 수업명·3행, 6개 기본 열과 모바일의 사유/일정/장소 확인.
- 재시험: 점수 입력과 현재 행동을 같은 행에서 확인. 선택 전후 검색 top=148px, 첫 표 행 top=291px로 유지.

자동 검증과 최종 리뷰 결과는 아래에 실행 완료 후 기록한다.

## DB와 배포 순서

`20260922140000_class_detail_roster_counts.sql`은 ordered migration의 최종 `get_management_detail_v1(text,uuid)` 정의에 등록/대기 총원만 추가한다. 기존 관계 조회와 같은 RLS-visible 학생 및 `student_ids`/`waitlist_ids` 기준을 사용하고 owner/ACL/security invoker를 보존한다. 업무 충돌 SQLSTATE를 추가하지 않았다.

격리된 Supabase에서 `class_detail_roster_counts_test.sql`과 `management_page_reads_test.sql`을 최종 migration chain에 실행해 통과했다. 등록 0/30/31/65, 대기 31, 첫 페이지 30, ACL/invoker와 기존 SQLSTATE를 검증했다. 임시 DB/container는 정리했다.

운영 적용 시 **migration → 클라이언트 배포 → 목록/상세 인원 읽기 비교** 순서가 필요하다. 이전 DB 응답에는 총원이 없어 UI가 ‘인원 확인 중’으로 표시된다. 운영 migration/배포/실제 저장/발송은 이번 로컬 검증과 별개이며 실행하지 않았다.

## 알려진 검증 한계

- `lesson-design-page.test.mjs`의 옛 편집 UI 구조를 기대하는 12건은 시작 커밋의 소스로도 동일하게 실패한다. 이 변경의 회귀와 구분했다. 새 preview 동작은 실제 컴포넌트의 미리보기/생성/초안 보존 테스트로 검증한다.
- 실기기 터치, VoiceOver 전체 읽기 순서, 운영의 실제 쓰기/발송과 첫 조회 간헐 오류 원인은 검증 범위 밖이다.
- 운영 배포가 되기 전에는 사용 중인 화면에 이 변경이 적용됐다고 볼 수 없다.
