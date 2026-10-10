# 등록 연락처 최소화 소스 후보 완결

검증 범위는 소스·정적 계약·합성 Node/VM/mock이다. 운영 상태 또는 실제 SQL 실행의 증거가 아니다. 기준 원격 main은 `4a2cda49ee4e92aa45ddb300c8b86e9ece9fddba`이며 2026-10-09 12:10:37 UTC 읽기 전용 fetch로 재확인했다. 기존 `15c22216`, `90bcd655`, 원본 작업 폴더와 AI 동시 작업 폴더는 보존했다. 정확한 제출 commit/tree, 파일 SHA, 실행 결과는 전달 묶음의 provenance 및 validation manifest에 기록한다.

| 항목 | 구현한 소스 경계 | 증거의 한계 |
| --- | --- | --- |
| 단일 응답 RPC | 명령 8개 인자, fence 3개, 기존 private bundle 3개, 새 metadata preview 3개를 별도 모델링한다. 실제 명령별 필수 응답, UUID/task/track 상관, 필드·배열·UTF-8 128000 byte·깊이·8초 transport·retry(false)를 검사한다. 기존 registry/debt에 이름만 추가하거나 가짜 p_limit을 넣지 않는다. | 응답 예산은 SQL 실행 비용·전체 HTTP 시간·사업상 최대 인원을 뜻하지 않는다. 서버의 명령 결과 불명확 시 같은 request key로 조정해야 한다. |
| 묶음의 등록 종결 | 각각의 현재 트랙, task, archive, 수동 종결 및 실제 예약 종류/상태/revision을 검사한다. 공유 레벨테스트 예약은 유지한다. LIMIT4로 네 번째 항목을 탐지하고 성공 결과를 자르지 않는다. case/source 잠금 후 같은 시각으로 다시 수집하고 저장된 묶음과 현재 후보를 비교한다. | 실제 DB 잠금·동시성·rollback은 실행하지 않았다. 완성된 bundle prepare/send worker가 없는 현재 구조에 새로운 발송 경로를 만들지 않는다. |
| 미리보기 연락처 | 활성 bundle preview는 새 12-key RPC만 사용한다. 기존 13-key source의 parentPhoneDigits를 DB 안에서 제거한 뒤 HTTP로 반환한다. preview parser는 원문 필드가 들어오면 실패하며 기존 private 계약은 별도로 유지한다. | 기존 guarded resolver의 연락처 유효성 조건은 유지한다. 연락처 없는 case의 새 허용 정책을 만들지 않는다. |
| 학생 목록·상세·운영 조회 | 최종 ordered 정의 7곳을 재구성하고 실제 JSON 반환 whitelist와 검색 경로에서 학생/보호자 전용 연락처를 제외한다. 직접 학생 조회는 공유 master projection을 사용하고 정확한 UUID 또는 기존의 제한된 이름 조회를 보존한다. | 설치된 실제 함수·physical schema·Data API 권한은 아직 확인하지 않았다. 임의 future column, 자유 메모·댓글·첨부·백업·감사 저장본까지 제거됐다는 주장도 아니다. |
| 등록 변경 이력 | bounded security-invoker RPC에서 task/event RLS, 정렬과 shared-visible 구분을 유지한다. 최신 timeline은 p_limit 이하 30행, 최신 유효 v1 이관 증빙은 별도 LIMIT1로 같은 응답 안에 보존하며 중복을 제거한다. 알려진 연락처 field_name 및 유효한 구조화 JSON의 연락처 키를 HTTP 전에 제외한다. 저장 이력은 수정하지 않는다. | 이전의 무상한 상세 이력과 전체 표시가 동일하다는 주장은 아니다. 일반·손상된 텍스트와 다른 키의 전화처럼 보이는 값은 보존한다. 유효 JSON의 jsonb 변환 실패는 선언한 55000으로 거부한다. 128000 byte/깊이64의 실제 과거 데이터 호환성은 미검증이다. |

현재 명확한 목적 경계는 유지한다. visit consultation, admission application, waiting notice의 신규 연락처 사용은 미승인 상태로 계속 거부한다. 은퇴된 reminder 생산과 NULL 반환도 유지한다. 이를 새로 허용하려면 목적·종결 조건을 별도로 확정해야 하며 현재 소스 완결을 위해 그 결정을 대신하지 않았다.

기존 PR96의 수동 상태와 UUID 연결은 등록 finalizer를 자동 호출하지 않는다. PR126의 운영 ledger 두 개, PR127의 Chat ledger 및 기존 AI prerequisite를 보존한다. 현재 main과 다른 AI prerequisite migration 두 개(`20261004140438`, `20261004140440`)는 후보의 선행 조건이며 운영 적용 증거가 아니다. SQLSTATE `40001`을 업무 충돌로 새로 사용하지 않는다. draft의 예상 domain SQLSTATE와 소스 검사 결과는 실제 pgTAP 또는 runtime SQLSTATE 증거로 취급하지 않는다.

성능 최소 패치는 별도 main 사본에서 확인한 뒤 동결된 개인정보 후보의 별도 통합 사본에 적용한다. 원본 성능 후보 `614ed117`과 동일 tree의 main 호환 사본에서 서비스 123건, 타입·lint·쿼리 제한을 확인했다. 새 SQL/RPC/컬럼을 요구하지 않는 그 패치는 개인정보 DB 승인과 독립적으로 검토할 수 있다. 개인정보 통합본 자체는 새 RPC와 SQL cutover를 요구하므로 기존 DB에 코드만 먼저 설치할 수 없다. 합성 지연 개선은 운영 35초의 원인을 확인하거나 실제 개선율을 측정한 것이 아니다.

설치 전 남은 작업은 최신 후보 하나의 격리 SQL 설치, final 함수 pgTAP·정확 SQLSTATE, 인증/RLS/ACL, 중복·취소·실패·동시성·rollback 검증이다. 새 invoker 이벤트 RPC와 private pure 이관 증빙 predicate의 authenticated EXECUTE는 기존 table RLS를 유지하는 소스 설계이며 적용하지 않았다. private schema USAGE를 새로 부여하지 않는다. 서비스용 새 RPC ACL도 적용하지 않았다. 과거 50개 초과 영수증, NULL-generation cached bundle 및 응답 예산 초과 이력은 count-only 사전 확인과 명시적 호환 방침이 필요하다. 최신 30건 일반 이력 표시를 채택할지, 전체 과거 이력의 별도 페이지 조회가 필요한지는 설치 전에 확정해야 한다. 성공 결과 자르기, 임의 backfill, 기존 연락처 영구 삭제는 하지 않는다.

운영 SQL·실제 grants·계정 변경·발송·배포·purge·backup 다운로드·비밀 파일 읽기·DB 재시도는 모두 0이다. 기존 자동 승인 심사는 합성 DB/schema 생성이 쓰기 및 테스트 부하이고 당시 허용 범위가 읽기 전용이라는 이유로 실행을 거절했다. 이 실행 대화에는 사용자 직접 DB 승인 메시지가 도착하지 않았으므로 전달된 완료 답변만으로 재시도하지 않았다.
