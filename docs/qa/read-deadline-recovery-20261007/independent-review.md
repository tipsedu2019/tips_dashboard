# 읽기 deadline 패치 독립 재검토

판정: 현재 검토한 구현에서 남은 P1/P2를 찾지 못했다. 메타데이터 `{ error }` 응답의 sibling 취소 공백과 이미 만료된 deadline의 오류 정규화 공백은 모두 수정·합성 검증됐다. 운영 장애의 근본 원인을 해결했다고 판단하지 않는다.

검토 경로는 `tips-read-deadline-fix`, 기준 HEAD는 `3dac9307732b1d66fddf95b62ed4ed08c1d70ed1`이다. 검토 시 미커밋 변경이었다. 최종 검증한 제품 4파일의 SHA-256은 `independent-read-deadline-results.json`의 `sourceSha256`에 기록했다. 커밋 후 배포 후보 판단은 이 내용과 최종 tree가 같은지 확인해야 한다.

## 수정 확인

- `withReadDeadline`은 SDK 토큰 획득 전후를 포함한 읽기 Promise와 취소를 경쟁시킨다. callback은 호출 시 바로 시작하며 동기 throw도 Promise rejection으로 처리한다. 늦은 응답은 이미 종료된 결과를 바꾸지 못한다.
- helper와 RPC는 같은 deadline을 공유한다. 명시적으로 전달한 deadline 사용 시 추가 timeout을 만들지 않는다. 이미 만료된 deadline은 읽기를 시작하지 않고 `read_operation_timeout`으로 정규화한다.
- service와 hook의 메타데이터 두 RPC는 각각의 `{ error }`를 공유 wrapper 내부에서 throw한다. 한쪽 SQL 오류가 나면 다른 쪽 signal을 취소하고 원래 오류를 보존한다. 번호 목록 자체의 성공 결과와는 독립적이다.
- 카탈로그의 모든 페이지는 공유 signal을 쓰고 응답 후에도 signal을 확인한다. 취소 후 늦은 응답이 도착해도 추가 페이지를 요청하지 않는다. 조회들의 `.retry(false)`는 유지된다.
- 저장/발송 경로, 인증 설정, RLS/ACL, DB 정의는 변경하지 않았다. 이 패치에 DB migration은 필요하지 않다.

## 독립 검증 결과

`independent-read-deadline-repro.mjs`를 설치된 SDK와 실제 수정된 service/helper에 대해 실행했다. 외부 네트워크 없이 `fetch`와 `auth.getSession()` 경계만 합성으로 주입했다. 결과는 `independent-read-deadline-results.json`, **5/5 PASS**다.

1. 같은 deferred `getSession()`을 기다리는 두 읽기 중 하나를 caller abort: 해당 읽기는 즉시 종료, session 완료 후 다른 읽기만 가짜 transport 작업 1회 성공. 실제 공유 인증 서버의 refresh를 취소하거나 운영 인증을 재현한 테스트는 아니다.
2. stats RPC의 합성 HTTP 500/SQLSTATE `57014`: options sibling signal 즉시 취소, 원래 `57014` 유지, 늦은 options 응답에도 결과 불변, 최초 3개 요청 외 추가 요청 없음.
3. options RPC 오류도 반대 방향으로 같은 결과.
4. 전달한 deadline 사용 중 추가 타이머 0개, callback 동기 시작 유지.
5. 진입 전 이미 만료된 deadline: 읽기 호출 0회, 정규화된 timeout 오류.

직접 관련 `read-deadline` + 실제 hook/페이지 회귀 **42/42 PASS** 로그는 `independent-read-deadline-tests.txt`에 있다. 이후 작은 정규화 수정과 추가된 회귀에 대해서만 대상 검증 **5/5 PASS**를 실행했고 `independent-read-deadline-followup-tests.txt`에 보존했다. 실패한 메타데이터의 늦은 성공을 더 이상 성공 결과로 인정하지 않는 테스트 변경과, 서로 다른 caller 취소 격리도 확인했다. 전체 Linux suite/build 결과는 부모 담당 검증이며 이 문서의 독립 실행 결과에 합산하지 않았다.

## 범위와 남은 한계

deadline은 변경된 관리 읽기 단위에 적용된다. 앱 전체 요청·인증 복구·worker에는 적용되지 않는다. 레거시 `loadInitialPage`의 기본 기간 조회와 후속 page는 각각 제한되므로 여러 단계를 합친 전체가 항상 8초 이내라는 뜻은 아니다. 카탈로그 묶음은 같은 deadline을 공유한다.

취소는 클라이언트 대기와 fetch signal에 대한 보장이다. 이미 실행 중인 DB 작업이 반드시 중단됐다는 보장이나 공유 인증 갱신 자체를 종료했다는 의미가 아니다. 브라우저의 실행 정지/타이머 지연을 포함한 절대 wall-clock 상한도 이 테스트가 증명하지 않는다. 운영 DB 지연·auth 504의 원인과 실제 worker 중첩은 미확정이다.

재현: `/Users/hyunjun/Documents/Codex/2026-10-07/task/tools/node --experimental-strip-types <evidence-dir>/independent-read-deadline-repro.mjs <worktree>`.

이 독립 검토에서는 제품 파일을 수정하지 않았고 운영 SQL·로그·설정·배포에 접근하지 않았다.
