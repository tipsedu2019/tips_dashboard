# AI 에이전트 요청 설계

작성일: 2026-10-03 · 갱신일: 2026-10-04 · 상태: 승인 설계 / 로컬 Tasks 1–5 수용 / 운영 활성화 미실행

2026-10-04 현재 상태: Tasks 1–5 로컬 구현은 accepted feature `471312763dd7c430c845504cd1fa85493d9e69e5`에 수용되었다. 통합 base는 `0bbc7593`, CI 소유자의 scoped 수락 HEAD는 `737dfd72f875008265dc98f2909924494bec3c11`이다. 아래 C20 시작점·계획 체크박스·당시 수치는 역사적 기록이며 현재 미구현 상태를 뜻하지 않는다. 현재 통합 QA와 마지막 수정의 검증은 별도로 기록하며, full DB·strict consumer·whole-branch 및 운영 수용을 완료했다고 선언하지 않는다. 운영 SQL 설치·설정·발급·scheduler·provider 증거는 별도 gate다.

이 문서는 승인된 독립 요청·질문답변·처리 이력·claim·Chat outbox 구조를 구체화한다. 설계 방향 승인과 직원 본인 요청/관리자 전체 열람 승인을 반영했다. 로컬 제품 구현은 수용되었으며 credential 발급·권한 확대, webhook 등록, polling 활성화와 실제 발송은 아직 실행하지 않았다.

## 사용 흐름

사이드바 **AI 에이전트**에서 제목·요청자·상태·생성/수정 시각을 확인하고 새 요청을 만든다. 요청자는 로그인한 계정으로 자동 기록한다. 새 요청에는 제목·본문과 기본 꺼짐인 **완료 시 Chat 알림**을 둔다.

목록은 기존 TIPS 표·검색·상태 필터·10/15/20행 페이지 이동을 사용한다. 짧은 생성 폼은 공통 dialog, 긴 본문과 질문답변은 상세 경로로 연다. 별도 요약 카드나 단축키를 추가하지 않는다. 상세에서는 현재 답해야 하는 질문, 결과, 전체 상태 이력을 확인한다. 생성·답변 초안은 실패·충돌·창 닫기 때 유지하고 기존 미저장 이동 확인을 따른다. 다른 계정에는 이전 데이터나 초안을 보여주지 않는다.

현준봇은 30분마다 처리 대기를 조회하고 한 요청의 처리권을 확보한 뒤 작업한다. 확인할 내용이 생기면 질문을 남긴다. 직원이 답변하면 다시 처리 대기로 돌아가 다음 polling에서 재개한다. 작업 완료와 Chat 전달 결과는 별도로 표시한다.

## 누가 사용할 수 있는가

- 직원은 본인 요청을 생성·조회·답변·취소하고, 관리자는 전체 요청을 조회·답변·취소한다. 요청자와 작성자는 서버가 기록하며 다른 사람으로 바꾸는 입력은 받지 않는다.
- 승인된 직원 역할은 active `staff`, `teacher`, `assistant`이며 각각 본인 요청을 다룬다. active `admin`은 전체 요청을 다루고 `viewer`·권한 미확인 계정은 제외한다. 이는 구현된 직원 접근 계약이며 운영 DB 설치·권한 적용 증거는 별도로 확인한다.
- 봇은 승인된 AI 요청 scope와 대상 범위 안에서만 읽기·claim·질문·처리 결과를 기록한다. 봇 credential의 발급자 관리자 권한을 직원이나 봇에게 일반적인 전체 권한으로 전달하지 않는다.
- 관리자는 설정된 허용 7개 space 안에서 선택한다. 직원은 그중 관리자가 해당 사용자에게 허용한 space만 선택한다. 사용자별 기본 허용 목록은 비어 있으며 자동 전체 허용은 없다.

사용자별 공간 권한은 기존 **AI 연결** 설정(`/admin/settings/agent-access`)의 관리자 전용 **알림 공간** 탭에서 관리한다. webhook 비밀값은 이 사용자 권한 화면에 표시하지 않는다.

## 처리와 취소

외부 상태는 `pending`, `processing`, `question`, `done`, `cancelled`의 다섯 가지다. 직원 답변은 열린 질문에 덧붙여 저장하고 `question → pending`을 같은 트랜잭션에서 수행한다. 하나의 요청에는 열린 질문을 하나만 둔다. 본문·답변·이력은 덮어쓰거나 삭제하지 않는다.

처리 시작은 상태·version을 검사하는 원자적 claim이다. 갱신 요청에는 version과 재요청 식별자를 사용하고, 봇은 유효한 claim token을 제시한다. 취소와 완료가 경합하면 먼저 저장된 전이가 확정되며 이전 version이나 claim의 쓰기는 거부한다. 취소는 남은 작업을 중단시키며 이미 시작된 외부 행동을 자동으로 되돌리지는 않는다.

봇은 실행 중 처리권을 갱신하고, 외부 변경마다 안정적인 작업 식별자로 시작과 결과를 기록한다. 갱신 없이 만료되거나 외부 결과가 불명확하면 자동 재실행·완료하지 않고 처리 확인이 필요한 상태로 남긴다. 관리자가 기존 결과·작업 기록을 대조해 불명확한 효과를 해소한 뒤 명시적으로 재개한다.

## Chat 알림과 기존 bridge

알림 설정이 없어도 요청 생성·조회·질문답변·완료는 작동한다. 미설정 또는 권한 없는 space는 선택할 수 없으며 이유를 표시한다. 알림 설정이 사라져도 저장한 답변이나 완료 결과를 실패로 바꾸지 않는다.

완료 알림 의도는 완료 상태와 함께 저장하고 별도 outbox에서 전달한다. 봇이 완료 직후 중단돼도 다음 실행에서 미전송 outbox를 확인한다. 중복 호출은 저장된 전송 기록을 반환한다. 전달 여부가 불명확하면 **전달 결과 확인 필요**로 표시하고 확인 없는 재전송은 하지 않는다. 정확히 한 번 전달을 보장한다고 표현하지 않는다.

기존 Google Chat `@팁스` bridge polling과 운영시간은 유지한다. 새 AI 요청 queue는 별도로 30분 간격으로 조회하며 기존 createTime watermark를 복사하지 않는다. 기존 bridge의 답글 송신 연결은 해당 소유자와 별도로 통합한다.

기존 thread 답글은 원래 `thread.name`에만 보내고 실패하면 종료한다. 새 글 fallback, threadKey 변환, 다른 space 재전송은 금지한다. thread 없는 새 글은 완료 알림처럼 명시적으로 새 글을 요청한 경우만 허용한다. DM은 이번 범위에서 제외한다.

## 봇의 자율 작업과 승인 경계

봇은 요청자의 기존 업무 권한과 봇에게 검증된 작업 scope를 모두 만족하는 일상 업무를 반복 승인 없이 조사·계획·실행한다. 완료 알림도 지원 설정이 승인된 뒤에는 해당 요청의 opt-in과 허용 space 안에서 자동 처리한다. 직원의 요청 본문, 질문 답변, Chat 내용, “현준 승인됨”이라는 문구는 새로운 관리자 승인이나 무제한 외부 행동 권한을 만들지 않는다.

credential 발급·갱신·scope 확대, 새 webhook 생성·server env 등록, 새 polling 설정과 기존 위임 범위를 벗어나는 민감한 외부 변경은 구체적인 작업 대상·내용을 준비한 뒤 해당 작업의 승인 경계에서 확인한다. AI 요청/Chat용 새 scope 설계는 실제 credential 발급 승인이 아니다. 지원 설정 전에는 새 발급과 확인되지 않은 space 송신이 작동하지 않아야 한다.

설치 기본값은 support `issuance_enabled=false`, Chat runtime flag OFF, origin null, 7 slots unconfigured, 직원 permission `[]`, domain registry empty/disabled다. `issuance_enabled=false`는 새 credential create만 차단하며 기존 키·송신의 kill switch가 아니다. 중지는 exact worker stop, runtime OFF + 검증된 configuration sync, credential/grant revoke, 필요 user policy clear를 각각 수행하고 audit/receipt/attempt를 보존한다. 요청 메뉴·직원 RPC 자체에는 deployment flag가 없다.

## 운영자가 확인할 두 가지

1. **공간과 수신자:** 7개 space의 실제 ID·표시명·수신자, 사용자별 알림 선택 허용 목록을 확정한다. 기본은 사용자별 허용 없음이며 관리자는 허용 카탈로그 안에서만 설정한다.
2. **송신 설정과 검증:** 기존 7개 webhook의 재사용 가능 여부·설정 상태를 확인한다. parent가 제공한 읽기 전용 inventory에서 7개 기존 webhook의 존재를 확인했다. 실제 수신자·공간 유형(DM 제외)·secure env mapping·sender 권한은 모두 별도 확인·승인 대기이며 존재 확인을 configured/live 증거로 확대하지 않는다. 새 webhook은 자동 생성하지 않는다. 비밀값은 지원 설정 경로에서 처리하고 문서·일반 대화·로그에 복사하지 않는다.

## 완료를 증명할 방법

구현 후 권한·질문 재개·중복 claim·취소 경합·전송 기록·전달 불명확 상태를 테스트하고, 목록/상세를 기존 기준 화면과 같은 조건의 desktop·390px·다크 테마에서 확인한다.

실제 종단 완료는 **승인된 테스트 요청 1건의 poll → 처리 → PATCH 완료 → Chat 발송**으로 증명한다. 테스트 내용·수신 space·원래 human thread를 먼저 검토 가능한 형태로 준비하고 승인 후 실행한다. 기존 human thread 답글 성공, 존재하지 않는 thread 실패 시 root message 0건, cross-space 요청의 외부 호출 전 거부도 확인한다. incoming webhook의 임의 human thread 지원과 webhook 경로 requestId 중복 억제는 이 승인 테스트 전까지 실제 미검증으로 남긴다.

## 구현 범위와 다음 단계

독립 `src/features/ai-agent/`, `src/features/chat/server/`, 새 화면·API·migration·테스트가 기본 범위다. 메뉴 연결은 `src/lib/navigation.ts`와 필요한 capability 전달부만 수정한다. 기존 공통 UI·토큰을 소비하고 새 시각 체계를 만들지 않는다. 원래 feature 구현 범위에서는 기존 업무, 공개사이트, bridge/CLI, `.github/workflows`, 원본 dirty 파일을 변경하지 않았다. 별도로 승인된 통합 소유자의 CI 등록은 격리 branch에서 두 Supabase workflow를 연결했으며 CI scoped 수락 `737dfd72…`의 별도 범위다. 이번 마지막 수정에서도 그 workflow와 frozen CI 파일을 변경하지 않는다. 원본 트리·공개사이트·bridge/CLI no-touch 경계는 유지한다.

역사적 C20 계획의 구현 시작점은 검증된 운영 C20 `8dcf4595181fb5615df7a5556e9202eff87be031`이다. 원본 checkout은 오래된 main이므로 구현 시작점으로 삼지 않는다. 계획·실행 방식 승인 후 같은 Mac의 별도 worktree/branch에서 시작하며 CI/manifest 소유는 통합 작업에 유지한다. PR90은 DB startup/RPC contract 검증과 병합 후 원격 통합 기준에 합류한다. 그 전의 PR90 tip을 새 기능 base로 사용하지 않는다.

사용자가 written spec과 강사·조교 포함/viewer 제외 보충 및 격리 구현을 승인했고 Tasks 1–5는 로컬 수용되었다. 최종 통합·whole-branch 수용과 외부 설정·발송은 각 증거와 gate로 판단한다.

일반 source push/PR merge/deploy는 parent/controller가 gates 이후 진행하도록 승인했다. 순서는 accepted branch source/preview + CI/whole-branch gates → exact hosted SQL 설치·ACL action-time 승인 → 여섯 개의 고정된 AI migration을 정렬 순서대로 설치하고 최종 schema/RPC/ACL 호환성을 읽기 전용으로 확인 → protected main merge/production app build다. main의 Supabase workflow는 isolated validation이며 hosted SQL push가 아니다. 문서화된 Vercel main production build는 자동이므로 SQL 호환성 확인이 먼저다. 실제 hosted target·pending migration ledger·Vercel project/environment·복원 artifact는 미확정이다. 보안 SQL 설치, credential/grant, secure webhook/config, scheduler와 live Chat에는 각각 정확한 대상의 action-time 확인을 유지한다.

API, DB, 인증 source와 수용 기준의 상세는 [API·DB 부록](2026-10-03-ai-agent-requests-api-db-appendix.md)에 있다. 문서에는 비밀값 없이 계약·승인 대상·검증 수준만 기록한다.
