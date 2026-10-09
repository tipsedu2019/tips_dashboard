# 등록 자동 이력 JSON 제목 수정 — 배포 대기

기준은 2026-10-09 두 차례 원격 확인한 main `dda225e41543ddca2e1f4587ae6098b255c5a92c`다. 기존 checkout의 변경을 보존하고 별도 bare 저장소/worktree에서 작업했다. 열린 PR과 PR96의 실제 diff를 확인했으며 같은 수정은 없다. PR96의 등록 간소화, 이력 정렬·상태 문구·SQL은 포함하지 않았다.

## 원인과 범위

최종 `dashboard_private.create_registration_case_impl` 정의인 `20260901110700_registration_flat_case_creation.sql`은 `registration_case_created`의 `after_value`에 v1 객체를 기록한다. 여기에는 감사 필드 `actorId`, `occurredAt`과 학생 snapshot이 함께 들어간다. 화면의 `mapTrackEvent`는 `registration_track_event`만 파싱하므로 이 직접 생성 이벤트를 `legacyText`로 넘겼고, 이력 빌더가 이를 제목으로 표시하면서 작성자/시각을 migration fallback으로 버렸다.

- 직접 생성 v1 계약에서 감사 필드만 읽고 제목은 기존 `등록 문의 생성`을 사용한다. snapshot의 이름·campus·임의 metadata는 표시 모델로 복사하지 않는다.
- 완전한 시각과 시간대, 달력 유효성을 확인한다. 없는 시각/작성자를 `created_at`, 현재 담당자나 현재 시각으로 채우지 않는다. 미지원·손상 생성 이벤트도 작성자는 `알 수 없음`으로 둔다.
- 구형 serialized JSON 및 명확한 손상 JSON은 안전한 작업명으로 대체한다. `[전화상담] ...`, 인용문을 포함한 구형 자유문장은 보존한다.
- 기존 v1/v2 track 이벤트, 알림 내부 이벤트 제외, 공통 `Button`/`Popover`/`Collapsible`, 이력 조회의 무쓰기 동작을 유지한다. 비교 기준은 같은 합성 이력의 기존 등록 popover다. 공유 스타일 변경은 없다.

실제 운영 레코드는 조회·수정·복사하지 않았다. 이 문서는 SQL 생산자와 합성 wire로 확인한 코드 원인을 설명하며, 신고된 운영 레코드의 원문 검사를 주장하지 않는다.

## 검증 결과

아래 로컬 검증과 독립 리뷰의 구현 커밋은 `0d766803efdba5540166050c6af70695652fd789`다. 후속 인계 문서 변경은 이 구현 커밋 위에 추가하며 게시된 이력을 다시 쓰지 않는다. 후속 head의 제품 코드·테스트·검증 스크립트가 이 커밋과 같은지 별도로 비교한다. 문서 수정만으로 기존 검증이 새로 실행됐다고 주장하지 않는다.

| 검사 | 결과 |
| --- | --- |
| 수정 전 합성 회귀 | 새 핵심 테스트 3건 실패로 결함 재현 |
| 등록 Node 회귀 + ops workspace | 1,617 통과 / 실패·skip 0 |
| 공통 디자인 계약 | 63 통과 |
| 독립 표적 재검증 | 124 통과, 차단 finding 없음 |
| TypeScript | `tsc --noEmit --incremental false` 통과 |
| ESLint | 오류 0, 미수정 파일의 기존 경고 7 |
| Production build | Next 16.1.1 webpack build 통과, 합성 loopback public env 사용 |
| 실제 parser → 실제 React 컴포넌트 합성 UI | 전후 × 1440/390px × light/dark = 8건 통과 |

브라우저 검증은 `scripts/qa/registration-history-browser.mjs`로 재실행할 수 있다. 빌드를 먼저 마친 다음 기존 설치의 `PLAYWRIGHT_PACKAGE`, `ESBUILD_PACKAGE`를 지정한다. 별도 headless Chromium과 새 context를 사용하며 모든 응답을 메모리로 제공한다. 실제 서버, 로그인, DB, provider, 사용자 Chrome 프로필/탭은 사용하지 않는다. source baseline 비교는 `QA_BASE_REF`로 고정된다.

UI 검증은 정상 생성/정상 v2/구형 문장/손상 JSON/미지원 버전/null, 상세 전부 열기, Escape 초점 복귀와 세 번 재열기, 외부 클릭 닫기, form submit 0, 열린 상태의 가로 넘침 0, 외부 요청·페이지 오류 0을 확인했다. 화면 결과는 `output/playwright/registration-history/{before,after}-{1440,390}-{light,dark}.png`, 실행 결과는 같은 디렉터리 `results.json`에 보존한다. 정상 이력·빈 이력·알림 내부 이벤트 제외는 기존 DOM/Node 회귀에도 포함된다. 운영 인증 route acceptance를 대신하지 않는다.

로컬 Node 24.19.0을 사용했다. 앱 번들 Node 24.21.0의 네이티브 모듈 서명 제한으로 첫 build가 실패한 기록을 남겼고, 기존 캐시 Node로 최종 소스 build를 통과했다. 등록 전체 glob의 최초 sandbox 실행에서는 loopback EPERM과 새 테스트 기대값 오류가 발생했다. 기대값을 고치고 로컬 포트 할당이 가능한 환경에서 Node suite를 재실행했다.

### 제외한 실제 DB 테스트 2건과 직접 검증 범위

`tests/registration-observation-google-chat-provider-zero.test.mjs`의 다음 두 테스트는 최종 Node 실행 목록에서 제외했다.

| 테스트 | 실제 검증 대상 |
| --- | --- |
| `provider-zero runner stages the adapter package before the real core receipt` | 청강 Google Chat 어댑터, readiness·activation·heartbeat와 실제 core receipt의 실행 순서 |
| `provider-zero runner commits the scheduled and paired feedback lifecycle without a provider` | 예약/피드백 알림의 Google Chat 준비 경계와 인앱 처리 수명주기 |

두 테스트는 `--execute --approved-local-db`로 별도의 로컬 Supabase 프로젝트와 포트를 준비하고, 실제 DB 컨테이너 시작·migration 초기화·SQL/pgTAP 실행·자기 소유 자원 정리를 수행한다. 운영 DB를 쓰는 테스트라는 뜻은 아니며 실제 외부 provider 발송도 차단하는 설계다. 최초 전체 glob 실행은 loopback 포트 확보 단계의 `EPERM`으로 중단되어 DB 시작·SQL assertions에 도달하지 않았다. 이후 제품 변경이 없는 DB/알림 수명주기 실행까지 이번 표시 수정의 범위를 넓히지 않고 해당 파일을 제외했다. 기존 컨테이너를 중단하거나 초기화하지 않았다.

제외한 2건은 통과나 테스트 runner의 skip 수로 계산하지 않는다. 위 1,617건은 최종적으로 선택해 실제 실행한 Node 검사의 수다. DB 수명주기 자체는 미검증으로 남으며, SQL DB suite와 전체 Linux/Node22 GitHub workflow가 통과한 것으로 대체하지 않는다.

이번 수정에 직접 필요한 근거는 현재 SQL 생산자의 합성 이벤트 형식을 실제 파서와 이력 빌더에 넣어 수정 전 실패를 재현한 검사, 정상 v1/v2와 구형·손상·null 기록 회귀, 그리고 같은 parser 출력으로 실제 React popover를 여닫은 8건의 브라우저 검사다. 작성자·시각의 누락과 잘못된 날짜, 정보 노출 방지, 구형 문장 보존도 포함한다. 제품 변경은 표시용 parser와 history builder이며 DB/RPC·migration·알림 실행 코드는 변경하지 않았다. 이 근거는 이 표시 수정의 로컬 동작을 확인하며, 실제 운영 레코드나 제외한 알림 DB 수명주기의 검증을 대신하지 않는다.

독립 리뷰에서 부분 날짜의 보정과 대괄호 문장 소실을 지적받아 수정하고 경계값 회귀를 추가했다. 재검토된 제품 파일 SHA-256:

```text
registration-track-service.ts 65d809199811eb34e753718465268b2c9b1edb68de0375a9645950e58cc0585c
registration-track-history.js a0ba22b6a4e9ff5d76f04ea3c86fa2040bd32d080a06eab2f483c647e32eee5a
```

## 남은 릴리스 단계

1. Draft PR의 정확한 head/base와 필수 GitHub 검사 상태를 확인한다. billing 때문에 시작하지 못한 검사도 미실행이며 통과가 아니다. 로컬 증거는 별도로 보존한다.
2. 부모 작업이 현재 Chat 활성화 배포와 조율하여 검토·merge/app release를 결정한다. 이 변경에는 SQL 적용이 필요 없다. PR96이 먼저 바뀌면 겹치는 이력/서비스 파일을 최신 base에서 재검증한다.
3. 실제 배포 SHA를 확인하고 독립 담당이 운영 등록 신청 → 자동 이력 보기에서 안전한 제목, 기록된 작성자/시각, unknown fallback 및 반복/닫기를 재검증한다. 운영 원시 JSON을 증거로 복사하지 않는다.

구현 커밋의 GitHub 필수 검사 세 개는 결제/spending 제한으로 시작되지 않았고, Vercel은 `Deployment was blocked`만 보고했다. 공개 체크/링크만으로 세부 차단 원인은 확인하지 못했다. 후속 head에서는 GitHub 계정 매핑과 실제 preview 상태를 다시 읽되, 결과 변화만 기록하고 이메일을 원인으로 단정하지 않는다. Preview 성공 여부와 운영 배포 완료는 별개이며, 부모가 진행 중인 관리팀 Chat 환경설정 저장과 중복되는 운영 배포를 실행하지 않는다.

병합·수동 배포·운영 SQL·학생/직원 write·발송·새 credential/권한 변경은 수행하지 않는다. 배포와 운영 UI 재검증 전에는 최종 완료로 판단하지 않는다.
