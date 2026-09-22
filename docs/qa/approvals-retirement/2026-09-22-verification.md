# 전자결재 폐기 검증 — 2026-09-22

## 범위

독립 전자결재 메뉴, `/admin/approvals`, 작성·목록·상세 서비스, 전용 알림 adapter/presentation 및 과목별 월간보고서 capability를 제거했다. 휴보강 결재는 독립 업무로 유지한다. 현재 개선 로드맵에서 제외하고, 과거 계획의 관련 항목은 취소로 표시했다. 열린 GitHub 이슈에서 전자결재 개선 작업은 발견되지 않았다.

기존 migration 이력과 문서·댓글·이벤트·서식은 보존한다. 새 migration은 네 테이블의 모든 앱 역할 권한과 RLS 정책을 제거하고 전용 RPC·구현 함수·trigger를 삭제한다. 과거 알림 기록을 해석하는 workflow/event/template 식별자만 공용 감사 계약에 남는다. 알림 규칙·dispatch flag 재활성화는 DB CHECK로 막고, 대기 전달은 취소한다. 발송 중·완료·결과 불명 영수증은 유지한다. 새 worker와 provider도 전자결재를 발송 전에 차단한다.

## 로컬 검증

- 관련 Node 테스트 573건 통과: 알림 설정·worker·provider·shadow 검증, 독립 기능 폐기, 기존 운영 업무 및 shell.
- 쿼리 예산·공용 UI 계약 164건 통과. 유지된 secondary query probe 테스트 8건 통과.
- 최종 migration 순서로 격리 DB pgTAP 167건 통과: 폐기 계약 35건, 휴보강 목록·상세·권한·페이지 정합성 132건.
- DB lint, TypeScript, Next production build 통과. ESLint 오류 0; 기존 경고 5개.
- migration layout과 알림 진입점 검증 통과. 외부 알림 요청 0.

격리 DB 요청 ID: `retire-approvals-20260922-final`. baseline `ec11107ba2c0eab4`, 두 retirement migration을 `final`로 검증했다. `42501`로 구형 클라이언트 테이블 접근 차단, `42883`로 제거된 RPC 호출 차단, `23514`로 알림 재활성화 차단을 확인했다.

## 브라우저

실제 Next production build에 합성 관리자·빈 일정 API를 연결한 loopback 환경에서 확인했다. production 인증·데이터를 사용하지 않았다. 기존 `AppSidebar`, `NavMain`, 공용 command dialog 및 404 화면을 그대로 사용하며 스타일 변경은 없다. 사용자 제공 기존 운영 메뉴를 기준으로 전자결재 앞뒤의 휴보강 → 학사일정 순서를 비교했다.

| 화면/상태 | 확인 결과 |
| --- | --- |
| 1424×964, light, 관리자 대시보드 | 운영 메뉴에서 전자결재 없음. 휴보강·학사일정·시간표 및 관리 메뉴 유지 |
| 빠른 이동 검색 `전자결재` | `일치하는 메뉴가 없습니다.` 표시. 닫은 뒤 검색 버튼으로 포커스 복귀 |
| 390×844 모바일 drawer | 전자결재 없음. 휴보강과 학사일정 정상 표시, 메뉴 가로 넘침 없음 |
| 기존 `/admin/approvals?view=mine&page=1` | HTTP 404 및 공용 `없는 화면입니다` 표시, 대시보드 복귀 링크 제공 |

스크린샷과 접근성 트리는 작업 대화의 브라우저 검증 결과에 남겼다. 검증 후 임시 viewport를 초기화했다.

## 릴리스 경계

운영 DB는 읽기 전용으로 문서 2건·서식 2건과 함수/trigger 목록만 조사했다. 운영 데이터 변경, migration 적용, main 병합 및 production 배포는 이 검증에 포함되지 않는다. 앱과 두 retirement migration을 함께 릴리스해야 완전히 닫힌다. 오래된 브라우저는 재조회 시 제거된 RPC/권한 오류를 받을 수 있으며 새로고침 후 해당 메뉴가 사라진다.
