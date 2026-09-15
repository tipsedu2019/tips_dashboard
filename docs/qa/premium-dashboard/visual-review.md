# 시각 검수 기록

## 1차 — 대시보드 / 공통 셸

2026-09-15. 실제 Next 개발 서버 `http://127.0.0.1:3216`, 합성 auth/API,1440×900·390×844. Browser plugin not available; bundled Playwright 사용. source `c41e5468` 및 작업 중 폰트 변경 포함이므로 최종 소스 검증은 아니다.

- 이전: `/tmp/tips-premium-dashboard-20260915/before/complete/A-dashboard-1440.png`, `A-students-1440.png`, `A-textbooks-390.png` 직접 시각 확인. 교재 첫 항목이 약527px부터 시작하고 모바일 header가2줄을 차지한다.
- 현재: `/tmp/tips-premium-dashboard-20260915/iteration1/A-dashboard-1440.png`, `A-dashboard-390.png` 직접 시각 확인. 날짜·조회시각·단위·시간순 목록이 분명하고 모바일 header1줄, 일정3개 첫 화면 내 노출. 현재 fixture는3개 일정이며5개/오류 상태 검수는 별도.
- 해당4개(대시보드·학생 desktop/mobile) 진입에서 알 수 없는 API 호출, runtime error, console error, body overflow 없음.

| 관찰 | 상태/처리 |
|---|---|
| 대시보드 모바일 gutter12px | T20 페이지 wrapper에서16px로 통일 예정 |
| 본문 폭1120px 이내, 시간과 이름 정렬 |1차 양호; 최종 font/build 재확인 |
| 반복 카드형 바로가기 | 텍스트 링크로 위계 낮춤 확인 |
| PC·모바일 header/로고 |1차 양호; 메뉴 설정·dark·focus 추가 검수 필요 |

이 기록은 렌더 관찰이며 운영 성능, 실사용5명 평가, 저장/발송, 배포 증거가 아니다.
