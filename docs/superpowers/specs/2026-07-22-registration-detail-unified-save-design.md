# 등록 상세 단일 저장·중복 제거·공통 UI 설계

**작성일:** 2026-07-22
**상태:** 승인
**범위:** 저장된 등록신청서 상세 모달과 해당 DB mutation

## 1. 변경 목적

신규 등록 신청서는 한 번의 입력 흐름으로 정리되어 있지만 저장된 신청서 상세는 과목과 공통 정보가 별도 저장되고, 섹션마다 동일한 담당자·상태·일시를 반복해서 보여 준다. 이번 변경은 저장된 신청서에서도 다음 행동이 한눈에 보이도록 정보와 저장 경계를 단순화한다.

1. 과목을 공통 정보의 일부로 편집하고 `저장` 한 번으로 원자 저장한다.
2. 상단 진행 스텝과 실제 편집 필드에 이미 있는 중복 요약을 제거한다.
3. 등록 상세 자손의 네이티브 옵션·확인·경고·접기 UI를 대시보드 공통 컴포넌트로 통일한다.
4. 과학 기본 상담 책임자를 김법균으로 설정하고, 삭제 RPC를 포함한 대기 migration을 안전하게 적용한다.

## 2. 단일 문의 정보 draft

- 저장된 신청서의 문의 섹션은 학생명, 학년, 학교, 연락처, 캠퍼스, 문의일시, 요청사항, 우선순위, 과목을 하나의 `RegistrationInquiryDraft`로 소유한다.
- 과목 선택 가능성은 저장된 학년이 아니라 현재 draft의 학년으로 계산한다.
- `과목 저장` 버튼을 제거하고 하단 `공통 정보 저장`을 `저장`으로 바꾼다.
- 공통 정보와 과목 중 하나만 바뀌어도 동일한 dirty-close guard가 작동한다.
- 충돌 시 사용자가 입력한 공통 필드와 과목을 모두 보존하고 최신 값과 비교한다.
- 저장 성공 뒤 새로고침만 실패하면 커밋 성공을 유지하고 기존 복구 UI로 최신 내용을 다시 불러온다.

## 3. 원자 DB mutation

신규 공개 RPC `save_registration_case_inquiry_v1`은 다음 입력을 받는다.

- 전체 공통 정보
- 최종 과목 배열
- `expectedCommonRevision`
- `expectedSubjects`
- `requestKey`

RPC는 알림 전역 advisory lock, task workflow lock, task/detail/tracks row lock 순서를 기존 등록 알림 mutation과 동일하게 유지한다. 현재 revision과 과목 집합을 확인하고 최종 학년·과목 조합, 과목 제거 가능성, 학생 identity freeze를 모두 검증한 뒤 한 트랜잭션에서 변경한다. 어느 검증이나 쓰기라도 실패하면 공통 정보, 과목, revision, event, reminder가 모두 롤백된다.

- 과학은 고1~고3에서만 최종 과목으로 허용한다.
- capability 검사는 새로 추가되는 과목에 적용한다. 기존 과학 capability가 꺼져도 과학을 유지한 채 공통 정보만 수정할 수 있다.
- 진행 이력이나 수강 데이터가 있는 과목 제거는 기존 `registration_subject_removal_blocked` 계약을 유지한다.
- 학생명·연락처 변경은 기존 reminder 취소·revision 증가·재물질화 경로를 우회하지 않는다.
- 동일한 request key와 payload 재시도는 같은 응답을 반환하고, 다른 payload로 key를 재사용하면 거부한다.
- 기존 분리 RPC는 다른 관리 경로의 호환성을 위해 유지한다.

## 4. 중복 정보 제거

상단 과목 탭과 진행 스텝, 실제 편집 필드만 권위 있는 화면 정보로 남긴다.

- `RegistrationTrackSectionValues` 읽기 전용 요약을 제거한다.
- 프레임 내부의 `현재 진행 단계가 아닙니다` 문구를 제거한다.
- `RegistrationLevelTestSummary`, `RegistrationConsultationSummary`, `RegistrationPlacementSummary` 상단 요약 행을 제거한다.
- 자식 행동이 없는 비현재 프레임은 렌더링하지 않아 빈 테두리 상자를 없앤다.
- 담당자 선택, 예약 관리, 상담 결과, 등록·대기 전환처럼 실제 업무 행동은 유지한다.
- 새로운 설명 카드나 보조 요약 카드는 추가하지 않는다.

## 5. 공통 컴포넌트 전환

등록 상세 모달 아래에서만 다음 전환을 수행한다.

- 네이티브 `<select>`를 `@/components/ui/select` 기반 `RegistrationSelect`로 통일한다.
- 빈 선택은 내부 sentinel로 처리하되 외부 값 계약은 기존 빈 문자열을 유지한다.
- `window.confirm` 세 곳을 공통 `Dialog` 확인 흐름으로 교체한다.
- 직접 만든 amber 경고 상자는 `Alert`로 통일한다.
- native `details/summary`는 공통 `Collapsible`로 교체한다.
- Card를 추가로 중첩하지 않고 구분선과 간격으로 섹션 구조를 유지한다.

## 6. Migration 적용 경계

- 연결 대상은 Supabase 프로젝트 `tips dashboard` (`slnjqlzzhewblvttiidk`)이다.
- 원격/로컬 migration history가 어긋나 있으므로 `supabase db push`를 실행하지 않는다.
- 대기 중인 과학 책임자·삭제 RPC SQL과 신규 단일 저장 SQL만 `apply_migration`으로 개별 적용한다.
- 적용 직후 `list_migrations`에서 실제 생성된 version을 확인하고 로컬 파일명을 그 version에 맞춰 추가 drift를 만들지 않는다.
- 공개 함수는 `PUBLIC`과 `anon` 실행을 회수하고 필요한 role만 명시적으로 grant한다.
- 실제 삭제 동작은 이번 변경에서 실행하지 않는다.
- Google Chat, Web Push, SOLAPI와 등록 dispatch flag는 계속 비활성으로 유지한다.

## 7. 완료 조건

- 저장된 신청서 문의 섹션에 `과목 저장`과 `공통 정보 저장`이 없고 `저장`이 한 번만 보인다.
- 학년과 과학을 양방향으로 함께 바꿔도 원자 저장되며 실패 시 zero-write이다.
- 공통 revision과 과목 동시 편집 충돌을 모두 감지한다.
- 담당자·상태·일시가 같은 섹션에서 반복되지 않고 빈 테두리 프레임이 없다.
- 등록 상세의 옵션·확인·경고·접기 UI가 공통 컴포넌트를 사용한다.
- 과학 상담 기본 책임자가 김법균으로 저장되고 신규 통합 RPC ACL이 최소 권한이다.
- 단위·fixture·SQL·타입·lint·build·데스크톱/모바일 브라우저 QA가 통과한다.
- 검증 중 실제 공급자 호출은 0건이다.
