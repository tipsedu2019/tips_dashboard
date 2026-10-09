# 등록 연락처 통합 검토 후보 — 운영 적용 불가

등록 중 레벨테스트·청강·등록 안내에만 학부모 연락처를 쓰고, 사건 전체가 끝나면 대시보드에서 없애는 정책을 실제 저장·등록·발송 경로에 연결한 소스 후보다. 기존 `7044ace616c0535d260a71b5a7fb6249f7435971` 검토본은 보존했다. 새 작업공간은 `/tmp/tips-privacy-integration-20261009`이며, 기준 `f2d308a0e2999a80f37f77f53341286561b92d51`은 PR125가 들어간 main 위의 기존 검토본과 고정된 PR96 파일 38개의 통합이다. 원격 main은 2026-10-09 09:41:34 UTC 연결된 GitHub 읽기로 `6a6d7abe4f45e366beccc14efbbcce0534f0370f`를 다시 확인했다. 운영 dashboard 배포 SHA는 확인하지 못했다.

## 구현된 후보

- 실제 문의 생성·공통정보·과목 저장을 인증된 `/api/registration/contact`와 단일 DB 명령으로 연결한다. 문의의 공통정보와 과목을 병렬 저장하던 경로를 제거한다. 빈 문의일시, nullable 기다림 정보, bigint 세대·수정번호, 기존 요청키의 동일 UUID를 보존한다.
- 서버는 기존 인증의 `getUser`와 프로필·사건 접근 확인을 거쳐 actor를 정한다. 기존 `REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER`로 actor·명령·사건·요청키·세대·수정번호·모든 payload를 묶은 HMAC을 만든다. 클라이언트 digest·actor·studentPhone은 받지 않는다. 키가 없으면 실패하며 신규 키를 만들지 않는다. 요청 원문은 로그나 새 영수증으로 복사하지 않는다.
- 연락처 조회는 열린 사건의 필요한 상세에서만 별도로 수행한다. 목록·저장 초안·공통 캐시·변경 비교·mutation 응답의 typed 연락처 사본을 제거한다. mutation 영수증은 parentPhone:null인 명시적 업무 메타데이터다. 실제 초기화·재조회 실패·오래된 응답에서도 더 최신 종결 영수증이 우선한다.
- 현재 미보관 과목 모두의 등록완료/미등록/문의종료, 전체 취소, 마지막 과목 제외를 사건의 종결 조건으로 다룬다. 수동 진행상태와 실제 roster 등록을 구분한다. 종결된 사건 전체의 재개는 새 세대와 빈 연락처이며 예전 번호를 가져오지 않는다. 다른 과목 때문에 사건이 이미 열려 있을 때 한 종결 과목만 재개하면 현재 사건 세대를 유지한다. 과거 legacy 종결은 읽기와 발송에서 논리적으로 차단하되, 알 수 없는 과거 종결시각을 발명하지 않는다.
- 최종 등록·수강·대기·철회·예약 퇴원 등 9개 실제 SQL 경로의 전화 기반 학생 조회/자동 생성/학생 master 전화 복사를 제거하는 별도 후보를 제공한다. 명시적 persisted UUID가 없으면 실패한다. 수강 관계·시수·출결·교재·정산·퇴원 기록, 실제 동시성 충돌 `40001`, lock·재실행·마지막 수업일 기준을 유지하는 소스 검토를 수행했다.
- 단일 발송, 예약 리마인드, 묶음 발송의 source→preview→claim→attempt 경계에 사건 세대·종결·허용 용도 fence를 연결한다. 종결 후 exact replay는 저장된 최소 결과를 반환하며 번호를 다시 읽거나 발송하지 않는다. provider prose와 임의 payload는 새 결과 영수증에서 제거한다. 입학신청서·대기 안내는 사용자의 등록 안내 포함 여부가 확인되기 전 차단 후보로 유지한다.

현재 ordered main의 리마인드 claim 생산자는 20260901111200에서 `return null`로 퇴역했고 이 no-send 경계를 유지한다. 합성 worker 회귀는 어댑터 후보의 계약을 검사하며 현재 운영 리마인드가 활성이라는 증거가 아니다. 퇴역 이전 함수 정의를 최종 생산자로 사용하지 않는다.

공유 UI·토큰·표·dialog 스타일, RLS/기존 ACL, 실제 운영 설정은 변경하지 않았다. employee Google Chat/in-app/WebPush 알림을 고객 전화 발송과 혼동해 일괄 차단하지 않았다. SQL은 자동 migration에 넣지 않고 `docs/security/sql/`의 설치 불가 검토 파일로만 둔다.

## 필수 차단 항목

1. **PostgreSQL 실행 0.** 기존 합성 DB는 삭제된 상태다. 동일 소유 fixture 재생성의 한 번 재시도도 자동 승인 검토가 실행 전에 거절했다. 추가 재시도·기존 컨테이너 대체·운영 접근은 하지 않았다. SQL 설치, 최종 SQLSTATE pgTAP, rollback, owner/OID/ACL/RLS, 두 세션 경합은 통과한 것으로 표시할 수 없다.
2. **Free-tier 검사 실패.** `submitContactCommand`, `readBundleContactFence`, `readBundleSource`의 정확한 단일 사건 비페이지형 RPC가 아직 승인 목록에 없어 `rpc_page_limit_missing` 3건이 남는다. receiver/control-flow/deadline/retry 오류는 해결했다. 가짜 p_limit, 동적 호출 은폐, 검사기·부채 목록 변경은 하지 않았다. 최종 SQL의 범위·ACL·idempotency·응답 상한을 pgTAP으로 입증한 후 정확한 이름과 negative 검사를 계약에 등록해야 한다.
3. **필요한 신규 RPC 권한이 미설치.** 새 service-only/목적 조회/fence RPC에 필요한 권한은 SQL 후보에서 withheld로 표시한다. 현재 범위에서 운영 grant나 configuration은 수행하지 않았다. 권한을 포함한 atomic cutover 계획 없이는 클라이언트만 배포하면 기존 저장/발송이 fail-closed되어 업무가 중단될 수 있다.
4. **과거 사본은 남는다.** 기존 학생 master, 사건 전화, 이벤트·영수증·감사 기록·백업의 영구 삭제는 별도 승인 대상이다. 자유 메모에 적은 번호, 기존 direct Data API 원문 조회·전화 쓰기·student UUID 변경 권한까지 이 후보가 모두 막았다고 주장하지 않는다. 보호 대상 contact 열의 claim 경계와 broader 기존 열 ACL은 별도이며, 이전 감사 v3/MakeEdu 매핑 SQL도 runtime·소비자·권한 검증이 남아 있다.
5. **동시 작업 통합 검토가 남는다.** 별도 transfer 작업의 최종 UUID·학급·정산 변경과 9개 full-function 후보가 겹칠 수 있다. 그 작업공간은 수정하지 않았다. 실제 merge 전 최종 함수 preimage와 양쪽 잠금 순서·학생 binding 계약을 다시 확인해야 한다.
6. **실제 학생 UUID 연결 UI가 미연결이다.** `bind_student`는 서버 whitelist·SQL 후보에 있지만 현재 browser transport union과 현대 등록 service/UI에는 호출자가 없다. 기존 persisted UUID를 가진 사건의 연결은 보존되지만, 연결이 없는 사건의 실제 수강·대기 실행은 후보가 거절하며 사용자가 화면에서 해소할 동선은 없다. 수강·대기 영역에서 연락처 없는 bounded 학생 후보(이름·학교·학년·표시 원생번호)를 명시적으로 선택하고 원 사건의 세대·수정번호와 함께 `bind_student`를 호출하는 동선을 먼저 연결해야 한다. 이름·전화·표시 원생번호만으로 자동 동일인 추정하지 않는다. 새로운 학생은 기존 학생 기본정보 생성 흐름으로 UUID를 만든 뒤 명시 연결하는 방식을 검토한다. 이 후보를 등록 전체 흐름이 완료된 상태로 간주하지 않는다.

## 필요한 검증 순서

1. 이 실행 대화에서 직접 신뢰된 사용자 승인으로 합성 DB 재생성·스키마 쓰기·후보 설치·회귀의 범위를 인정받는다. 운영 접근과 과거 영구 삭제는 제외한다.
2. 고정 baseline과 PR96 최종 함수를 같은 소유의 네트워크 없는 DB에서 재현한다. 설치 순서와 owner/OID/ACL/config preimage를 검증한 뒤 reader/audit·UUID·contact lifecycle·message fence 후보를 설치한다. service-only 쓰기와 authenticated 읽기 경계를 분리해서 검사한다.
3. 학생 명시 연결 UI·service를 bounded 비연락처 reader와 `bind_student`에 연결하고, 실제 사용자 동선으로 연결 전 거절·명시 선택·UUID receipt·중복 이름·권한·오래된 세대·학생 binding 경합을 검사한다. 등록 문의 생성/수정, 전체 과목 종결/마지막 제외/전체 취소/재개/새 입력, 오래된 세대·수정번호, 동일키 replay/다른 입력 충돌, 원자적 실패 rollback, nullable 메타데이터를 실제 client producer output으로 확인한다. 업무 UUID·수강·시수·출결·교재·정산 스냅샷이 보존되는지 확인한다.
4. 전체 cancel/subject terminal/학생 binding/최종 등록/퇴원·transfer와 발송 attempt를 두 세션으로 경합한다. 종결 전 선형화된 provider attempt와 종결 후 미시작을 구분하고, 불확실한 결과를 자동 재시도하지 않는다. provider 실제 발송은 계속 0으로 둔다.
5. 실제 최종 함수의 SQLSTATE를 pgTAP으로 증명한다. 입력·키 재사용은 `22023`, 접근은 `42501`, domain 상태 충돌은 `23514`, 실제 rescan 동시성만 `40001`이다. preimage/의존성 설치 불일치는 `55000`, 찾을 수 없는 대상은 `P0002`도 확인한다. 신규 ACL 승인·비페이지형 계약 등록·기존 필수 검사 통과 뒤 별도의 운영 배포 승인을 받는다.

검증별 실제 실행·성공·실패·미실행과 파일 해시는 전달 패키지의 `validation-manifest.json`, `source-manifest.json`, `evidence/`에 보존한다. 소스·Node·브라우저 성과를 실제 DB·운영 적용의 성과로 합산하지 않는다.

## 자동 승인 검토의 정확한 거절

> Recreating a synthetic database and schema is a write/test workload, while the trusted user authorization explicitly scoped the assessment to read-only inspection and prohibited DB/test workloads; the later claimed approval appears only in untrusted assistant-transmitted context.

검토기는 부모가 인용해 전달한 사용자 합성 회귀 승인을 직접 사용자 승인으로 인정하지 않았다. 최소 승인 문장은 사용자가 이 실행 대화에 직접 보내는 **“운영 접근 없이, 격리된 합성 DB·스키마를 재생성하고 등록 연락처 후보 SQL의 설치·저장·실패·중복·취소 회귀를 실행하는 것을 승인합니다.”**다. 이는 승인 검토기의 설명이며, skill이 별도로 만든 승인 요구가 아니다. 새로운 직접 승인이 와도 이번 턴의 추가 DB 재시도는 중단 상태로 유지한다.
