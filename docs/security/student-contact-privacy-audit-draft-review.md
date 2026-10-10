# Stage2 감사·MakeEdu 매핑 source-only 검토 결과

2026-10-09 08:30 UTC. 기준 main `6a6d7abe4f45e366beccc14efbbcce0534f0370f`, 독립 작업공간 `/tmp/tips-privacy-implementation-20261009`. **설치 가능한 migration이 아니다. 운영 변경, provider 조회/변경, 영구 정리, Stage2 SQL 실행은 0이다.**

## 산출물과 실제 검증

- [SQL 초안](/tmp/tips-privacy-implementation-20261009/docs/security/sql/student-contact-privacy-audit-link-draft.sql): 기존 writer inline 학생 분기, nullable 별도 opaque ID, 같은 transaction의 lazy privacy 경계. 기존 migration·학생 finalizer·등록 writer·권한·RLS·role·secret 수정 없음.
- [pgTAP 설계](/tmp/tips-privacy-implementation-20261009/supabase/tests/student_contact_privacy_audit_test.sql): **90 assertion 설계, 실행 0**. 실제 syntax·DDL 성공·owner/ACL·정확한 SQLSTATE·rollback·경합 증거를 아직 제공하지 못한다.
- [전용 합성 prerequisite](/tmp/tips-privacy-implementation-20261009/tests/fixtures/student-contact-privacy-audit-prerequisites.sql): 실제 데이터가 없는 owned DB에서만 사용하도록 작성. 합성 v2/v1 preimage와 손상 fixture를 포함하며 **실행되지 않았다**.
- [Node source 검사](/tmp/tips-privacy-implementation-20261009/tests/student-contact-privacy-audit-draft.test.mjs): Node v24.19.0에서 **4/4 통과**. final ordered writer의 원문 hash, 실행 속성 보존 guard, 비학생 capture/predecessor/context/lock/sequence 보존, 역사 DML·권한 변경·trigger 우회 부재를 확인했다. PostgreSQL 검사로 확대해서 해석하지 않는다.
- [정확한 source SHA-256·실행 구분](/tmp/tips-privacy-evidence-20261009/contact-review/manifest.json), [Node 결과](/tmp/tips-privacy-evidence-20261009/contact-review/node-source-tests.log).

root가 별도로 보고한 Stage1 reader **162 pgTAP 통과**는 이 Stage2의 검증 수에 포함하지 않는다. 이 문서는 Stage2 source freeze 당시의 검토 결과이며, 이후 root의 로컬 review package에 포함된다. push·운영 설치는 수행하지 않는다. 검사 시점 네 파일의 trailing whitespace는 0이다.

## 확인한 설계 경계

1. [현재 public.students만 투영](/tmp/tips-privacy-implementation-20261009/docs/security/sql/student-contact-privacy-audit-link-draft.sql:202)한다. `contact,parent_contact`는 새 INSERT/DELETE snapshot과 UPDATE patch에서 제외한다. 미래 physical contact 제거 자체나 이름·자유 메모에 붙은 전화번호 제거를 수행하지 않는다.
2. [실제 OLD raw hash](/tmp/tips-privacy-implementation-20261009/docs/security/sql/student-contact-privacy-audit-link-draft.sql:207)는 새 column만 빼서 계산한다. [v2 predecessor hash와 실대조](/tmp/tips-privacy-implementation-20261009/docs/security/sql/student-contact-privacy-audit-link-draft.sql:296)한 후 새 chain의 `privacy_boundary_v3`로 전환한다. 단순 predecessor hash 복사로 검증을 대신하지 않는다. 원본 v2가 현재 session TimeZone과 다르면 55000을 내는 후보이며 guessing/bypass는 없다.
3. 이후 [UTC 6자리 microsecond canonical created_at](/tmp/tips-privacy-implementation-20261009/docs/security/sql/student-contact-privacy-audit-link-draft.sql:211)로 privacy hash를 비교한다. NULL·±infinity 보존, 유한 지원 범위 1–9999 밖 실패, 잘못된 v2/v3 hash 실패는 pgTAP 설계에 포함했으나 실제 결과는 미검증이다.
4. 기존 비학생 v2 분기와 actor/request context·advisory lock·sequence는 원문 보존 검사로 확인했다. 새 receipt/HMAC/replay/send protocol은 없다. owner/ACL/security/config 및 추가 실행 속성은 설치 전후 guard에 포함된다. 기존 forward/reverse helper와 index는 그대로다.
5. 새 `makeedu_detail_id`는 내부 UUID·표시 uid·결제용 makeedu_student_no와 별개다. nullable ASCII opaque token의 syntax만 검사하며 기존 mapping 0개, backfill 0개다. 외부 학생 일치·테넌트 권한·안정성·unique를 주장하지 않는다. phone-shaped numeric token 거절은 보수적 후보이며 합법 외부 ID와의 충돌 가능성을 별도 검증해야 한다.

## 설치를 막는 남은 조건

| 우선순위 | 조건 | 근거·필요 작업 |
| --- | --- | --- |
| P0 | 최종 SQL 실제 검증 없음 | prerequisite·초안 설치·pgTAP·DDL replay/rollback·두 세션 실행 0. 승인 원문을 포함한 범위가 확인된 후 별도 심사/검증이 필요하다. 현재 파일을 설치하지 않는다. |
| P0 | 복원 소비자와 privacy format 경계 미해결 | [generic helper는 raw base의 contact를 그대로 남긴다](/tmp/tips-privacy-implementation-20261009/docs/security/sql/student-contact-privacy-audit-link-draft.sql:29). 앱 summary SELECT는 metadata만 쓰지만 외부/export/restore 소비자 존재나 dispatch는 입증하지 못했다. 소비자 inventory와 non-restoring 계약이 필요하다. |
| P0 | 새 column의 권한 상속·writer 검증 | [table-wide SELECT/INSERT/UPDATE가 새 column도 포괄할 수 있다](/tmp/tips-privacy-implementation-20261009/docs/security/sql/student-contact-privacy-audit-link-draft.sql:14). explicit grant 없음은 읽기/쓰기 제한의 증거가 아니다. column별 scope와 verified association writer를 확정해야 한다. |
| P1 | 운영 DDL 잠금·인덱스 크기/시간 | [non-CONCURRENT index와 ALTER TABLE](/tmp/tips-privacy-implementation-20261009/docs/security/sql/student-contact-privacy-audit-link-draft.sql:42)는 transaction-held lock을 갖는다. 실제 audit 크기/경합/시간은 unknown이다. timeout만으로 install window를 보장하지 않는다. |
| P1 | legacy TimeZone mismatch의 실제 영향 | [배포된 v2의 시간대 분포 unknown](/tmp/tips-privacy-implementation-20261009/docs/security/sql/student-contact-privacy-audit-link-draft.sql:36). source inspection이나 합성 UTC/Seoul 사례로 실사용 학생의 최초 write 성공률을 주장할 수 없다. 실패는 55000으로 유지하고 증거 없이 우회하지 않는다. |
| P1 | NOT VALID shape와 source guard | 기존 행 scan/backfill을 하지 않지만 새/수정 행에는 CHECK가 적용된다. 실제 최종 writer·role/policy·shape fingerprint·오류 rollback을 별도로 검증해야 한다. one-shot source guard는 migration ledger의 멱등성을 대신하지 않는다. |

`privacy_v3`의 CONTACT-IRREVERSIBLE 설명은 **새 payload에서 physical contact key를 복원하지 않는다는 범위**다. [경계에 남는 legacy unkeyed SHA-256](/tmp/tips-privacy-implementation-20261009/docs/security/sql/student-contact-privacy-audit-link-draft.sql:21)은 contact-derived commitment이며 guessing 저항이나 암호학적 소거를 보장하지 않는다. HMAC/key 도입, 과거 audit·receipt·export·backup purge는 이번에 포함하지 않았다.

## 자동 승인 검토 거부

예정 명령은 전용 network-none container의 합성 prerequisite 실행이었다. **auto_review가 실행 전에 거부했고, 다른 agent·명령·경로로 우회하지 않았다.** 정확한 명령과 실행 0은 manifest에 기록했다. 현재 위임 기록에서 거부의 원래 timestamp는 확인되지 않는다.

> This commits schema creation, synthetic row inserts, and deliberate audit-log corruption, whereas the user authorized read-only inspection and prohibited DB/test workloads; later agent messages cannot expand that authorization.

따라서 Stage2 DB 검증은 **BLOCKED (No run)**다. 후속 isolated implementation/synthetic verification 권한의 원문을 확인하기 전까지 source-only 후보 상태를 유지한다. 소스 구현 완료를 운영 설치 완료나 SQL 검증 성공으로 바꾸어 해석하지 않는다.
