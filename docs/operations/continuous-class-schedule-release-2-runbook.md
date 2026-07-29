# 연속 수업 일정 Release 2 운영 런북

## 기본 원칙

- runtime 0에서는 `classes.schedule_plan`이 권위 원본이다. apply·activate를 실행하지 않는다.
- apply는 단일 class, 정확한 source hash, UUID request key, `--apply`, class ID 재확인이 모두 있어야 한다.
- apply와 verifier는 service role이 아닌 인증된 관리자 access token만 사용한다. 토큰·이름·원본 JSON을 출력하지 않는다.

## Canary 절차

1. read-only preview에서 critical issue 0인 class ID 하나를 고른다.
2. class ID·count·issue code만 사용자에게 제시하고 쓰기 승인을 받는다.
3. apply 뒤 source hash·projection mismatch·audit·ACL·runtime/mode를 verifier로 기록한다.
4. browser에서 등록·휴보강·대시보드 parity를 확인한다. 공급자 발송은 비활성으로 유지한다.
5. 사용자 승인 뒤에만 다음 wave를 진행한다.

## runtime 0 rollback

1. runtime을 0으로 되돌린다.
2. 해당 class를 normalized에서 shadow로 demote한다.
3. projection·audit·consumer parity를 다시 확인한다.
4. legacy `schedule_plan`을 덮어쓰지 않는다.
