# 등록 상담 결과 5단계·재저장 설계

**작성일:** 2026-08-15

**상태:** 사용자 방향 승인 완료 · 문서 검토 대기

**대상:** 등록 상세의 과목별 상담 결과·상담 내용, subject track 상태 전이, 대기·청강·등록 연결

## 1. 목표

1. 상담 책임자는 상담 직후 `미정`, `대기`, `청강`, `등록`, `미등록` 중 하나를 결과로 저장한다.
2. 학부모가 바로 결정하지 않으면 `미정`으로 보존하고, 추후 연락이 오면 결과와 상담 내용을 수정해 재저장한다.
3. 결과 저장과 업무 상태 전이를 하나의 원자적 mutation으로 묶어 상담 결과와 목록 위치가 어긋나지 않게 한다.
4. 청강 뒤 결과가 등록 또는 미등록으로 바뀌어도 예약·출석·피드백 등 청강 이력은 보존한다.
5. 현재 반 대기에서 등록으로 바뀌면 대기 점유를 해제하고 같은 반을 등록 예정 값으로 승계해 이중 소속을 막는다.
6. 결과 저장만으로 고객 메시지나 외부 알림을 발송하지 않는다.

## 2. 확인된 현재 구조와 문제

- `ops_registration_consultations.outcome`은 현재 `enrollment`, `waiting`, `not_registered`만 허용한다.
- 화면도 `등록`, `대기`, `미등록` 세 버튼만 제공한다.
- 상담 내용 `note`는 결과와 같은 상담 행에 저장되고, 공백은 `NULL`로 정규화된다.
- 최초 상담 완료 RPC는 결과에 따라 대기·등록·미등록의 legacy pipeline을 원자 전환하지만, 후속 `save_registration_consultation_details_v1`은 상담 행만 수정하고 track 상태는 바꾸지 않는다.
- 완료된 상담은 현재 active-consultation 권한 계산에서 빠져 재수정 화면이 실질적으로 잠길 수 있다.
- 현재 반 대기의 `move_to_enrollment`는 활성 대기 claim을 제거하지만, 대기하던 반을 새 등록 예정 행으로 승계하지 않는다.

따라서 기존 상세 저장 RPC를 단순 확장하면 결과와 track 상태가 분리되고, 대기 반 정보도 유실될 수 있다.

## 3. 검토한 접근

### 3.1 채택: 상담 결과 전용 원자 저장·전환 RPC

하나의 RPC가 상담 결과·상담 내용·workflow revision을 검증하고, 상담 행·track·대기 claim·필요한 등록 예정 행·감사 이벤트를 같은 transaction에서 갱신한다.

- 장점: 결과, 목록 상태, 대기·등록 소속이 항상 일치한다.
- 장점: request key와 expected revision으로 재저장·동시 수정 충돌을 안전하게 처리한다.
- 단점: 결과별 상태 전이 규칙을 RPC가 명시적으로 소유해야 한다.

### 3.2 기각: 상담 행만 저장하고 상태는 별도 변경

현재 상세 저장과 수동 상태 변경을 연속 호출하면 첫 호출만 성공한 반쪽 상태가 생길 수 있다. 사용자가 결과를 두 번 저장해야 하고 대기 claim 정리도 빠뜨릴 수 있다.

### 3.3 기각: 후속 업무를 삭제하고 결과 덮어쓰기

청강·대기·등록 이력을 삭제하면 누가 어떤 판단으로 이동했는지 확인할 수 없다. 이력은 보존하고 현재 활성 상태만 전환한다.

## 4. 화면 계약

과목별 `전화상담 결과` 또는 `방문상담 결과` 카드에 다음 다섯 버튼을 같은 선택 그룹으로 표시한다.

1. 미정
2. 대기
3. 청강
4. 등록
5. 미등록

`대기`를 선택했을 때만 바로 아래에 다음 세부 유형을 필수로 표시한다.

- 현재 반 대기
- 신규 반 대기
- 다음 개강 대기

현재 반 대기에는 반 선택을 추가로 요구한다. 신규 반·다음 개강 대기는 반을 받지 않는다.

상담 내용 입력란은 현재 위치와 장문 입력 동작을 유지한다. 저장된 결과와 내용은 상세를 다시 열 때 그대로 표시하고, 둘 중 하나라도 바뀌면 `상담 결과 저장`을 활성화한다.

저장 실패 시 작성 중인 값은 유지한다. revision 충돌은 `최신 내용을 다시 불러온 뒤 저장해 주세요`로 안내한다. 진행 중인 청강·입학 처리처럼 먼저 마감해야 할 업무가 있으면 막힌 이유와 이동할 화면을 한 문장으로 안내한다.

## 5. 결과와 상태 매핑

내부 outcome은 다음 다섯 값으로 고정한다.

| 화면 결과 | outcome | workflow 상태 | 추가 동작 |
| --- | --- | --- | --- |
| 미정 | `undecided` | `consultation_completed` | 없음 |
| 대기 | `waiting` | 세부 유형에 맞는 waiting 상태 | 현재 반이면 대기 claim 생성 |
| 청강 | `observation` | `observation_requested` | 청강 예약 행은 만들지 않음 |
| 등록 | `enrollment` | `enrollment_requested` | 필요한 등록 예정 행 준비 |
| 미등록 | `not_registered` | `not_registered` | 종료 사유는 기존 계약이 요구할 때 별도 입력 |

`미정`도 실제 상담은 끝난 상태다. consultation은 `status=completed`, `completed_at`을 유지하고 outcome만 `undecided`로 저장한다. 새 예약이나 전화상담 대기 행을 만들지 않는다.

`청강` 선택은 청강 업무 단계 진입만 수행한다. 반·회차·담당 교사·일시는 기존 청강 예약 저장 동작에서 별도로 확정한다. 결과 저장이 예약이나 알림톡 발송을 암묵적으로 실행하지 않는다.

## 6. 재저장과 전환 규칙

### 6.1 공통

- 최초 저장과 재저장은 같은 RPC를 사용한다.
- 상담 책임자만 결과와 내용을 수정한다. 권한 없는 사용자는 읽기만 가능하다.
- 상담 내용은 결과와 함께 저장하되 빈 내용도 허용한다.
- 내용만 바꾸는 재저장은 현재 업무 상태를 다시 전이하지 않는다.
- 결과가 바뀌면 현재 상태의 활성 자원을 검증하고 허용된 전환만 실행한다.
- 이전 outcome, 새 outcome, 대기 유형, actor, 시각, workflow revision을 감사 이벤트에 남긴다. 상담 내용 원문은 이벤트 metadata에 복제하지 않는다.

### 6.2 청강

- `청강`으로 저장한 뒤 만들어진 observation, appointment, attendance, feedback은 consultation outcome과 분리된 이력으로 보존한다.
- 진행 중 observation이 있으면 결과를 다른 값으로 바꾸지 못한다.
- 담당자는 먼저 청강을 기존 동작으로 `취소` 또는 `미진행` terminal 상태로 마감한다.
- 완료·취소·미진행 observation은 보존한 채 결과를 `등록`, `미등록`, `대기`, `미정`으로 바꿀 수 있다.
- 청강 완료 뒤 `등록` 또는 `미등록`으로 이동해도 observation 행과 피드백은 수정·삭제하지 않는다.

### 6.3 대기

대기 결과 저장은 세부 유형과 track waiting 상태를 함께 바꾼다.

- 현재 반 대기: 선택 반에 활성 waitlist claim을 정확히 하나 둔다.
- 신규 반·다음 개강 대기: 활성 class waitlist claim을 두지 않는다.
- 대기 유형 또는 현재 반을 바꾸면 이전 활성 claim을 먼저 해제하고 새 claim을 같은 transaction에서 만든다.
- 대기 이력은 이벤트와 비활성 enrollment 행으로 보존하지만 현재 대기 목록에는 활성 claim만 표시한다.

### 6.4 현재 반 대기에서 등록으로 전환

현재 반 대기 결과를 `등록`으로 바꾸면 다음을 한 transaction에서 수행한다.

1. track, 학생, 기존 waitlisted enrollment, 반을 고정된 순서로 잠근다.
2. 학생과 반 양쪽의 waitlist projection에서 해당 학생을 제거한다.
3. 기존 waitlisted enrollment를 `canceled`, `roster_active=false`로 만들어 대기 이력으로 보존한다.
4. 같은 track·같은 class의 `planned`, `roster_active=false`, `student_id=NULL` 등록 예정 enrollment를 정확히 하나 생성한다.
5. workflow 상태를 `enrollment_requested`로 바꾸고 waiting kind를 비운다.
6. 등록 화면은 이 planned 행의 반을 기본 선택으로 표시한다. 교재와 첫 수업 회차처럼 아직 없는 값만 입력한다.

같은 학생·반이 활성 waitlist와 등록 roster에 동시에 존재하지 못하게 기존 roster invariant와 unique claim을 유지한다. 어느 단계든 실패하면 전체 transaction을 rollback해 기존 대기 상태를 유지한다.

신규 반·다음 개강 대기에는 승계할 class가 없으므로 대기를 종료하고 빈 등록 예정 화면으로 이동해 반을 선택하게 한다.

### 6.5 등록·입학 진행 이후

- `enrollment_requested`에서 아직 admission batch가 시작되지 않았다면 결과를 바꿀 수 있다. 열려 있는 planned enrollment는 비활성 이력으로 정리한다.
- admission batch가 시작됐거나 수납·등록 완료 상태라면 상담 결과 변경을 막는다.
- 담당자는 기존 입학 취소·정정 절차를 먼저 완료한 뒤 결과를 재저장한다.
- 이미 완료된 등록 roster나 결제 기록을 상담 결과 저장이 자동으로 되돌리지 않는다.

## 7. 데이터와 API 계약

forward migration에서 `ops_registration_consultations.outcome` check를 다섯 값으로 확장한다. 기존 세 값은 그대로 유효하다.

새 public RPC는 다음을 받는다.

- consultation ID
- outcome
- 선택적인 waiting kind
- 현재 반 대기일 때 class ID
- 상담 내용
- expected workflow revision
- idempotency request key

RPC는 source task와 subject track을 역참조해 권한을 확인하고, 클라이언트가 보낸 학생·담당자·현재 상태를 신뢰하지 않는다. 같은 request key와 같은 fingerprint는 같은 응답을 반환하고, 다른 payload 재사용은 거부한다.

응답은 최신 consultation 결과·내용, workflow 상태·revision, waiting kind, 활성 또는 prepared enrollment ID만 반환한다. 보호자 전화번호나 상담 내용 원문을 audit·notification payload에 복제하지 않는다.

기존 `save_registration_consultation_details_v1`은 신규 클라이언트에서 사용하지 않는다. 호환 기간에는 내부적으로 새 RPC의 `내용만 수정` 경계로 위임하고, 상태 전이가 필요한 outcome 변경을 단독 처리하지 못하게 한다.

## 8. 알림 경계

- 결과 저장과 상태 전이는 원본 등록 데이터를 먼저 commit한다.
- 상담 결과 저장만으로 SOLAPI 고객 메시지, 예약, 일정 생성은 실행하지 않는다.
- 기존 내부 Google Chat 규칙이 상태 변경 event를 소비할 수는 있지만 provider 실패가 상담 저장을 rollback하지 않는다.
- `미정` 재저장과 내용만 수정은 별도 외부 알림 event를 만들지 않는다.
- 청강 예약·대기 안내·입학 안내는 각 기존 화면의 명시적 preview/send 동작을 유지한다.

## 9. 테스트 전략

### 9.1 Node/UI

- 다섯 결과가 올바른 순서와 레이블로 표시된다.
- 대기에서만 세부 유형이 보이고 현재 반에서만 반 선택이 필수다.
- 결과 또는 내용 변경 시 저장이 활성화되고 저장 뒤 다시 열 때 유지된다.
- 완료된 상담도 상담 책임자에게 재편집 가능하고 다른 사용자는 읽기 전용이다.
- 미정은 상담 완료 view에 남고 등록·대기·청강·미등록은 해당 view로 이동한다.
- 현재 반 대기에서 등록 전환 시 등록 화면에 기존 반이 기본 선택된다.

### 9.2 pgTAP

- outcome check는 정확히 다섯 값을 허용한다.
- expected revision과 request key replay·충돌 계약을 지킨다.
- 결과·내용·workflow 상태·대기 claim·planned enrollment가 원자적으로 저장된다.
- 내용만 수정하면 workflow revision과 활성 자원을 불필요하게 바꾸지 않는다.
- 현재 반 대기는 학생·반 양쪽에 활성 waitlist claim 하나만 만든다.
- 현재 반 대기에서 등록 전환은 waitlist projection을 제거하고 같은 반 planned enrollment 하나를 만든다.
- 등록 전환 중 오류는 기존 waitlist claim까지 rollback한다.
- 진행 중 청강은 결과 변경을 거부하고 취소·미진행·완료 청강 이력은 결과 변경 후에도 보존된다.
- admission batch가 열린 뒤 결과 변경은 거부된다.
- 권한 없는 사용자는 consultation 존재 여부를 과도하게 노출하지 않고 거부된다.

### 9.3 브라우저·운영 검증

- 전화·방문 상담 각각에서 미정 저장 후 재접속, 등록·미등록 재저장을 확인한다.
- 대기 세 유형의 필드 노출과 목록 이동을 확인한다.
- 실제 테스트용 현재 반 대기 건을 등록으로 전환해 대기 목록에서 사라지고 등록 화면에 같은 반이 표시되는지 확인한다.
- 학생과 반 상세 양쪽에서 waitlist 잔존이 없고 아직 등록 완료 전에는 enrolled roster에도 들어가지 않았는지 확인한다.
- 청강 완료 건을 등록·미등록으로 전환한 뒤 청강 예약·출석·피드백 이력이 그대로 열리는지 확인한다.
- 외부 메시지는 보내지 않고 provider request가 0인지 별도 확인한다.

## 10. 배포와 롤백

1. UI와 서비스가 새 RPC capability가 없으면 기존 세 결과 화면을 유지하도록 호환 배포한다.
2. forward migration이 outcome constraint와 원자 저장·전환 RPC를 설치한다.
3. capability 확인 뒤 다섯 결과 UI를 활성화한다.
4. source/tests, migration, `main`, Vercel Production, 인증 UI를 각각 별도 gate로 검증한다.

문제가 생기면 UI capability를 내려 신규 다섯 결과 선택을 숨긴다. 이미 저장된 `undecided`·`observation` 값과 청강·대기·등록 이력은 삭제하거나 이전 세 값으로 강제 덮어쓰지 않는다. 원인 수정 forward migration으로 복구한다.

## 11. 범위 밖

- 청강 이력 삭제 또는 결과 변경 시 자동 정리
- 입학 batch·수납·등록 완료의 자동 역전
- 상담 메모 다중 버전 원장이나 전문 검색
- 결과 저장과 함께 고객 메시지 자동 발송
- 대기 중 정기 polling 또는 recovery worker
