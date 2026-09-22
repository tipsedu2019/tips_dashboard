# 시간표 셀 · 학교 연간 일정표 디자인 검증

기준: `c2a51ec512570b5e7926eb0ab5063952663796e1` (2026-09-22 main).
새 대시보드·수업계획의 semantic token과 공용 Button, Select, Popover, DataTableToolbar를 기준으로 개선했다. DB/API, 권한, 일정 저장 계약 변경은 없다.

## 동일 조건 비교

합성 수업·학교·일정으로 동일한 상태와 viewport를 비교했다. 실사용자 데이터나 운영 인증 정보는 포함하지 않는다.

| 화면 | 이전 | 이후 |
| --- | --- | --- |
| 시간표 1440×960, light | [이전](timetable-before-desktop.png) | [이후](timetable-after-desktop.png) |
| 시간표 390×844, light | [이전](timetable-before-mobile.png) | [이후](timetable-after-mobile.png) |
| 연간 일정표 1440×960, light | [이전](annual-before-desktop.png) | [이후](annual-after-desktop.png) |
| 연간 일정표 390×844, light | [이전](annual-before-mobile.png) | [이후](annual-after-mobile.png) |

시간표는 수업명 우선·과목·강의실 순서로 표시하며 작은 배지를 제거했다. 기존 색상과 시간축은 유지한다. 연간 일정표는 전체 학교명·학기명, 중립적인 미입력 칸, 모바일 과목 라벨을 적용했다. 데스크톱 표는 내부에서 가로 스크롤하며 페이지 폭은 유지한다.

## 브라우저 확인

- 390px에서 두 화면 모두 document width = viewport width = 390px. 라이트·다크에서 읽기 가능: [시간표 dark](timetable-after-mobile-dark.png), [연간 일정표 dark](annual-after-mobile-dark.png).
- 시간표 긴 수업명 상세가 클릭/Enter로 열리고 Escape로 닫힘: [상세](timetable-detail.png).
- 연간 일정표 셀 클릭/Enter로 시험범위 상세가 열리고 Escape로 원래 셀에 복귀: [상세](annual-detail-desktop.png).
- 상세 → 기존 일정 편집창 → 취소/Escape 후 원래 셀로 포커스 복귀 확인. 합성 편집창은 저장하지 않음.
- 편집창을 연 상태에서 데스크톱 → 390px로 변경한 뒤 닫으면 숨겨진 셀 대신 연도 필터로 복귀: [포커스](annual-resize-focus-mobile.png). 최종 재검증 탭의 콘솔 오류 0건.
- 학교 분류(고등/중등), 학교, 학기 필터 적용과 초기화 확인. 2학기는 해당 두 시험 시기만 표시.
- [로딩](annual-loading-mobile.png), [빈 일정](annual-empty-mobile.png), [조회 오류](annual-error-mobile.png) 확인. 오류에서는 추가/내보내기 비활성, 다시 시도로 정상 복구. 빈 일정에서도 선택 연도 유지.
- 실제 이미지 저장 버튼으로 다운로드한 [PNG](annual-export.png): 3684×2295, 전체 학교와 3개 학년·모든 과목 포함. 저장 후 버튼과 화면 복구.

## 자동 검증

- 시간표 layout/image-export, annual-board, academic-calendar UI 및 shared dashboard design contract 13개 파일: **112 passed**.
- 마지막 빈 일정 연도 표시 보완 후 annual-board/image-export: **26 passed**.
- 화면 폭 변경 시 포커스 보완 후 annual-board/dialog-opener-focus: **31 passed**, TypeScript·변경 파일 ESLint 재통과.
- `pnpm exec tsc --noEmit`, 변경 React 파일 ESLint, `git diff --check`: 통과.
- `pnpm build` (합성 로컬 Supabase 환경): 통과. 최종 배포 빌드/운영 확인은 PR CI와 배포 기록에서 별도로 확인.

## 재현

```sh
node scripts/qa/timetable-annual-design-fixture-server.mjs
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3262 NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-only pnpm dev --webpack --hostname 127.0.0.1 --port 3261
```

- 시간표: `http://127.0.0.1:3260/__fixture`
- 연간 일정표: `http://127.0.0.1:3260/__fixture?view=annual`
- 다크: 위 URL에 `theme=dark` 추가.
- 상태: `curl 'http://127.0.0.1:3260/__control?mode=error'` 후 새로고침 (`normal`, `empty`, `loading` 지원).
- transport는 로컬 합성 데이터만 응답하고 외부 데이터 호출을 전달하지 않는다. 미구현 API/쓰기 요청은 실패한다.
