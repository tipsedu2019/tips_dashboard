# 등록·명단 UUID 및 master 연락처 복사 경계 후보

기준은 `/tmp/tips-privacy-integration-20261009` HEAD `f2d308a0e2999a80f37f77f53341286561b92d51`이다. 원래 main·Stage1 source·exact PR96 통합 위의 **source-only 후보**이며 운영 source나 DB 설치 상태를 나타내지 않는다. [후속 SQL 초안](sql/registration-student-uuid-copy-boundary-draft.sql)은 자동 migration 경로에 있지 않고 **NOT INSTALLABLE**이다. 기존 migration·공통/문의 saver·waiting details saver·수동 workflow setter·다른 담당자의 worktree를 수정하지 않았다. Commit/push·DB/Docker·provider 호출은 0이다.

## 변경 계약

현재 세 SQL 경로의 학생 master 전화 복사 위치는 current-class-wait, start admission batch, track finalizer다. 후보는 이 세 경로의 이름/전화 lookup과 자동 master INSERT를 제거하고 `ops_tasks.student_id`의 명시적 내부 UUID만 쓴다. `uid`, `makeedu_student_no`, `makeedu_detail_id`, 학교/이름/부모 전화는 UUID 추정 근거가 아니다. 학생 생성/검증된 UUID binding API는 별도 담당자의 계약이며 이 파일이 만들지 않는다.

실제 등록·현재 수업 대기에 UUID가 없으면 `registration_student_uuid_required`/`22023`, 연결된 행이 없으면 `registration_student_not_found`/`P0002`로 차단한다. UUID를 다른 학생으로 자동 교체하거나 부모 번호를 master로 새 복사하지 않는다. **이 차단은 연락처 사용·보관 연장 사유가 아니다.** 등록되지 않은 planned/unclaimed enrollment 취소는 기존대로 학생 연결 없이 허용한다.

동일 학생의 공통 advisory key는 `hashtextextended('registration-student-id:' || internal_uuid::text, 0)`이다. parent task(s), ordered tracks, student identity/advisory 및 row, batch/claim, class, queue의 기존 상대 순서를 유지한다. 기존 details lock의 위치를 임의로 재배열하지 않는다. finalizer의 교재 다중 선택·roster 양방향 검사, 기존 actor/access/checkpoint/helper 인수, fee/invoice/payment/상태/이력/queue 쓰기는 유지한다.

4개 batch/cancel API에서는 원래 access assertion과 exact actor/key/target receipt lookup을 parent/track 뒤, 새 UUID prerequisite 앞에 둔다. 저장된 결과를 읽는 replay는 mutable-state/신규 binding 검증보다 앞서며 새 명단 변경·발송을 시작하지 않는다. 다른 target으로 key를 재사용하면 기존 `idempotency_key_reused`/`22023`가 유지된다. 이 후보는 새로운 receipt, HMAC/key, raw contact fingerprint, 공개 API 또는 EXECUTE grant를 추가하지 않는다.

퇴원·반 변경·퇴원 예약 worker의 pre/post-lock 학생 검사는 전화 대신 내부 UUID와 typed `created_at` snapshot을 비교한다. 실제 task/source/parent/claim rescan 충돌의 `40001`은 퇴원 2개·반 변경 3개·worker 2개로 남는다. 기존 업무 상태/CAS 조건 25개 raise는 개별 메시지를 유지하면서 `23514`로 교정했다. Start batch의 7개 교정과 optional 입학 안내/수동 pipeline gate 제거는 Aug24 최종 baseline의 기존 동작이며 이번 변경으로 새로 도입하지 않았다.

`created_at`은 불변의 암호학적 identity pin이 아니다. nullable timestamp의 같음만으로 관리자에 의한 UUID 재사용, 같은 timestamp 복제, 모든 외부 writer의 정합성을 보장하지 않는다. UUID binding의 불변성 및 삭제/재사용 계약과 실제 두 세션 경합 증거가 필요하다. 이름·전화의 변경 자체를 학생 identity 변경으로 취급하지 않는다.

## 실제 최종 source

| 대상 | 순서대로 적용한 source |
| --- | --- |
| current-class-wait | `20260712182834_registration_subject_track_mutations.sql` |
| start admission batch | 위 July12 → `20260803120000_registration_workflow_data_integrity.sql` → `20260824182043_registration_admission_order_independence.sql` |
| cancel/complete batch, cancel enrollment, transfer core | July12 최종 body. July16 notification wrapper는 해당 private core를 재정의하지 않음 |
| withdrawal core | `20260801110000_withdrawal_subject_scoped_completion.sql` → `20261006090000_withdrawal_last_lesson_release.sql` → `20261007141548_withdrawal_completion_without_settlement.sql` |
| track finalizer | `20260825152044_registration_admission_checklist_roster_consistency.sql` → `20260922105632_registration_multiple_textbooks.sql`의 2개 교재 패치 |
| scheduled withdrawal worker | `20261006090000_withdrawal_last_lesson_release.sql` |

`20261004140440_registration_free_recording.sql`의 최신 수동 workflow setter에는 finalizer 호출이 없다. Aug25의 이전 setter 동작을 최신 PR96 계약으로 재사용하지 않는다. 이 후보는 수동 상태 변경에 자동 enrollment 호출을 넣지 않는다. 다른 전반 작업 thread `01a11f6e-2967-772b-91ee-3a61dd1f30b9`의 미공개 withdrawal/transfer 후보와 중복 여부는 **unknown**이다. 단일 integration owner가 정확한 source를 비교한 뒤 합쳐야 한다. 현재 preimage와 다르면 installer는 `55000`으로 전체 transaction을 거절한다.

## 검증 상태

[Node source 검사](../../tests/registration-student-uuid-copy-boundary.test.mjs) **15/15**, 해당 test와 [ordered-source helper](../../tests/helpers/registration-privacy-uuid-final-source.mjs)의 ESLint 통과. 검사는 9개 최종 body 및 전후 source SHA, 전화 lookup/master INSERT 부재, 기존 나머지 DML/helper/access/fingerprint 보존, early exact replay, 업무/실제 collision SQLSTATE의 source 분리, 마지막 수업일/정산 독립, 수동 setter 범위를 확인했다. SQL literal 재구성은 PostgreSQL catalog 실행이 아니다.

**PostgreSQL syntax·설치·owner/ACL·exact SQLSTATE·pgTAP·rollback/replay·두 세션 경합·provider 실행은 모두 0이며 미검증이다.** 설치 guard에는 전체 prosrc hash와 owner/ACL/security/search_path 및 실행 속성의 전후 비교를 넣었지만 guard 자체를 실행한 증거는 없다. Source tests가 runtime 정책 검증을 대체하지 않는다. 기존 Stage2 audit/link의 Node 4개 및 root Stage1 reader 162 pgTAP 결과를 이 후보의 SQL 통과 수로 합산하지 않는다.

## 설치 전 반드시 해결할 조건

1. Audit/link → lifecycle/명시적 UUID binder → identity → provider gate의 실제 최종 source 순서, 동일 UUID key, parent/track/details lock 순서를 통합해야 한다. Binder/common saver는 phone_audit 담당이며 identity source와 소비자 모두 실제 검증해야 한다.
2. 합성 pgTAP은 bound UUID의 동명이인·전화 null/변경, missing/deleted UUID, task/claim mismatch, closed/reopened contact 뒤 exact replay와 key mismatch, unbound planned cancellation, 모든 owner/ACL/config, source drift/DDL replay 전체 rollback을 요구한다. `22023/P0002/23514/55000`은 최종 함수에서 실제 assertion으로 확인해야 한다.
3. 두 세션에서 registration↔withdrawal/transfer/worker의 parent·claim rescan, 동일 UUID로 여러 case/학생 metadata 변경, queue generation·기준일, fee 네 조합, roster 이미 제거된 경로, 다른 반/과목 보존을 검증해야 한다. 테스트·assertion을 생략해서 release gate를 통과시키지 않는다.
4. 운영 cutover에서 진행 중인 이전 writer, catalog lock/시간, provider/DB의 실제 source/configuration을 확인하지 않았다. 함수 source 교체만으로 운영의 새 복사 중단을 증명하지 않는다.
5. Direct Data API의 기존 학생 table 권한, admin migration-review의 legacy 전화 의존성, 자유 메모, 이전 audit·receipt·export·cache·backup 사본은 이 후보로 제거되지 않는다. 전체 전화 차단이나 영구 purge를 주장하지 않는다. 학생 master의 blanket row gate나 전역 ACL/RLS 변경을 임의로 추가하지 않았다.

## 승인 검토 차단

현재 task에서 root는 DB preparation의 재차 auto-review 거부와 승인 transcript의 신뢰 문제를 알렸고, DB/Docker/runtime SQL 재시도·우회를 명시적으로 금지했다. 해당 재거부의 전체 원문은 이 하위 task에서 직접 수신하지 않았으므로 root 보고와 직접 도구 결과를 구분한다. 이 task에서 DB 명령을 시도하거나 다른 agent에게 대신 실행시키지 않았다.

이전 Stage2 prerequisite에 대한 직접 auto-review 거부 원문은 [별도 증거](/tmp/tips-privacy-evidence-20261009/contact-review/README.md)에 보존했다. 새 identity의 DB 검증도 **BLOCKED (No run)**이며, 승인 원문이 확인된 허용 범위의 새 심사와 실제 검증 전에는 설치·운영 완료로 보고할 수 없다.
