# 등록 연락처 생명주기 순수 모듈

기준 main: `6a6d7abe4f45e366beccc14efbbcce0534f0370f`. 구현 파일은 `src/features/tasks/registration-contact-lifecycle.ts`, 합성 테스트는 `tests/registration-contact-lifecycle.test.mjs`다. 이 모듈은 아직 production 화면·RPC·DB·provider consumer에 연결되지 않았다. 외부 전송, DB enum·schema 변경, 연락처 삭제 실행, 저장소 cache 제거를 자체 수행하지 않는다.

## 공개 API

- `getRegistrationContactCaseClosure({ tracks, explicitWholeCancelled? })` → `{ allPhasesClosed, reason, currentTrackIds }`. 모든 현재 과목이 `registered / not_registered / inquiry_only`일 때 전체 종결이다. 선택된 완료 tab이나 일부 과목 완료로 종결하지 않는다. `archivedAt`이 있는 과목은 현재 과목에서 제외한다. 현재 과목 0개는 자동 종결이 아니며 `no_current_tracks / false`다. 명시적 전체 취소는 종결이다.
- `createRegistrationContactLifecycle({ caseId, tracks, studentId?, business, freshParentContact? })`는 revision/generation `"1"`의 open 상태를 만든다. 새 연락처는 `{ source: "user_input", parentPhone }`만 허용하며 학생 전화 수집은 지원하지 않는다.
- `applyRegistrationContactLifecycleTransition(state, command, request)` → `{ state, receipt, replayed, effects }`. 명령은 `close`, `replace_tracks`, `reopen`, `edit_contact`, `bind_student`다. generation/revision은 JavaScript Number 변환 없이 정확히 증가하는 canonical 양수 PostgreSQL bigint decimal string이다. 상한은 `9223372036854775807`이며 발송 정책 모듈과 같다.
- `clearRegistrationTemporaryContactFields(record)`는 존재하는 `parentPhone / studentPhone / parent_phone / student_phone` 슬롯만 null로 바꾼 사본을 반환한다. 없는 필드를 추가하지 않는다. UUID·화면 uid·외부 studNo·메모·수업·시수·정산 배열은 유지한다. 학생 master snake/camel contact 필드는 별도 owner 구현이며 이 함수 대상이 아니다.

## 종결·재개·제외

`close`는 전체 현재 과목 종결 또는 명시적 전체 취소를 확인한다. 종결하면 임시 부모 전화와 legacy 학생 전화만 null로 만들고 학생 UUID와 business object/배열은 유지한다. 다른 requestKey로 이미 닫힌 세대를 다시 닫을 수 없다.

`replace_tracks`는 기존 track ID를 완전히 버리지 못하며 history를 archived track으로 보존해야 한다. 현재 과목이 없어지는 경우 `closeWhenLastTrackExcluded: true`와 실제 이전 current track이 필요하다. 명시적 guard가 없으면 전이를 거절한다. 남은 현재 과목이 모두 종결이면 case를 닫는다. 제외·종결·재개가 자동 안내 재전송을 유발하지 않도록 effects는 언제나 `shouldSendNotice: false / suppressLegacyStageResend: true`다.

`reopen`은 closed case에만 허용된다. 실제 현재 미종결 과목을 요구하며 generation을 증가시킨다. 이전 부모·학생 원문을 회수하지 않는다. 새 사용자 입력을 생략하면 부모 전화는 null이다. legacy cache 등 source나 학생 전화 추가 필드가 붙은 freshContact는 거절한다. 효과의 `invalidateContactDraft`는 consumer가 이전 화면 초안을 지워야 한다는 명령 의도이며 실제 browser storage 삭제가 아니다.

## 재시도·충돌·식별자

request에는 `actorId`, exact `requestKey`, `{ version: 1, digest: 64자리 lowercase hex }` fingerprint와 `expectedRevision / expectedGeneration`이 필요하다. **인증된 controller가 case/actor/key/명령/expected generation/revision/연락처 등 전체 요청의 canonical keyed HMAC를 계산·검증해야 한다.** 모듈은 키를 생성하거나 raw 요청을 hash하지 않는다. fingerprint 문자열 shape만 확인하므로 호출자가 임의 digest를 신뢰 입력으로 만들면 이 계약이 성립하지 않는다. 요청 key는 전화 원문 등 개인정보를 담지 않는 opaque key여야 한다.

같은 actor/key/digest의 exact replay는 stale guard보다 먼저 기존 receipt를 반환한다. 더 나중의 current state를 되돌리지 않으며 과거 전화 원문을 되살리지 않는다. key 재사용과 다른 digest는 충돌이고 새 요청의 오래된 generation/revision은 거절된다. 이 pure 함수는 DB 원자성/잠금을 제공하지 않는다. 실제 controller·RPC는 같은 case 상태·revision·generation·receipt를 한 원자적 변경으로 직렬화하고 ACL/RLS를 보존해야 한다.

상한을 넘는 state/request/receipt counter는 입력 단계에서 거절한다. 새 쓰기가 최댓값 counter를 증가시키려 하면 연락처·track 상태를 새로 계산하기 전에 `registration_contact_revision_overflow` 또는 `registration_contact_generation_overflow` 업무 오류로 거절한다. 원래 state/UUID/business 배열과 receipt는 바뀌지 않는다. 최댓값에서 exact replay는 증가 없이 기존 결과만 반환할 수 있다. 이 오류는 DB concurrency 충돌이나 SQLSTATE `40001`이 아니다.

receipt는 actor/key/fingerprint와 revision/generation/phase/closure reason/연락처 존재 여부/학생 UUID 결과 metadata만 담는다. 전화 원문·requestNote·business payload는 담지 않는다. event·DB audit 사본 생성 중단은 별도 SQL owner의 계약이며 이 모듈 성공만으로 해결됐다고 볼 수 없다.

저장된 receipt에 원문 필드가 끼어 있거나 동일 actor/key receipt가 둘 이상이면 재실행을 거절한다. arbitrary 첫 receipt를 고르거나 기존 raw payload를 그대로 반환하지 않는다.

`bind_student`는 내부 UUID만 받으며 기존 UUID를 다른 학생으로 바꿀 수 없다. 표시 uid와 외부 opaque studNo는 business에 별도로 보존된다. phone equality나 외부 URL locator를 UUID로 추론하지 않는다.

## 연결 경계와 검증

발송의 목적 allowlist, pending/claimed pre-attempt 취소, attempt-started/accepted/unknown reconciliation 및 재전송 금지는 별도 `registration-contact-message-policy.ts` consumer 담당이다. policy 소비자는 persisted lifecycle generation/phase와 closure 판정을 신뢰할 수 있도록 원래 상태를 검증해야 한다. 기존 provider attempt marker 이후 unsend가 가능하다는 의미가 아니다.

현재 구현은 합성 Node 순수 테스트만 검증했다. SQL/RPC/controller/현재 UI·브라우저 cache·provider와의 통합, 기존 역사 event/receipt/audit/free text/backup 원문 파기는 별도 작업이다. 등록 종결 뒤 임시 연락처를 제거하며 추가 일괄 보관 기간을 도입하지 않는다. 수업·시수·정산 업무 기록은 보존한다.

검증 결과: lifecycle 합성 **33/33**, 발송 정책 합성 **24/24**, 함께 실행한 **57/57 통과**. 두 모듈의 개별 strict TypeScript 검사와 본인 module/test ESLint도 통과했다. cached Node로 `node --test --experimental-strip-types tests/registration-contact-lifecycle.test.mjs tests/registration-contact-message-policy.test.mjs`를 실행했다. 최댓값 revision의 close/reopen/bind/edit/track 전이, 최댓값 generation reopen, 마지막 유효 증가와 exact replay, state/request/receipt와 실제 정책 소비자의 too-large 입력 거절을 검증했다. 전체 production 통합 검증이나 SQL 런타임 검증 결과가 아니다.
