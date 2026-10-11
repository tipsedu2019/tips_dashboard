# 청강 상세 직접 진입의 편집기 사전 로딩

기준 main: `372c6a9930f0fe673433cbce90bb586ff9b33ead` (PR134).

`openRegistrationObservation`은 상세와 지정 청강 이력 조회를 마친 뒤 화면을 확정할 때 처음 편집기 모듈을 로드했다. 다른 세 상세 진입 경로에서 사용하는 `preloadRegistrationApplication()`을 이 경로에서도 사전 runtime/task 검사 후 시작한다. 모듈 준비를 새로운 데이터 확정 조건으로 추가하지 않는다.

상세·이력 읽기, DTO, 오류 처리, viewer/runtime/선택 ownership, 옵션 조회 시작 조건은 그대로다. 기존 lazy loader가 사전 로딩과 렌더의 모듈 Promise를 공유하고, import 실패를 삼킨 뒤 다음 import 시 재시도한다. 유효한 진입이 나중에 조회 실패 또는 선택 전환으로 폐기되면 쓰이지 않는 편집기 코드가 로드될 수 있다. 추가 DB 읽기나 mutation은 없다.

## 합성 측정

실제 TypeScript callback을 AST로 추출하고 실제 lazy loader와 ownership helper를 실행했다. 데이터·모듈 I/O와 React state setter만 합성 대체했다. 화면 확정 시 lazy render를 시작하는 harness이며 실제 브라우저, React/Next 렌더링 시간, 네트워크 경합 또는 서버 실행 시간을 측정하지 않았다.

각 조건 1회 준비 실행 후 10회 중앙값(ms):

| 합성 지연: 상세 / 이력 / 편집기 | 이전 | 변경 후 |
|---|---:|---:|
| 최초 120 / 80 / 80 | 204.60 | 122.11 |
| 최초 40 / 30 / 120 | 164.28 | 122.13 |
| 편집기 이미 로드됨, 120 / 80 / 80 | 122.43 | 122.47 |

매 실행에서 상세 adapter와 이력 adapter는 각각 1회 호출됐다. 최초 사전 로딩과 이후 렌더는 모듈 import 1회를 공유했다. 변경 전 새 회귀 3개 실패, 변경 후 lazy 경로 7개 모두 통과했다. 거절된 runtime/task, 조회 실패·없는 이력, 읽기 전용 옵션 제한, 선택/viewer/runtime 전환, 해제된 ownership, import 실패 재시도를 포함한다.

재현 명령(Node 22, 설치된 의존성 필요):

```sh
git show 372c6a9930f0fe673433cbce90bb586ff9b33ead:src/features/tasks/ops-task-workspace.tsx > /tmp/registration-workspace-before.tsx
node --experimental-strip-types scripts/measure-registration-observation-editor-load.mjs /tmp/registration-workspace-before.tsx /tmp/registration-preload-before.json
node --experimental-strip-types scripts/measure-registration-observation-editor-load.mjs src/features/tasks/ops-task-workspace.tsx /tmp/registration-preload-after.json
node --test --experimental-strip-types tests/registration-lazy-editor-loading.test.mjs
```

## 운영 표본과의 관계

별도 담당의 2026-10-11 04:33–04:37 UTC 운영 표본에서 완료 목록 RPC는 4.587초, 일반 등록 상세 표시는 최초 2.837초/재방문 0.118초였다. 재방문 뒤에도 최대 2.552초의 후속 조회가 이어졌다. 이는 운영 전후 비교가 아니며 상세 표시는 최신 조회 완료를 뜻하지 않는다.

이번 후보는 **청강 상세 직접 링크의 최초 모듈 로딩**만 다룬다. 해당 운영 표본은 이 경로 또는 cold module 조건을 확인하지 않았으므로 운영 2.837초의 원인이나 개선율로 연결할 수 없다. 완료 목록 RPC, 느린 상세 데이터 요청, 같은 이름의 manager RPC 3건은 이번 변경으로 빨라지거나 합쳐지지 않는다. 운영 요청 본문을 수집하지 않았으므로 동일 인자 중복도 확정할 수 없다.

운영 적용에는 후속 배포와 해당 경로의 실제 검증이 필요하다. 이 작업은 후보 준비이며 운영 배포를 수행하지 않는다. 전체 merge gate와 실제 UI 검증을 별도로 충족해야 한다.
