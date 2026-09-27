# 독립 최종 리뷰와 수정

검토 대상: `062c8601..06443e11`. 독립 reviewer 1회, 읽기 전용. 수정 후 재리뷰를 요청하지 않았다.

## 확인된 P2와 조치

새 생성 열 wrapper는 `service_role` 실행을 허용했지만 기존 분류 helper chain은 해당 역할에 실행 권한이 없어 서버 교재 INSERT/UPDATE가 실패할 수 있었다. 직접 wrapper 호출과 INSERT 회귀에서 **SQLSTATE 42501, permission denied for function textbook_taxonomy_v1**을 재현했다.

한 번의 수정 패스로 canonical taxonomy와 하위 순수 함수 5개에 `service_role` EXECUTE만 부여했다. 모두 immutable/security invoker/빈 search_path를 유지하고, 데이터 조회 함수·테이블 권한·PUBLIC/anon 권한은 넓히지 않았다. 최종 pgTAP는 authenticated UPDATE, service_role INSERT/UPDATE 및 생성 값 동등성, anon 거부, 함수 속성, no-send를 검사한다. 12/12 통과; 관련 SQL 전체 384/384 통과. 처음 role fixture의 필수 세부과목/과학 과목 제약도 실제 DB 계약에 맞춘 뒤 검증했다.

## 리뷰에서 보류한 항목에 대한 결정

- 운영 지연 원인·p95·체감 속도: 코드/합성 측정으로 운영 결과를 단정하지 않는다. 기존 보고서의 운영 상관측정 단계로 유지한다.
- migration 잠금 시간·배포 성공: 현재 운영 미적용이다. 5초 잠금/120초 문장 제한과 DB→앱 적용 순서를 유지하며 운영 성공 주장을 하지 않는다.
- 등록 달력 실제 예약 조회: fixture에 예약 RPC가 없어서 module 렌더/오류 표시까지만 확인했다. 기존 달력 데이터 경로는 이번에 바꾸지 않았고 운영 smoke gate에 남긴다.
- OS 한글 IME: 실제 입력기 대신 React composition 행동을 검증했다. 운영 브라우저 smoke에 한글 조합 입력을 포함한다.
- 외부 알림 전달: 실제 승인/발송하지 않았다. 기존 전송 경로를 유지하고 no-send 테스트를 통과했다.
- 새 등록 폼 최초 chunk 로딩 중 Save에 초점이 가는 UX 차이: 독립 리뷰에서 키보드 접근 차단/초점 유실을 확인하지 못했다. 자동 제출 동작은 추가되지 않았고 Escape·기존 폼 검증은 유지한다. 초기 초점 향상은 별도 UI 개선으로 남긴다.

리뷰어는 권한 회귀 수정 전 HEAD를 “수정 필요”로 판정했고, 그 외 병합 차단 문제를 찾지 못했다. 최종 권한 수정은 작성자가 역할별 로컬 DB 회귀 및 새 migration 재생으로 검증했다. 운영 승인/적용과 구분한다.
