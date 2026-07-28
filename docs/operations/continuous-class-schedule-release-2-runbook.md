# 연속 수업 일정 Release 2 운영 가이드

## 현재 단계

이 문서는 Release 2 구현과 비활성 배포를 위한 운영 경계를 기록한다. 현재
단계에서는 runtime `0`과 `legacy` authority를 유지한다.

## 고정 안전 규칙

- 운영 수업 데이터는 정확한 class ID, 예상 source hash, request key, 명시적
  승인 없이 변경하지 않는다.
- backfill, runtime `1`, class activation은 이 문서의 후속 gate가 채워진 뒤에만
  수행한다.
- 알림 공급자와 실제 발송은 이 릴리스의 작업 대상이 아니다.
- 롤백은 runtime을 `0`으로 낮추고 JSON authority로 복귀하며, 정규화 데이터나
  audit/receipt를 삭제하지 않는다.

## 후속 보강 항목

Task 13에서 read-only verifier, 단일 class apply 명령, canary evidence 형식,
runtime rollback의 guarded SQL 절차를 이 문서에 추가한다.
