# 검증 영수증 읽기 요약

`scripts/summarize-validation-receipt.mjs`는 기존 영수증·로그의 지문과 현재 검사 입력을 읽어 비교한다. 입력 영수증/소스를 쓰지 않고 검사를 실행하지 않는다. 자동 skip/cache/승인/PR/배포 기능은 없다. 출력의 `matching_records`는 **지정한 기록끼리 일치한다**는 정보이며 실제 실행 출처 인증이나 재사용 허가는 아니다. 모든 결과는 `decision: human_review_required`, `provenance: not_authenticated`다. fake executor도 같은 모양의 영수증을 만들 수 있다는 한계를 유지한다.

## 지원 범위

- 첫 개선의 static_v1: invocation의 context/고정11명령, inputs, steps, result를 서로 비교한다.
- 기존 legacy static11: invocation/result 배열과 별도 completion을 비교한다. `interruption.json`만으로 완료 처리하지 않는다. 정상 resume의 시간 간격 자체는 오류가 아니다.
- 전체DB108SQL/27probe 영수증은 `unsupported`다. parity/rollback/ledger/cleanup/relay까지 검토해야 하므로 단순 exit0만으로 판정하지 않는다.

## 사용

```sh
node scripts/summarize-validation-receipt.mjs \
  --root /absolute/source-checkout \
  --receipt /absolute/existing-receipt-directory \
  --expected-plan /absolute/reviewed-current-invocation.json
```

`--expected-plan`은 검토자가 현재 기준으로 지정한 명령계획이다. 두 기존 static invocation 형식을 읽을 수 있다. 이 파일이 신뢰할 수 있는 현재 계획인지는 도구가 인증하지 않는다. 동일한 옛 invocation을 기준으로 지정했다는 이유로 현재 요구사항을 검토했다고 해석하지 않는다. 인수를 생략하면 명령옵션/base 대조는 `not_checked`이고 일치 완료로 표시하지 않는다.

CLI exit0은 요약 출력 성공일 뿐 테스트 PASS나 gate 통과 코드가 아니다. 이 CLI를 검사면제의 조건문에 연결하지 않는다. 사용 오류/예상 밖 읽기 오류에는 고정된 `unavailable` 요약과 exit1만 반환하며 원문 오류를 출력하지 않는다. Git 호출은 HEAD와 tracked 목록의 고정 읽기 명령뿐이고 optional lock/fsmonitor를 끈다. 영수증 안 command/args는 실행하지 않는다.

## 각 정보의 의미

| 필드 | 의미 |
|---|---|
| execution.status | `recorded_complete`, `failed`, `partial`, `not_run`, `invalid`. 완료 플래그의 boolean·순차시간·최종완료·중복/누락·command/log 지문 형식을 확인한 기록 상태. 명령기록 자체의 부재는 missing이며, 명시적 빈 steps의 미실행 기록과 구분. 실행 전 실패는 finished0인 failed |
| head / base | 현재HEAD 대 기록HEAD, 지정한 기준계획의 base 대 기록base. HEAD만 달라도 개별 입력의 match 정보는 남음 |
| inputs | 기록된 파일의 byte SHA matched/changed/missing/blocked/unreadable 개수와 aggregate manifest. tracked 목록의 추가파일도 별도 개수 |
| commandOptions / commandOrder | 명령·옵션 집합의 일치와 순서 차이를 별도 표시. 순서만 달라졌다고 과거 단계 기록을 삭제하지 않음 |
| logs | 실행으로 기록된 고정11이름의 로그 SHA 대조. 미실행 단계의 로그 부재를 성공으로 채우지 않음 |
| runtimeEvidence | Node버전 기록·지정계획과의 비교. env와 실행파일 bytes는 영수증이 증명하지 않으므로 미확인으로 남음 |
| outcome | 위 차원에서 관측된 `matching_records`, `mismatch`, `missing`, `incomplete`, `not_run`, `failed`, `invalid`, `unsupported`. 다른 필드의 세부 차이도 함께 읽어야 함 |

현재 소스 전체의 원자적 스냅샷이나 clean 상태는 인증하지 않는다. untracked/ignored 파일과 toolchain 환경의 불변, 실제 suite의 import closure, 실행 출처는 별도 검토 대상이다. legacy에는 Node버전/env 근거가 없으므로 경로 문자열만 보고 도구 동일성을 단정하지 않는다. exact query/immutable plan은 최종 base/head에서 닫아야 하며, 내용이 같다는 이유만으로 새 경계 검사를 자동 생략하지 않는다.

## 출력과 파일 접근

출력은 고정 상태·개수로 제한한다. 원문 로그/오류·경로/파일명·명령 인수·학생/직원 정보·임의JSON 필드는 출력하지 않는다. commit SHA처럼 보이는 값도 비밀일 수 있어 HEAD/지문 값 자체는 출력하지 않는다. 입력 파일은 root 내부의 고유 상대 tracked regular file만 지문을 읽는다. traversal·민감한 숨김경로·외부 symlink·비정규 파일은 차단한다. 로그는 고정11이름만 읽으며 symlink를 거절한다. JSON4MiB·개별파일16MiB 초과는 미확인/차단으로 남긴다.

## 두 로컬 개선의 인수

1. `run-release-static-checks.mjs`: 승인된 범위의 실제 로컬 정적 명령을 값싼 gate부터 실행하고 원래 소스context·지문·완료 영수증을 남긴다. 모든 기존 필수검사를 유지한다.
2. 이 읽기 도구: 그 영수증과 과거 legacy 기록을 현재 소스와 비교해 사람이 검토할 차이를 요약한다. 실행기나 안전관문의 성공판정을 대신하지 않는다.

좁은 기능 검증은 `node --test tests/validation-receipt-summary.test.mjs`다. 통합 도구 경계는 첫 개선의 `tests/release-static-preflight.test.mjs`와 함께 확인한다. 제품/고비용DBsuite를 실행하는 테스트가 아니다.
