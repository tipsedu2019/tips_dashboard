# 시간표 셀 세부 디자인 보완

기준: `714ef52aba668d98171a6cd60fbddade4bc47620`. 기존 대시보드의 surface 반경, 글꼴, muted foreground, 모션 토큰과 기존 수업별 팔레트를 유지한다.

- 굵은 바깥 색 띠를 2px의 안쪽 표식으로 바꾸고 일정 면에 공용 12px 반경과 옅은 테두리를 적용했다.
- 수업명은 구분색과 foreground를 섞은 진한 색으로 표시한다. 과목·선생님/강의실은 제목 바로 아래에서 폭에 따라 묶인다.
- 시간축, 수업 높이, 조회·필터·드래그·상세 접근·저장 계약은 변경하지 않았다.

## 화면 확인

동일한 합성 데이터, 선생님 주간, 2단, 라이트 모드, CSS viewport 1440×960 비교:

| 이전 | 이후 |
| --- | --- |
| [기준 화면](before-desktop.png) | [개선 화면](after-desktop.png) |

- 390×844: [라이트](after-mobile.png), [다크](after-mobile-dark.png). 실제 innerWidth 390, document scrollWidth 375로 페이지 가로 넘침 없음(브라우저 스크롤바 제외).
- [일별 선생님](daily-teacher.png)과 강의실 주간에서도 수업명과 해당 위치 정보 표시 확인.
- [긴 수업명 상세](detail.png): Enter로 전체 수업명/요일·시간/선생님/강의실을 확인하고 Escape로 닫힘.
- 출력: 실제 이미지 저장 코드가 생성한 PNG 1698×1737을 [미리보기](export-preview.png)로 검사. 브라우저 자동화의 다운로드 이벤트는 반환되지 않아, 로컬 합성 환경에서 생성 Blob을 일시적으로 표시해 확인했다. 이 검증용 코드는 제거했으며 내보내기 구현 변경은 없다. 운영 다운로드 완료를 주장하는 증거는 아니다.
- 최종 합성 화면의 콘솔 오류 0건.

## 자동 검증

- timetable layout/image-export + admin shell/common controls/semantic contrast: 52 passed.
- TypeScript, 변경 React 파일 ESLint, git diff whitespace 검사: 통과.
- 기존 `scripts/qa/timetable-annual-design-fixture-server.mjs`로 재현. 모든 데이터는 합성이고 운영 데이터 쓰기는 수행하지 않았다.
