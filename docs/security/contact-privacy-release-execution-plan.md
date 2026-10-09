# 등록 연락처 최종 실행 순서

이 문서는 실행 준비 계약이다. 운영 SQL·권한 변경, 마스터 연락처 영구 NULL 처리, 병합·배포·발송을 승인하지 않는다. 최종 commit/tree, 실제 운영 release, 현재 catalog/ledger, 모든 SQL·staging·실행 및 복구 파일의 SHA256은 함께 전달하는 고정 manifest에 기록한다. 대상은 `tipsedu2019/tips_dashboard`, Supabase `slnjqlzzhewblvttiidk`다. `tipsedu.co.kr` 공개 라우터의 `/admin`·`/api`는 `tipsdashboard.vercel.app`의 내부 대시보드로 연결된다.

최종 소스는 PR130 API UI와 PR131 등록 관측이 포함된 main 위에서 검증한다. 기존 PR96의 branch·draft·history는 보존하고 별도 정상 통합 PR을 사용한다. feature branch의 `vercel.json` deploymentEnabled=false로 검토용 push의 자동 preview 배포를 막는다. 이 설정은 main의 production 자동 배포를 막지 않으므로 승인 전 merge하지 않는다.

## 적용 창과 설치

1. 소유자가 정확한 최종 앱·SQL·역할별 EXECUTE·마스터 NULL 처리·복구 제한의 범위를 승인한 뒤 실행한다. 실행 담당자는 학생 master 입력/이관, 등록 쓰기, 수동 문자 준비·시도를 중지하고 기존 탭을 닫는 유지보수 창을 확보한다. 임의 계정 삭제·RLS 약화·provider 설정 변경으로 중지를 구현하지 않는다. 실행 중 승인된 다른 담당자의 main/source 변경이 있으면 최종 검증을 갱신한다.
2. 고정 read-only catalog SELECT와 전체 ledger를 다시 조회한다. 기존 함수의 원문 hash·owner/security/config/ACL, 열·제약·트리거·인덱스·RLS 및 역할 범위를 대조한다. 개인정보 행·전화 원문·credential·backup을 출력하지 않는다. classifier가 pristine-before, pr96-only, exact-after 중 하나로 판정해야 한다. source/환경 drift는 중단한다.
3. PR96의 원문 `20261004140438_registration_scheduled_index_online.sql`과 `20261004140440_registration_free_recording.sql`만 **native Supabase CLI 2.115.0**, 동일 연결·정상 migration ledger로 적용한다. `--include-all --skip-vault`를 사용하고 seed·roles·vault sync·ledger repair를 하지 않는다. 고정 compatibility stage는 이미 설치된 과거 파일의 byte를 유지하며 읽기에서 확인한 ledger version/name으로 임시 filename만 대응한다. dry-run에서 pending이 이 두 파일과 정확히 같지 않으면 중단한다. Management API/MCP migration wrapping으로 CONCURRENTLY나 session advisory lock을 대체하지 않는다.
4. 같은 catalog SELECT로 PR96 완료 상태와 ledger 두 건을 확인한다. builder의 원문 privacy 설치 6개와 runtime ACL activation을 **하나의 트랜잭션**으로 묶은 `registration-contact-privacy-atomic.sql`을 적용한다. 원문의 바깥 BEGIN/COMMIT만 SQL lexer로 제거하며 함수·DO 본문 및 모든 자체 preflight를 보존한다. native PR96·capability 회수·master NULL SQL은 이 트랜잭션에 포함하지 않는다.
5. 동일 catalog SELECT로 exact-after를 확인한다. authenticated EXECUTE는 event reader·순수 legacy predicate·case contact getter 세 개, service_role은 mutator·message fence·replay·bundle preview·현재 no-send reconciliation 다섯 개뿐이다. public/anon·반대 앱 역할의 상속 EXECUTE, grant option, private table 접근·정책 추가가 있으면 중단한다.
6. 별도 승인된 최종 앱 source를 정상 PR 절차로 배포하고 실제 production alias의 deployment ID·source SHA와 공개 contract manifest를 대조한다. 기존 탭을 다시 열어 새 source를 사용한다. 합성/안전한 metadata 검증을 실제 운영 학생 변경이나 실제 문자 발송의 성공으로 대체하지 않는다. 이 단계까지 master 기존 번호는 그대로이며, 신규 학생 master 입력·응답·전화 기반 UUID 추론/복사는 제거되어 있다.
7. **별도 영구 삭제 승인 범위**인 `student-contact-master-nullification.sql`을 적용한다. 전체 `public.students` 중 `contact` 또는 `parent_contact`가 non-NULL인 행의 두 열만 NULL로 만든다. 열린 등록의 `ops_registration_details.parent_phone`은 수정하지 않는다. UUID·이름·status·MakeEdu·class/waitlist·수업·회계·기존 history를 보존한다. 등록 단계 연락처는 열린 수명주기 동안 레벨테스트·청강·등록안내에 사용하며, 종결 뒤 번호를 복원하지 않는다. 기존 audit·event·receipt·자유 메모·exports·backups 사본을 삭제하는 단계가 아니다.
8. count-only 결과와 COMMIT, 보존 invariants, 열린 등록의 세 목적 eligibility 및 최종 release/catalog를 확인한 뒤 유지보수 창을 끝낸다. 실제 provider 발송·worker 활성화·자동 재시도는 확인 행위에 포함하지 않는다.

## 재실행과 중간 실패

원문 privacy 설치 SQL을 무조건 다시 실행하지 않는다. 이미 설치한 함수 preimage가 달라지므로 55000으로 거절하는 것이 정상이다. release classifier의 exact-after는 SQL/DML 없이 종료한다. PR96-only는 atomic privacy 묶음을 처음 실행하거나 실패 후 다시 실행할 수 있다. 마스터 NULL SQL은 기존 값이 모두 NULL이면 정상 재실행에서 affected rows 0이며 새로운 audit 행을 쓰지 않는다.

PR96 438의 concurrent 인덱스 단계는 독립 commit한다. 440 core와 정상 ledger는 native CLI의 transaction 의미를 따른다. 438 prefix의 canonical valid scheduled 인덱스와 정확한 before 함수·제약 상태만 인증된 native 재개 대상으로 인정한다. invalid/drift 인덱스, 두 unique fence 모두 없음, 부분 core/ledger 불일치 등은 중단한다. 추정한 DROP/역방향 broad unique 생성이나 ledger repair를 실행하지 않는다. 이 상태에서 기존 전체 설치가 rollback됐다고 보고하지 않는다.

Privacy atomic 묶음의 어느 installer·activation·source/ACL guard가 실패해도 그 트랜잭션의 열·함수·트리거·권한을 함께 rollback한다. 앞서 commit한 PR96은 남는다. exact PR96-only 재분류 후 같은 고정 atomic SQL을 재시도한다. 오류를 삼키거나 임의 current function hash로 preimage pin을 갱신하지 않는다.

마스터 NULL의 기존 audit v2→privacy_v3 첫 변경은 실제 native TimeZone의 OLD row hash 연속성을 검사한다. catalog TimeZone만으로 과거 모든 row의 연속성을 증명하지 않는다. 실제 55000 mismatch·업무/trigger drift·lock/statement timeout이면 해당 master 트랜잭션의 student/business/audit **행** 전체가 rollback되며 임의 UTC/Seoul 재시도·old snapshot 복원·trigger disable을 하지 않는다. 기존 audit nextval은 sequence gap을 남길 수 있으며 rewind하지 않는다.

## 승인된 복구 경계

Privacy 설치가 commit된 뒤에는 고정 `registration-contact-runtime-acl-deactivation.sql`로 새 capability EXECUTE만 회수하는 fail-closed 경로를 사용한다. 이 파일은 정확한 새 함수 원문·owner/security/config와 역할 범위를 먼저 검증하고 하나의 트랜잭션에서 회수한다. 유지보수 창은 계속 유지하며 정상 등록 업무 복구는 검토된 forward fix로 수행한다. 기존 앱 SHA로 돌아가는 것만으로 새 DB의 writer·claim·UUID 계약까지 복구되지는 않는다.

이미 commit한 사건/master 번호 NULL, 미시작 preview/claim/job 종료 및 이후 audit에서 생략된 원문은 앱·권한 rollback이나 업무 재개로 복원하지 않는다. 기존 canceled 등록은 수동 상태만으로 연락처를 열지 않는다. 실제 업무 재개가 검증된 경우에도 빈 새 generation만 허용한다. 새 privacy_v3가 존재한 뒤 옛 audit writer/CHECK를 되살리거나 새 열·receipt를 삭제하는 inverse는 실행안에 없다. 원생·수업·회계·기존 history와 실제 시작/accepted/unknown provider 결과는 보존한다.

현재 native operating connection이 사용 불가능하면 실행을 중단한다. 기존 승인된 세션을 사용해야 하며 새 자격증명 발급·키/권한 변경을 이 계획으로 대체 승인하지 않는다. Supabase 연결 앱의 성공한 catalog 읽기와 owned synthetic native CLI 성공을 운영 native 쓰기 연결의 성공으로 보고하지 않는다.
