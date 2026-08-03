# 대시보드·Google Chat 자기완결형 알림 콘텐츠 설계

**작성일:** 2026-08-03
**상태:** 사용자 설계 승인 반영 · 서면 검토 대기
**대상:** TIPS Dashboard 알림 제어면, 대시보드 알림, Google Chat 알림

## 1. 목표

대시보드 알림이나 Google Chat 메시지만 읽어도 링크를 누르지 않고 다음 내용을 정확히 알 수 있게 한다.

1. 누구 또는 어느 수업에 관한 알림인지
2. 무엇이 새로 생기거나 바뀌었는지
3. 날짜·시간·장소·결과처럼 업무 판단에 필요한 핵심 사실이 무엇인지
4. 현재 어느 단계이며 누구 또는 어느 팀의 처리를 기다리는지
5. 긴 원문이나 첨부자료가 별도로 있는지

알림은 자연스럽고 친절한 구어체로 작성한다. 이모지는 상태를 보조하는 용도로 제목에 하나만 쓰고, 본문은 `[수업]`, `[변경]`, `[진행]` 같은 짧은 라벨로 빠르게 훑을 수 있게 한다.

이 작업에서 제공하는 문구는 고정된 코드 문장이 아니라 알림 설정 화면에서 계속 수정하고 저장할 수 있는 **시스템 권장 기본 템플릿**이다. 운영자가 이모지, 라벨, 문장 끝맺음, 정보 순서를 조금씩 바꿔 사용할 수 있어야 한다.

## 2. 승인된 운영 조건

### 2.1 Google Chat은 팀별 단체방만 사용한다

Google Chat 연결은 다음 다섯 팀 단체방이다.

- 관리팀
- 경영팀
- 영어팀
- 수학팀
- 과학팀

다섯 방은 가능한 연결 대상 목록이며, 한 알림을 다섯 방에 모두 보내라는 뜻이 아니다. 각 event는 현재 저장된 rule과 audience에 해당하는 방에만 전달된다.

한 방 안에서 특정 사람에게만 다른 문장을 보여줄 수 있다고 가정하지 않는다. 따라서 `[다음] 확인해 주세요`처럼 현재 메시지를 읽는 사람에게 직접 지시하는 문장은 기본 템플릿에서 사용하지 않는다.

대신 모든 방 구성원이 업무 소유권과 현재 단계를 알 수 있는 중립적인 진행 문장을 사용한다.

```text
[진행] 김철수님의 결재를 기다리고 있어요.
[진행] 담당 결재자의 확인을 기다리고 있어요.
[진행] 관리팀의 등록 내용 확인을 기다리고 있어요.
[진행] 영어팀의 보강 일정 조율을 기다리고 있어요.
```

사람 이름이 있으면 `김철수님`, 없으면 `담당 결재자`, `관리팀`처럼 항상 읽을 수 있는 `{진행주체}` 값을 만든다. 기본 템플릿은 `{진행주체}`를 이용하므로 운영자가 다음처럼 문구를 바꿀 수 있다.

```text
[진행] {진행주체}의 결재를 기다리고 있어요.
[결재 상태] {진행주체}의 확인을 기다리고 있어요.
```

진행 상태 문장의 조사와 말투는 template에 남긴다. 기본 템플릿의 핵심 상태 문장을 코드나 Google Chat provider에 하드코딩하지 않는다.

### 2.2 대시보드도 개인화 지시에 의존하지 않는다

인앱 알림은 개인별 projection이더라도 Google Chat과 같은 중립적인 상태 표현을 기본값으로 사용한다. 채널별 템플릿은 기존 규칙 단위로 따로 편집할 수 있지만, “현재 보고 있는 사람이 처리 담당자일 것”이라고 추측해 문구를 만들지 않는다.

### 2.3 활성화와 전송 범위는 바꾸지 않는다

- 현재 비활성인 할 일, 영어 단어 재시험, 전자결재 규칙에도 권장 기본 템플릿은 마련하지만 규칙을 자동으로 켜지 않는다.
- 새 Google Chat 방, 새 audience, 새 알림 rule을 콘텐츠 변경을 이유로 만들지 않는다.
- Web Push 설정·구독·활성화·전송 QA와 고객 문자(SOLAPI)는 이번 범위에서 제외한다. 다만 현재 Web Push가 `in_app` title/body를 상속하므로 활성 구독이 있다면 문구까지 함께 바뀔 수 있다. 운영 전환 preflight에서 활성 Push 경로가 확인되면 별도 승인이나 콘텐츠 분리 없이 in-app 권장본을 활성화하지 않는다.
- 로컬 테스트와 자동 QA에서는 실제 Google Chat 메시지를 보내지 않는다.
- 운영 DB 적용, rule 활성화, dispatch owner 전환, Git push, Vercel Production 배포는 각각 별도 승인 경계로 남긴다.

## 3. 확인된 현재 구조와 문제

### 3.1 현재 구조

- 공통 알림 제어면은 `tasks`, `word_retests`, `registration`, `transfer`, `withdrawal`, `makeup_requests`, `approvals` 일곱 workflow를 가진다.
- rule은 event, channel, audience, variant 단위로 title/body template과 허용 변수를 가진다.
- 운영자가 설정 화면의 `내용 수정` 대화상자에서 제목과 본문을 바꾸고 저장하면 새 template version이 추가되고 rule의 active template이 갱신된다.
- Google Chat은 공통 provider가 렌더링된 제목·본문에 전체 앱 URL을 붙여 전송한다.
- 대시보드는 최종 렌더링된 title/body를 `dashboard_notifications` read model로 표시한다.

### 3.2 현재 문제

1. 할 일·영어 단어 재시험·전자결재 기본값은 `[업무] 이벤트`와 발생 시각·딥링크 중심이라 링크 없이는 내용을 판단하기 어렵다.
2. 세 workflow adapter의 `renderFields`가 비어 있어 원본 payload에 학생, 수업, 점수, 일정이 있어도 템플릿에서 쓸 수 없다.
3. 일부 등록·전반·퇴원·휴보강 경로는 전용 문구가 있지만 말투와 정보 순서가 서로 다르고, 담당 선생님을 신청자로 오해할 수 있는 문장이 있다.
4. 다과목 학생의 수강 제외를 학생 전체 퇴원처럼 표현할 위험이 있다.
5. 템플릿 본문에도 딥링크가 있고 provider도 링크를 붙이면 Google Chat에 링크가 중복될 수 있다.
6. 대시보드 팝오버는 고정 폭이고 본문 줄바꿈을 보존하지 않아 구조화된 여러 줄 메시지가 한 덩어리로 보일 수 있다.
7. canonical TypeScript renderer와 legacy SQL projection이 함께 남아 있어 한쪽만 고치면 채널별 문구가 다시 갈라질 수 있다.
8. 댓글·사유 같은 자유 입력을 그대로 넣으면 긴 메시지, 전화번호 노출, URL·전체 멘션·HTML 때문에 전달 실패 또는 과다 노출이 생길 수 있다.

## 4. 범위와 커버리지 기준

### 4.1 포함

- 알림 설정 화면에 노출된 활성·비활성 rule의 시스템 기본 template
- 등록 예약 리마인더 rule
- 등록 전화상담·방문상담처럼 현재 설정 그리드에 숨겨진 고정 in-app/Google Chat rule의 콘텐츠 편집 노출
- canonical worker와 아직 실제 전달을 소유하는 legacy SQL projection의 출력 정합성
- canonical rule을 우회하는 것으로 확인된 애플리케이션 내부 direct dashboard projection의 inventory와 동일 콘텐츠 계약 적용
- 대시보드 알림 팝오버의 줄바꿈·폭·긴 문자열·접근성
- Google Chat provider가 만드는 최종 `{ text }` payload와 전체 URL 한 번 포함 여부
- 기존 `내용 수정 → 저장` 흐름과 저장 후 template version 전환

### 4.2 제외

- 과거에 전달된 알림 본문 재작성 또는 백필
- 과거 알림 재발송
- 규칙이 없는 event에 새 수신자나 새 channel을 임의로 추가
- 고객 문자 본문 변경
- Web Push 설정·구독·활성화·전송 QA. 현재 in-app 콘텐츠 상속으로 생길 수 있는 간접 문구 변경은 운영 전환 gate에서 차단하거나 별도 승인한다.
- 실제 Google Chat 테스트 메시지 또는 운영 메시지 전송
- 알림 template history를 보여주는 신규 UI
- AI 요약 또는 외부 요약 서비스
- `dashboard_notifications`의 광범위한 직접 INSERT 권한 폐쇄 같은 별도 보안 정책 개편. 다만 알려진 애플리케이션 producer는 manifest와 QA에 포함한다.

### 4.3 커버리지 manifest

manifest의 기본 identity는 `(workflow, event, channel, audience, variant)`다. 서로 겹치는 개념을 한 분류로 합치지 않고 각 identity에 다음 축을 독립적으로 기록한다.

| 축 | 허용 값 | 의미 |
| --- | --- | --- |
| `scope_state` | `in_scope`, `excluded_channel`, `no_rule_event` | 대시보드·Google Chat 콘텐츠 개편 대상인지, 고객 문자 등 제외 채널인지, rule 자체가 없는 event인지 |
| `configuration_kind` | `editable_rule`, `fixed_policy_editable_template`, `not_applicable` | 활성화 정책까지 편집 가능한지, 전달 정책은 고정하고 콘텐츠만 편집하는지 |
| `enabled_state` | `enabled`, `disabled`, `not_applicable` | 현재 저장된 활성 상태 |
| `dispatch_owner` | `canonical`, `legacy`, `none` | 실제 전달을 소유하는 경로 |

각 축에서 정확히 하나의 값만 가져야 한다. 예를 들어 활성 legacy rule은 `enabled + legacy`를 동시에 가지므로 소유권을 활성 상태 대신 사용하지 않는다.

승인 기준선에는 설정 event 8개(할 일), 10개(영어 단어 재시험), 9개(전자결재), 2개(전반), 2개(퇴원), 7개(휴보강), 등록 핵심 event 3개, 등록 예약 리마인더 9개 rule variant, 등록 전화상담 1개 고정 in-app rule, 방문상담 5개 event의 고정 in-app/관리팀 Chat rule을 명시한다. 레지스트리에는 있지만 이 목록에 rule이 없는 event와 고객 문자 전용 rule도 각각 `no_rule_event` 또는 `excluded_channel`로 명시한다.

manifest와 실제 레지스트리·rule seed를 양방향 비교한다. 예상 항목 누락뿐 아니라 승인되지 않은 새 rule, channel, audience, variant가 생겨도 테스트를 실패시킨다. 콘텐츠 개편이 새 전달을 몰래 활성화하거나 기존 event를 누락하지 않게 하기 위한 경계다.

## 5. 검토한 접근법

### 5.1 채택: workflow별 표현 context + 편집 가능한 versioned template

각 workflow가 원본 payload를 사람이 읽는 표시 값으로 변환하고, rule의 template이 문장과 정보 순서를 결정한다.

- adapter/presentation builder: 이름, 수업, 일정, 변경 전후, 결과, 진행 주체를 안전한 표시 값으로 만든다.
- template: 이모지, 라벨, 말투, 문장 순서를 결정하며 운영자가 계속 편집한다.
- renderer: template이 허용한 변수만 치환하고 미치환 token이나 안전하지 않은 결과를 차단한다.
- channel output: 대시보드는 여러 줄 본문을 그대로 표시하고 Google Chat provider는 링크를 한 번만 붙인다.

이 방식은 자기완결형 기본 문구와 운영자 편집 가능성을 함께 보존한다.

### 5.2 기각: 완성 문장을 코드에서 하드코딩

선택 정보가 없을 때 자연스러운 문장을 만들기 쉽지만 운영자가 설정 화면에서 문구를 수정할 수 없고, provider와 UI에 workflow 지식이 퍼진다.

### 5.3 기각: template만 바꾸고 기존 네 개 공통 변수만 사용

변경량은 작지만 학생·수업·변경 전후·결과를 제공할 수 없어 목표를 만족하지 못한다. raw payload 전체를 template에 노출하는 변형도 개인정보와 호환성 위험 때문에 채택하지 않는다.

## 6. 알림 콘텐츠 계약

### 6.1 자기완결성 판정

링크를 숨긴 상태에서도 다음 질문에 답할 수 있어야 한다.

1. 대상은 누구 또는 어느 수업인가?
2. 정확히 어떤 event가 발생했는가?
3. 해당 event의 핵심 값은 무엇인가?
4. 변경 event라면 이전 값과 새 값은 무엇인가?
5. 진행 중이라면 누구 또는 어느 팀의 어떤 처리를 기다리는가?

긴 댓글 전체, 첨부파일, 감사 이력까지 알림에 복사하는 것은 자기완결성의 범위가 아니다. 다만 긴 원문이 있다는 사실과 업무 판단에 필요한 구조화된 핵심 사실은 링크 없이 알 수 있어야 한다.

### 6.2 제목

기본 형식은 다음과 같다.

```text
{상태 이모지} [{업무명}] {대상}의 {발생 사실을 나타내는 구어체 문장}
```

위 형식은 정보 순서이지 모든 제목에 조사 `의`를 강제하는 문자열 template이 아니다. event content contract가 `이서연 학생이`, `대기고1A 영어`, `7월 교재비 정산서가`처럼 자연스러운 제목 대상 표현과 조사를 정한다.

상태 이모지는 텍스트 의미를 대체하지 않고 중복 보조한다.

| 의미 | 기본 이모지 | 예시 동사 |
| --- | --- | --- |
| 새 접수·제출 | 📥 | 들어왔어요, 접수됐어요 |
| 변경·재개 | 🔄 | 바뀌었어요, 다시 열렸어요 |
| 예약·리마인더 | ⏰ | 예정되어 있어요 |
| 댓글 | 💬 | 댓글이 등록됐어요 |
| 승인·완료·통과 | ✅ | 승인됐어요, 완료됐어요 |
| 반려·보완 | ↩️ | 보완을 요청했어요, 반려됐어요 |
| 취소·미응시·거절 | ⛔ | 취소됐어요, 미응시로 기록됐어요 |

한 제목에 의미 이모지는 하나만 사용한다. `[업무명]`과 문장만 읽어도 같은 의미가 드러나야 한다.

### 6.3 본문

업무별 필요한 행만 사용한다.

```text
[학생] 대상 학생과 학년
[수업] 과목·반·담당 선생님
[일정] 실제 업무 일정
[변경] 이전 값 → 새 값
[결과] 점수·통과 기준·판정
[장소] 실제 장소
[사유] 안전하게 정리한 사유
[상태] 업무 자체의 현재 상태
[진행] 사람 또는 팀의 처리 상태
```

선택 값이 없으면 해당 행 전체를 생략한다. `[장소] 미정`, `[사유] null`처럼 없는 값을 있는 것처럼 쓰지 않는다. 반드시 필요한 값이 빠지면 안전한 오해를 만들지 않고 render/QA 오류로 처리한다.

### 6.4 날짜·시간

- `Asia/Seoul` 기준 절대 시각을 사용한다.
- event의 `occurred_at`을 KST로 바꾼 연도와 일정 연도가 같으면 `8월 7일(금) 17:00`, 다르면 `2027년 1월 2일(토) 09:00`으로 표시한다. 렌더 실행 시점의 현재 연도를 사용하지 않아 연말 이후 재시도해도 같은 snapshot이 같은 문자열을 만든다.
- 업무 일정이 아니라 알림 발생 시각인 `occurred_at`은 기본 본문에 넣지 않는다. 대시보드·Google Chat metadata가 표시 시간을 담당한다.
- `내일`, `곧`, `방금`처럼 시간이 지나면 틀려지는 상대 표현은 사용하지 않는다.
- 기간은 `10:00~12:00`, 변경은 `8월 5일(수) → 8월 7일(금)`처럼 표시한다.

### 6.5 진행 상태와 단체방 문장

기본 템플릿에서 `[다음]`을 사용하지 않는다. 대신 event snapshot으로 증명 가능한 진행 주체와 상태만 쓴다.

| 상태 | 기본 문장 예시 |
| --- | --- |
| 결재 대기 | `[진행] {진행주체}의 결재를 기다리고 있어요.` |
| 팀 확인 중 | `[진행] {담당팀}에서 내용을 확인하고 있어요.` |
| 일정 조율 중 | `[진행] {담당팀}에서 일정을 조율하고 있어요.` |
| 처리 준비 | `[진행] {담당팀}에서 반영을 준비하고 있어요.` |
| 완료 | `[상태] 처리가 완료됐어요.` |
| 보완 요청 | `[상태] {처리주체}의 보완 요청이 등록됐어요.` |

`{진행주체}`는 `김철수님`, `담당 결재자`, `관리팀`처럼 뒤에 `의`를 붙여도 자연스러운 표시 값이다. `{담당팀}`은 팀으로 증명된 경우에만 사용한다. 두 값 모두 payload snapshot에서 검증된 이름·역할·팀을 사용하며, 이름을 알 수 없으면 ID를 노출하지 않고 업무상 안전한 역할·팀 fallback을 사용한다. 현재 담당자를 증명할 수 없는 event에서는 사람 이름을 추측하지 않는다.

대기와 실제 처리 중을 구분한다. 담당자가 정해졌다는 사실만으로 `확인하고 있어요`라고 쓰지 않는다. 대기 상태는 `{진행주체}의 확인을 기다리고 있어요`, 실제 시작 event가 있으면 검증된 `{진행정보}`, 완료 event면 `확인이 끝났어요`로 렌더한다. event content contract는 `progress_state`와 `progress_actor`의 근거 payload를 함께 정의한다. 일반적인 event는 검증된 완성 행 `{진행정보}`를 사용하고, 결재 대기처럼 상태·주체가 모두 보장된 event만 `{진행주체}`를 이용한 편집 가능한 문장을 기본으로 쓴다.

### 6.6 목적지 팀과 정보 범위

presentation builder 입력에는 audience/channel뿐 아니라 resolver가 확정한 `connection_key`와 `destination_team`을 포함한다.

- 과목 하나이면 현재 rule이 허용한 해당 과목팀 방만 대상으로 삼는다.
- 여러 과목이면 기존 resolver와 저장된 rule이 만든 목적지에만 전달한다. 콘텐츠가 여러 과목이라는 이유로 새 방을 추가하지 않는다.
- 과목팀 방에는 그 팀의 과목 정보와 공통 진행 상태를 표시한다. 관리팀·경영팀 방에는 현재 audience 정책이 허용한 전체 구조화 사실을 표시한다.
- 과목 또는 목적지 팀을 확정할 수 없으면 영어·수학·과학 세 방으로 확산하지 않고 해당 delivery를 안전하게 실패시킨다.
- 사유·댓글·첨부 요약의 공개 범위는 event content contract의 `free_text_visibility`로 관리한다.
- QA는 예상 목적지의 최종 payload뿐 아니라 비대상 네 방의 실제 delivery 0건도 함께 확인한다.

## 7. workflow별 기본 정보 구조

| workflow | 제목의 대상 | 필수 핵심 행 | 조건부 행 |
| --- | --- | --- | --- |
| 할 일 | 할 일 제목 또는 관련 학생 | `[업무]`, 변경 전후 또는 현재 상태 | `[학생]`, `[수업]`, `[진행]`, `[댓글]` |
| 영어 단어 재시험 | 학생·반 | `[시험]`, 일정 또는 결과 | `[결과]`, `[진행]`, `[사유]` |
| 등록 | 학생·학년·과목 | 상담/예약 종류, 일정·장소 또는 등록 단계 | `[수업]`, `[진행]`, `[변경]` |
| 전반 | 학생 | `[변경] 기존 반 → 이동 반`, 적용일 | `[진행]`, `[사유]` |
| 퇴원·수강 제외 | 학생과 선택 과목·반 | 제외 대상, 적용일·회차 | 다른 과목 유지가 증명될 때만 `[상태]` |
| 휴보강 | 반·과목 | 휴강 일정 → 보강 일정, 장소, 결재 상태 | `[사유]`, `[진행]`, `[메모]` |
| 전자결재 | 문서명·대상 기간 | 결재 event와 현재 결재 상태 | `[진행]`, `[댓글]`, `[사유]` |

### 7.1 할 일 일정 변경

```text
🔄 [할 일] 박지훈 학생 교재 주문 마감일이 바뀌었어요

[업무] 2학기 수학 교재 주문
[변경] 8월 5일(수) → 8월 7일(금)
[진행] 관리팀의 변경 일정 확인을 기다리고 있어요.
```

### 7.2 영어 단어 재시험 결과

```text
✅ [단어 재시험] 이서연 학생이 재시험을 통과했어요

[수업] 중2 영어 A반
[시험] Lesson 12 · 50문항
[결과] 46점 / 통과 기준 45점 · 통과
[상태] 재시험 결과가 기록됐어요.
```

### 7.3 등록 방문상담 변경

```text
🔄 [등록] 김민서 학생의 방문상담 일정이 바뀌었어요

[과목] 영어 · 수학
[변경] 8월 6일(목) 16:00 → 8월 7일(금) 17:00
[장소] 본관 상담실
[진행] 영어팀과 수학팀 담당 원장님의 일정 확인을 기다리고 있어요.
```

현재 rule이 관리팀 방만 대상으로 한다면 관리팀 방에만 보낸다. 영어팀·수학팀은 이 예시의 진행 주체이지 새로운 전달 대상이 아니다. 한 방 안에서는 사람별 문구를 나누지 않는다.

### 7.4 전반 완료

```text
✅ [전반] 김도윤 학생의 반 이동이 완료됐어요

[변경] 중2 수학 A반 → 중2 수학 B반
[일정] 기존 반 8월 28일(금)까지 · 새 반 8월 31일(월)부터
[상태] 새 반으로 수강 정보가 반영됐어요.
```

### 7.5 과목 단위 수강 제외 완료

```text
✅ [수강 제외] 김민서 학생의 수학 수강 제외 처리가 끝났어요

[수업] 중2 수학 A반
[일정] 8월 31일(월) · 8회차부터 제외
[상태] 다른 과목 수강은 그대로 유지돼요.
```

`다른 과목 수강은 그대로 유지돼요`는 event payload가 선택 과목만 제외됐고 다른 활성 과목이 유지된다는 사실을 증명할 때만 표시한다. 증거가 없으면 행을 생략한다. `withdrawal.completed`라는 내부 event 이름만 보고 학생 전체가 퇴원했다고 표현하지 않는다.

### 7.6 휴보강 신청

```text
📥 [휴보강] 대기고1A 영어 휴보강 신청이 들어왔어요

[수업] 영어 · 강부희 선생님 담당
[일정] 휴강 8월 5일(수) → 보강 8월 7일(금) 10:00~12:00
[장소] 별관 3강
[사유] 개인 일정
[진행] 김철수님의 결재를 기다리고 있어요.
```

### 7.7 전자결재 제출

```text
📥 [전자결재] 7월 교재비 정산서가 제출됐어요

[문서] 7월 교재비 정산 · 작성자 박지영
[기간] 2026년 7월
[진행] 김철수님의 결재를 기다리고 있어요.
```

### 7.8 event별 자기완결성 계약

아래 표는 현재 설정·고정 rule에 포함된 event의 최소 계약이다. `필수 사실`이 없으면 render 실패이며, `조건부` 값이 없으면 해당 완성 행만 생략한다. 실제 기본 title/body 전체 문자열은 이 계약에서 생성한 골든 fixture가 소유한다.

#### 할 일

| event | 기본 제목 동사 | 필수 사실 | 조건부 |
| --- | --- | --- | --- |
| `task.created` | 할 일이 등록됐어요 | 할 일 제목, 현재 상태, 담당·담당팀 또는 명시적 미배정 | 학생·수업, 시작·마감일 |
| `task.assignee_changed` | 담당자가 바뀌었어요 | 할 일 제목, 이전 담당 → 새 담당. 양쪽 모두 명시적 미배정 허용 | 학생·수업, 마감일 |
| `task.due_changed` | 일정이 바뀌었어요 | 할 일 제목, 이전 일정 → 새 일정. 양쪽 모두 명시적 일정 없음 허용 | 학생·수업, 담당팀 |
| `task.status_changed` | 상태가 바뀌었어요 | 할 일 제목, 이전 상태 → 새 상태 | 학생·수업, 진행정보 |
| `task.completed` | 할 일이 완료됐어요 | 할 일 제목, 완료 상태 | 학생·수업, 완료 시각 |
| `task.canceled` | 할 일이 취소됐어요 | 할 일 제목, 취소 상태 | 취소 사유, 처리주체 |
| `task.reopened` | 할 일이 다시 열렸어요 | 할 일 제목, 이전 상태 → 재개 상태 | 새 마감일, 담당팀 |
| `task.comment_added` | 댓글이 등록됐어요 | 할 일 제목, 댓글 작성자, 안전한 댓글 미리보기 | 첨부정보 |

#### 영어 단어 재시험

| event | 기본 제목 동사 | 필수 사실 | 조건부 |
| --- | --- | --- | --- |
| `word_retest.created` | 재시험이 등록됐어요 | 학생, 반, 시험 범위, 시험일 | 담당 조교·팀 |
| `word_retest.assigned` | 담당자가 바뀌었어요 | 학생, 이전 담당 → 새 담당. 양쪽 모두 명시적 미배정 허용 | 반, 시험일 |
| `word_retest.schedule_changed` | 시험 일정이 바뀌었어요 | 학생, 이전 시험일 → 새 시험일 | 반, 시험 범위 |
| `word_retest.started` | 재시험 처리가 시작됐어요 | 학생, 반, 시험 범위, 시작 상태 | 처리주체 |
| `word_retest.result_reported` | 재시험 결과가 기록됐어요 | 학생, 점수와 단위, 통과 기준과 단위, 통과·불통과 판정 | 보고자, 메모 |
| `word_retest.absent_reported` | 미응시로 기록됐어요 | 학생, 예정 시험일, 미응시 판정 | 기록자, 사유 |
| `word_retest.revision_requested` | 결과 보완 요청이 등록됐어요 | 학생, 현재 결과, 요청주체 | 보완 사유 |
| `word_retest.retry_created` | 후속 재시험이 등록됐어요 | 학생, 이전 시도 결과, 새 재시험 일정 또는 상태 | 담당 조교·팀 |
| `word_retest.completed` | 재시험 업무가 완료됐어요 | 학생, 최종 결과·상태 | 완료 시각 |
| `word_retest.canceled` | 재시험이 취소됐어요 | 학생, 취소 상태 | 예정일, 취소 사유 |

점수와 통과 기준은 `46점`, `46/50`, `정답 46개`를 섞지 않는다. producer가 기록한 단위를 함께 snapshot하고 같은 단위끼리 비교한다.

#### 등록

| event | 기본 제목 동사 | 필수 사실 | 조건부 |
| --- | --- | --- | --- |
| `registration.case_created` | 등록 문의가 들어왔어요 | 학생, 학년, 과목, 문의 시각 | 현재 단계 |
| `registration.registration_completed` | 등록 처리가 완료됐어요 | 학생, 등록 과목·수업, 완료 상태 | 시작 일정 |
| `registration.case_closed` | 등록 문의가 종료됐어요 | 학생, 과목, 종료 상태 | 종료 사유 |
| `registration.appointment_reminder_due` | 상담 일정이 예정되어 있어요 | 상담 종류, 학생, 과목, 일정, 장소 | 진행정보 |
| `registration.phone_consultation_ready` | 전화상담을 기다리고 있어요 | 학생, 과목, 담당 원장 또는 진행주체 | 학년 |
| `registration.visit_scheduled` | 방문상담이 예약됐어요 | 학생, 과목, 새 일정, 장소 | 진행정보 |
| `registration.visit_rescheduled` | 방문상담 일정이 바뀌었어요 | 학생, 과목, 이전 일정 → 새 일정, 새 장소 | 이전 장소, 진행정보 |
| `registration.visit_replaced` | 방문상담 예약이 교체됐어요 | 학생, 과목, 이전 예약 → 새 예약, 새 장소 | 이전 장소, 진행정보 |
| `registration.visit_subject_deselected` | 방문상담 과목이 제외됐어요 | 학생, 제외 과목, 남은 과목, 유지 일정·장소 | 진행정보 |
| `registration.visit_canceled` | 방문상담이 취소됐어요 | 학생, 과목, 취소된 일정·장소 | 취소 사유·주체 |

등록의 `subject_team` 목적지는 과목 데이터와 별도로 검증한다. 여러 과목이 있다는 사실만으로 여러 과목팀이 실제 처리 중이라고 표현하지 않는다.

#### 전반

| event | 기본 제목 동사 | 필수 사실 | 조건부 |
| --- | --- | --- | --- |
| `transfer.submitted` | 반 이동 신청이 들어왔어요 | 학생, 기존 반 → 이동 반, 요청 적용일, 신청주체 | 사유·의견, 진행정보 |
| `transfer.completed` | 반 이동이 완료됐어요 | 학생, 기존 반 → 이동 반, 기존 반 종료일, 새 반 시작일 | 처리주체 |

현재 반 담당 선생님과 실제 신청자가 같다는 snapshot이 없으면 `{신청주체}`에 담당 선생님 이름을 넣지 않는다.

#### 퇴원·과목 단위 수강 제외

| event | 기본 제목 동사 | 필수 사실 | 조건부 |
| --- | --- | --- | --- |
| `withdrawal.submitted` | `{과목}` 수강 제외 신청이 들어왔어요 | 학생, 선택 과목·반, 요청 제외일·회차, 신청주체 | 사유·의견, 진행정보 |
| `withdrawal.completed` | `{과목}` 수강 제외 처리가 끝났어요 | 학생, 선택 과목·반, 적용 제외일·회차 | 다른 활성 과목 유지가 증명될 때만 상태 행 |

제출과 완료 모두 제목부터 선택 과목 범위를 밝힌다. 내부 workflow 이름이 `withdrawal`이어도 전체 학생 퇴원으로 확대해서 표현하지 않는다.

#### 휴보강

| event | 기본 제목 동사 | 필수 사실 | 조건부 |
| --- | --- | --- | --- |
| `makeup.submitted` | 휴보강 신청이 들어왔어요 | 반·과목, 담당 선생님, 휴강일 → 보강 일정, 장소, 진행주체 | 사유 |
| `makeup.refund_requested` | 휴보강 환불 신청이 들어왔어요 | 반·과목, 대상 일정, 환불 대기 상태 | 사유, 진행주체 |
| `makeup.approved` | 휴보강 신청이 승인됐어요 | 반·과목, 휴강일 → 보강 일정, 장소, 승인주체 | 승인 메모 |
| `makeup.refund_completed` | 휴보강 환불 처리가 끝났어요 | 반·과목, 환불 완료 상태·시각 | 처리주체, 메모 |
| `makeup.approval_canceled` | 휴보강 승인이 취소됐어요 | 반·과목, 취소 상태·시각, 처리주체 | 취소 메모 |
| `makeup.revision_requested` | 휴보강 보완 요청이 등록됐어요 | 반·과목, 요청주체, 현재 상태 | 보완 사유 |
| `makeup.rejected` | 휴보강 신청이 반려됐어요 | 반·과목, 반려주체, 반려 상태 | 반려 사유 |

휴보강은 반·과목 중심 업무다. payload에 학생 범위가 없으면 학생 이름을 임의로 만들지 않는다.

#### 전자결재

| event | 기본 제목 동사 | 필수 사실 | 조건부 |
| --- | --- | --- | --- |
| `approval.created` | 결재 문서가 작성됐어요 | 문서명, 작성자, 대상 기간, 초안 상태 | 첨부정보 |
| `approval.submitted` | 결재 문서가 제출됐어요 | 문서명, 작성자, 대상 기간, 현재 결재자 또는 진행주체 | 첨부정보 |
| `approval.review_started` | 결재 검토가 시작됐어요 | 문서명, 검토주체, 검토 시작 상태 | 대상 기간 |
| `approval.approver_changed` | 결재자가 바뀌었어요 | 문서명, 이전 결재자 → 새 결재자 | 변경주체 |
| `approval.approved` | 결재가 승인됐어요 | 문서명, 승인주체, 승인 상태·시각 | 승인 메모 |
| `approval.returned` | 결재가 반려됐어요 | 문서명, 반려주체, 반려 상태 | 반려 사유 |
| `approval.canceled` | 결재가 취소됐어요 | 문서명, 취소주체, 취소 상태 | 취소 사유 |
| `approval.resubmitted` | 결재 문서가 다시 제출됐어요 | 문서명, 재상신자, 현재 결재자 또는 진행주체 | 보완 내용 |
| `approval.comment_added` | 결재 댓글이 등록됐어요 | 문서명, 댓글 작성자, 안전한 댓글 미리보기 | 첨부정보 |

`[첨부] 파일 2개가 함께 있어요.`처럼 첨부 개수와 안전한 유형만 표시한다. 파일명은 민감정보를 포함할 수 있어 기본 알림에는 넣지 않는다. attachment count/type snapshot이 없는 event에서는 첨부 행을 생략하되, 첨부 존재 여부가 workflow 판단에 필수라면 producer 보완 전까지 권장본을 활성화하지 않는다.

## 8. 편집 가능한 template 계약

### 8.1 기존 편집 흐름 보존

알림 설정의 기존 `내용 수정` 대화상자와 `변경사항 저장` 흐름을 유지한다. 운영자는 title/body의 일반 문구와 허용 token을 조합해 저장할 수 있다.

운영자가 바꿀 수 있는 범위는 다음과 같다.

- 이모지와 `[업무명]` 표기
- 라벨 이름
- 말투와 문장 끝맺음
- 행의 순서
- 선택 행 포함 여부
- 진행 상태 안내 문장

현재 설정 그리드에 숨겨진 등록 전화상담·방문상담 고정 rule도 등록 workflow 안에서 찾을 수 있게 표시한다. 이 행은 전달 정책이 고정되어 있다는 뜻의 잠금 상태를 보여주고 활성화 toggle은 제공하지 않지만, `내용 수정`은 다른 rule과 똑같이 사용할 수 있다. 해당 direct/legacy projection도 이 고정 rule의 active template을 읽어야 하며 SQL에 별도 문구를 하드코딩하지 않는다. 고객 문자 rule은 이번 범위가 아니므로 계속 제외한다.

### 8.2 변수 두 종류

1. **값 token:** 문장을 운영자가 직접 만들 수 있게 한다. 예: `{학생}`, `{수업}`, `{기존일정}`, `{변경일정}`, `{진행주체}`, `{담당팀}`
2. **선택 행 token:** 값이 없을 때 라벨만 남지 않도록 한 행 전체를 반환한다. 예: `{사유정보}`, `{장소정보}`, `{댓글정보}`

필수 값 token은 event별로 정한다. 예를 들어 일정 변경은 대상과 이전 일정·새 일정이 필수이고, 결과 보고는 학생·점수·판정이 필수다. 필수 token은 title과 body를 합친 template 안에 존재해야 한다.

선택 행 token은 context에 항상 문자열 key로 존재한다. 값이 없으면 빈 문자열이고, 값이 있으면 `[사유] ...`처럼 라벨까지 포함한 완성 행이다. 선택 행 token은 template에서 빼도 저장할 수 있지만, 사용할 때는 한 줄에 token 하나만 둘 수 있다. 렌더러는 치환 후 빈 줄 연속과 줄 끝 공백을 정규화한다. 이 계약으로 미치환 token과 `[사유] ` 같은 빈 라벨을 모두 막는다.

선택 행 token 안의 라벨은 이번 범위에서는 고정한다. 운영자가 자유롭게 바꿀 수 있는 라벨은 필수 값 token으로 조립한 행에 한정한다. 조건문 template 문법을 새로 만들지 않으면서 빈 라벨을 막기 위한 의도적인 제한이다.

기존 template의 `allowed_variables`는 과거 렌더 재현을 위한 version별 snapshot으로 유지한다. 별도의 event content contract가 편집 시점의 `available_variables`, `required_tokens`, `optional_line_tokens`, 지원 payload schema를 제공한다. 편집기는 active template의 과거 allowlist가 아니라 이 최신 contract를 보여주고, 저장 RPC는 최신 contract를 snapshot한 새 template version을 만든다. 기존 template row의 allowlist를 수정하지 않는다.

### 8.3 저장 검증

- title과 body는 비어 있을 수 없다.
- 알 수 없는 token, 중괄호 불일치, HTML, 외부 URL, 전체 멘션을 거절한다.
- event별 `required` token이 빠지면 저장 전에 해당 필드를 구체적으로 안내한다.
- 제목 200자, 본문 4,000자라는 현재 서버 상한 안에서 저장한다.
- 제목이 60 grapheme cluster를 넘으면 모바일에서 핵심 대상·사건을 앞쪽으로 줄이라는 품질 경고를 표시하되, 현재 200자 서버 상한 안에서는 운영자 저장을 강제로 막지 않는다.
- Google Chat template에 `[다음]`이 있거나 `확인해 주세요`, `처리하세요`처럼 현재 독자에게 직접 지시하는 대표 표현이 있으면 단체방 공용 상태 문장으로 바꾸라는 경고를 표시한다. 운영자가 그대로 저장한 custom template은 보존하되 compliance 결과를 `legacy_custom_nonconformant`로 기록한다.
- 같은 내용을 다시 저장하면 불필요한 새 version을 만들지 않는다.
- 실질적인 문구 변경은 새 immutable template version을 만들고 rule revision을 한 번 증가시킨다.
- 기존 낙관적 잠금과 충돌 재적용 흐름을 유지한다.

이번 범위에서 template version history UI를 새로 만들지 않는다. 과거 version은 감사와 운영 rollback을 위해 DB에 보존한다.

`notification_templates`의 append-only는 애플리케이션·RPC·이번 migration 경계의 계약이다. 기존 row에는 UPDATE/DELETE를 수행하지 않고 새 version만 INSERT하며, 테스트가 이전 row의 byte-for-byte 불변을 확인한다. 이번 콘텐츠 작업은 데이터베이스 owner의 직접 수정을 막는 새 전역 trigger까지 추가하지 않으며, checksum은 보안 서명이 아니라 알려진 baseline과 no-op을 식별하는 보조값으로만 사용한다.

### 8.4 기존 맞춤 template 보호

새 시스템 권장본은 append-only version으로 추가한다.

- 현재 active template이 알려진 기존 시스템 기본본과 정확히 같으면 새 권장본으로 전환할 수 있다. 정확한 일치는 system creator, 승인된 baseline template ID, title/body, allowed variables, payload schema version, checksum, 사전 점검 rule revision을 모두 비교하고 같은 transaction의 rule lock 안에서 다시 확인한다.
- 현재 active template이 사용자가 수정한 version이면 자동으로 덮어쓰지 않는다.
- custom active template은 자기완결성 contract를 충족하면 `conformant`, 충족하지 않으면 `legacy_custom_nonconformant`로 감사 결과만 남긴다. 후자의 실제 문구가 새 권장본과 같아졌다고 주장하지 않는다.
- custom 운영자가 기존 문구에 새 token을 넣어 저장하면 event content contract의 최신 allowlist를 가진 새 version이 생성된다. 저장 전까지 기존 version과 active pointer는 그대로다.
- 이후 migration을 다시 실행해도 사용자 version을 기본본으로 되돌리지 않는다.

`updated_actor_kind` 하나만으로 시스템 기본본 여부를 추측하지 않는다. 기존 기본 template의 ID·checksum·내용을 함께 비교한다.

### 8.5 휴보강 template의 단일 쓰기 경계

휴보강은 공통 notification template과 legacy `makeup_notification_settings` 편집 경로가 함께 남아 있다. 두 독립 writer를 유지하면 어느 문구가 실제 발송되는지 다시 갈라질 수 있으므로 공통 알림 설정 command를 in-app/Google Chat template의 유일한 쓰기 권위로 정한다.

- 기존 휴보강 전용 편집 진입점은 서버에서 공통 저장 command로 위임한다.
- 한 DB transaction 안에서 canonical 새 template version과 legacy 호환 mirror를 함께 갱신하고 audit를 남긴다.
- 한쪽 저장이 실패하면 둘 다 rollback한다.
- legacy sender는 현재 dispatch owner가 유지되는 동안 mirror를 읽지만 독립적으로 template을 수정하지 않는다.
- enabled 상태와 dispatch owner는 이 단일 쓰기 전환으로 바꾸지 않는다.

## 9. 표현 context와 renderer 구조

### 9.1 event content contract와 immutable 표시 snapshot

event별 content contract는 자기완결성에 필요한 사실과 표시 변수를 명시한다.

| 계약 항목 | 내용 |
| --- | --- |
| `available_variables` | 현재 편집기와 새 template version에서 쓸 수 있는 변수 |
| `required_tokens` | title/body를 합쳐 반드시 포함해야 하는 변수 |
| `optional_line_tokens` | 빈 문자열 또는 라벨을 포함한 완성 행으로만 렌더되는 변수 |
| `must_have_facts` | 대상, 발생 사실, 변경 전후, 결과, 진행 주체 등 의미 단위 assertion |
| `supported_payload_versions` | builder와 canonical/legacy renderer가 모두 지원하는 schema version |
| `destination_policy` | 허용 connection/destination team과 과목별 정보 범위 |
| `free_text_visibility` | audience·destination별 사유·댓글·첨부 요약 공개 범위 |
| `free_text_priority` | 자유 입력 후보가 세 개 이상일 때 표시할 최대 두 필드의 순서 |
| `field_presence` | 필수 key와 optional key, 각 key의 명시적 null 허용 여부·표시 문구 |

현재 content contract는 rule identity로 조회하는 server-owned registry다. TypeScript registry와 DB 저장 RPC가 호출하는 private SQL contract function은 같은 `contract_version`과 JSON 값을 반환해야 하며 fixture parity로 묶는다. control-plane snapshot은 이 최신 contract를 편집기에 전달하고, 저장 RPC는 클라이언트가 보낸 allowlist를 신뢰하지 않고 rule identity로 contract를 다시 계산한다. 기존 template rendering은 계속 그 version에 저장된 `allowed_variables` snapshot을 사용하므로 최신 contract 배포만으로 과거 문구가 바뀌지 않는다.

표시명과 변경 전후 값은 event 생성 transaction에서 immutable snapshot으로 기록한다. renderer가 현재 DB를 다시 조회해 과거 event의 사람 이름, 담당자, 일정, 수강 상태를 재구성하지 않는다. UUID는 표시명 fallback으로 사용하지 않는다.

payload key의 부재와 정상적인 “없음” 상태를 구분한다.

- contract상 필수 key 자체가 없으면 producer/schema 오류다.
- key가 있고 값이 명시적 `null`이면 event별 `field_presence`가 허용한 정상 상태로 처리한다. 담당자는 `미배정`, 일정은 `일정 없음`, 결재자는 `결재자 지정 대기`처럼 자연스럽게 표시한다.
- 값이 있으면 검증된 표시 값으로 렌더한다.
- 빈 배열도 key 부재와 다르다. 예를 들어 `other_active_subjects: []`는 남은 과목이 없다는 명시적 snapshot이고, key 부재는 다른 과목 상태를 증명할 수 없다는 오류다.
- optional key가 명시적 `null`이면 행을 생략할 수 있지만, 필수 변경 전후 key의 null은 `미배정 → 김철수님`, `김철수님 → 미배정`, `일정 없음 → 8월 7일(금)`처럼 의미를 보존한다.

각 producer는 contract상 필수 key를 항상 기록하고 “없음”을 key 생략으로 표현하지 않는다. null을 허용하지 않는 필드에 null이 오면 render 실패다.

현재 확인된 producer 보완 대상은 다음과 같다.

| event 계열 | 추가로 snapshot할 사실 |
| --- | --- |
| 할 일 생성·담당 변경 | 현재 담당자와 이전·새 담당자의 표시명, 담당팀 표시명 |
| 할 일 댓글 | 댓글 작성자 표시명, 안전하게 정규화할 댓글 본문 |
| 영어 단어 재시험 생성·담당 변경 | 담당 조교와 이전·새 담당자의 표시명, 담당팀 표시명 |
| 전자결재 제출·결재자 변경·댓글 | 작성자·현재 결재자 표시명, 변경 전후 결재자, 댓글 작성자·본문 |
| 등록 방문상담 변경 | 이전·새 일정, 이전·새 장소, 대상 과목, 확인 주체 표시명 또는 팀 |
| 전반 신청·변경 | 신청자 표시명과 기존/이동 반·적용일. 현재 반 담당 선생님을 신청자로 표현하지 않음 |
| 과목 단위 수강 제외 | 선택 과목·반, 제외 시점·회차, 같은 transaction에서 확인한 다른 활성 과목 유지 여부 |

기존 payload로 필수 사실을 증명할 수 없는 event는 producer, legacy projection, canonical adapter가 같은 새 schema version을 지원할 때까지 새 권장 template 활성화 대상에서 제외한다. 기본 문구를 맞추기 위해 현재 DB를 사후 조회하거나 값을 추측하지 않는다.

### 9.2 workflow별 presentation builder

각 adapter 옆에 순수 함수 형태의 presentation builder를 둔다.

- 입력: canonical event key, payload schema version, 검증된 payload, audience/channel, resolver가 확정한 connection key·destination team
- 출력: 해당 rule에서 허용할 수 있는 표시용 context
- 책임: KST 날짜, 상태 한국어 표시, 전후 값, 진행 주체, 안전한 자유 입력, 선택 행 구성
- 비책임: rule 활성화, 수신자 계산, provider 전송, DB 쓰기

공통 formatter는 날짜, 공백 정규화, 제어문자 제거, 상태 label, 사람/팀 표시명 fallback만 담당한다. workflow 의미는 각 builder에 둔다.

### 9.3 기존 custom template 호환

adapter가 더 많은 표시 context를 만들더라도 worker는 현재 active template의 `allowed_variables`에 선언된 key만 renderer로 넘긴다. 기존 custom template에 없는 새 context key 때문에 `render_validation_failed`가 발생하지 않게 한다.

template에 적힌 알 수 없는 token은 계속 fail-closed로 처리한다. 이번 작업의 표시명·변경 전후·첨부 개수 snapshot은 기존 소비자가 무시할 수 있는 additive field로 추가하고 현재 payload schema version을 유지한다. 이 순서라면 먼저 배포된 producer의 새 event를 기존 template도 계속 렌더할 수 있고, 이후 새 template이 새 필드를 사용할 수 있다.

기존 필드 의미를 바꾸거나 제거해야 하는 breaking schema 변경은 이번 범위에서 하지 않는다. 구현 중 breaking bump가 불가피해지면 producer와 template pointer를 workflow 단위로 원자 전환하거나 schema별 template 선택을 별도 설계하기 전에는 해당 workflow 권장본을 활성화하지 않는다.

### 9.4 canonical/legacy 정합성

canonical TypeScript worker와 실제 전달을 아직 소유하는 legacy SQL projection 모두 같은 표시 계약을 적용한다. 구현 언어가 달라 한 함수를 직접 공유할 수 없는 경로는 다음으로 정합성을 증명한다.

- 동일 fixture 입력
- 동일 title/body 기대 문자열
- 동일 URL 한 번 포함
- 동일 자유 입력 정규화 결과
- 동일 날짜·상태 label

한쪽 경로만 업데이트한 상태에서는 cutover하지 않는다.

모든 `legacy` owner rule은 새 표시 context를 legacy renderer에도 공급해야 한다. 정상 문자열뿐 아니라 필수 값 누락, 선택 행 생략, 자유 입력 정규화, 길이 초과 오류가 canonical과 같아야 한다. 어느 경로든 구형 공통 네 변수 renderer만 사용하면 해당 rule의 권장본 활성화를 차단한다. dispatch owner는 바꾸지 않으며 동일 identity가 canonical과 legacy 양쪽에서 동시에 전달되지 않는지도 검증한다.

## 10. 개인정보와 자유 입력

### 10.1 구조화된 사실 우선

학생·수업·일정·점수·판정·진행 상태가 자유 입력보다 먼저 의미를 완성해야 한다. 댓글이나 사유 첫 문장만 읽어 event를 추측하게 만들지 않는다.

### 10.2 안전한 표시

- 전화번호, 보호자 연락처, UUID, raw event/status code, JSON, `null`, `true`, `false`, `/admin/` 경로를 본문에 노출하지 않는다.
- template의 의도된 줄바꿈은 보존하지만 자유 입력 안의 모든 줄바꿈은 공백으로 접는다. 사용자가 댓글 안에 가짜 `[상태]`, `[진행]` 행을 만들 수 없게 한다.
- 제어문자, HTML 태그, broadcast mention, raw URL은 제거하거나 `[링크 포함]`처럼 안전한 표시로 바꾼다. Google Chat에서 서식으로 해석되는 `*`, `_`, `~`, 백틱도 자유 입력에서는 escape하거나 일반 문자로 중화한다.
- 직접적인 업무 사유·댓글은 권한 있는 기존 audience에만 현재 rule대로 전달한다. 콘텐츠 변경이 audience를 넓히지 않는다.
- 자유 입력은 연락처·URL·제어문자 제거와 공백 정규화를 마친 안전한 표시 원문을 기준으로 필드당 최대 240개의 grapheme cluster까지 표시한다. 결합문자나 이모지를 중간에서 자르지 않는다. 더 길면 앞 240개를 결정적으로 남기고 `… (전체 428자)`처럼 안전한 표시 원문의 길이를 표시한다.
- 한 알림에는 자유 입력 필드를 최대 두 개까지만 넣는다. 세 개 이상 후보가 있는 event는 content contract에 `free_text_priority`를 고정하며 AI 요약은 사용하지 않는다.
- 제목과 구조화된 사실은 잘라서 의미를 바꾸지 않는다. 길이 상한을 넘는 필수 사실은 render 실패와 QA 오류로 처리한다.

## 11. 채널 출력

### 11.1 대시보드

- 본문 줄바꿈을 `pre-wrap` 또는 동등한 방식으로 보존한다.
- 긴 한글·영문·괄호가 카드 밖으로 넘치지 않게 `overflow-wrap:anywhere` 또는 동등한 규칙을 적용한다.
- 팝오버는 320px viewport에서도 좌우 8px 이상 여백 안에 들어오고, 최대 높이는 `100dvh`에서 외부 여백을 뺀 값으로 제한해 목록 내부가 스크롤된다.
- 본문은 최소 `text-sm`과 읽을 수 있는 행간을 사용하며 텍스트·상태 표시의 대비를 유지한다.
- 읽지 않음 상태를 색상 하나에만 의존하지 않는다.
- 알림 버튼의 접근 가능한 이름에 읽지 않은 개수를 반영하고, 개별 읽음 처리 버튼도 알림을 구분할 수 있는 이름과 44×44px 이상의 터치 영역을 갖는다.
- 열기·Escape 닫기·닫힌 뒤 trigger로 초점 복귀를 지원하고, 스크롤이 긴 경우에도 현재 초점 표시가 보인다.
- 목록·알림 제목·발생 시각을 의미 있는 구조로 표시하고 시각은 `<time datetime>`을 사용한다. 로딩은 `status`, 오류는 `alert`, 읽지 않은 개수 갱신은 과도하지 않은 `aria-live`로 알린다.
- 이모지는 텍스트 의미를 대체하지 않는다. 저장된 제목이 알려진 상태 이모지로 시작하면 대시보드에서 선행 grapheme만 장식 span으로 분리해 `aria-hidden` 처리하고, 접근 가능한 제목은 뒤의 텍스트를 사용한다. 알 수 없는 custom 이모지는 임의로 제거하지 않는다.

### 11.2 Google Chat

최종 provider payload는 다음 순서의 plain text 한 개다.

```text
{제목}

{본문}

{https://tipsedu.co.kr로 시작하는 전체 앱 URL}
```

- template의 title/body에는 `deep_link`를 기본으로 넣지 않는다.
- 새 event content contract의 편집 가능 변수에서 `deep_link`를 제거한다. 과거 custom snapshot의 legacy token은 과거 재현을 위해 보존하지만, 그 template을 다시 저장할 때는 본문 링크를 제거하라는 검증 안내를 거친다.
- provider가 검증된 상대 경로를 전체 URL로 바꾸어 정확히 한 번 붙인다.
- 템플릿 문구를 수정해도 provider의 URL 정책은 바뀌지 않는다.
- 최종 title/body/URL을 합친 UTF-8 payload가 Google Chat의 공식 최대 메시지 크기인 32,000 bytes를 넘으면 외부 요청 전에 실패시킨다. 크기 검사는 [Google Chat 메시지 생성 공식 문서](https://developers.google.com/workspace/chat/create-messages)의 전체 메시지 기준을 따른다.
- 실제 Google Chat 렌더링 확인은 외부 전송 승인 없이는 주장하지 않는다. 자동 QA는 최종 `{ text }` payload까지 증명한다.

## 12. 데이터 흐름

1. 도메인 transaction이 canonical event와 최소 snapshot을 기록한다.
2. 기존 rule snapshot이 channel, audience, active template version을 고정한다.
3. workflow adapter가 event payload를 검증한다.
4. presentation builder가 사람이 읽는 표시 context를 만든다.
5. worker가 active template의 allowed variables만 선택해 title/body를 렌더링한다.
6. 렌더 결과를 공통 안전성 검사로 검증한다.
7. `in_app`은 대시보드 read model에 같은 title/body를 투영한다.
8. `google_chat`은 provider가 title/body와 전체 URL 하나로 최종 payload를 만든다.
9. 기존 delivery 상태기계가 결과를 기록한다. 콘텐츠 변경은 `sent`, `failed`, `delivery_unknown` 의미를 바꾸지 않는다.

## 13. 오류 처리

- 필수 payload가 없으면 `미정`을 임의로 넣어 오해를 만들지 않고 event/workflow가 식별되는 오류 코드로 실패한다.
- optional 값이 없으면 행 전체를 생략한다.
- 이름이 없으면 UUID 대신 검증된 역할·팀 fallback을 쓴다.
- template token이 payload와 맞지 않으면 외부 provider 호출 전에 실패한다.
- 자유 입력에 URL·HTML·멘션이 있어도 전체 알림이 사라지지 않게 presentation 단계에서 먼저 안전한 표시로 바꾼다.
- `sent`, `failed`, `delivery_unknown` delivery와 이미 만들어진 대시보드 알림은 기존 title/body와 template snapshot을 그대로 보존한다.
- 즉시형 event의 기존 `pending`, `retry_wait` delivery는 당시 rule/template snapshot을 유지하며 재계산하지 않는다.
- 예약형의 아직 전송 전인 미래 `pending`, `retry_wait` delivery만 기존 reconciliation 계약에 따라 이전 delivery를 취소 표시한 뒤 새 rule/template revision의 replacement occurrence로 재생성할 수 있다. 이전 delivery의 snapshot을 수정하거나 같은 delivery를 새 template에 다시 묶지 않는다.
- 예약형의 `claimed`이면서 `sending` 전인 delivery는 기존 계약대로 cancel request를 기록하고 provider 호출 전에 취소한다. `sending`과 terminal delivery는 수정하거나 재생성하지 않는다.
- renderer 오류를 임의의 성공으로 기록하지 않는다.

## 14. migration과 전환

### 14.1 사전 점검

운영 반영 전에 읽기 전용으로 다음을 기록한다.

- workflow별 rule 수, 활성/비활성 수, channel/audience/variant
- active template ID, version, checksum, system/custom 판정
- `pending`, `retry_wait`, `claimed`, `sending`, `delivery_unknown` 수와 미종결 claim
- 현재 canonical/legacy dispatch owner와 runtime flag
- Google Chat 다섯 연결의 상태. webhook 값 자체는 출력하지 않는다.

### 14.2 두 단계 적용

1. **호환 준비 단계:** event content contract, presentation context, renderer filtering, UI 표시, provider URL 한 번 보장, 새 system template version을 추가한다. active pointer와 enabled 상태는 아직 바꾸지 않는다.
2. **조건부 pointer 전환 단계:** 무발송 fixture·저장 round-trip·브라우저 QA를 통과한 뒤, active template이 승인된 기존 system default와 정확히 일치하는 rule만 새 권장본으로 전환한다. custom rule의 pointer와 문구는 바꾸지 않는다.

pointer 전환의 CAS 조건은 `rule_id + expected revision + expected active_template_id + 기존 template checksum`이다. transaction 안에서 rule을 잠그고 같은 조건을 다시 검사한 뒤, 성공 시 active pointer를 바꾸고 revision을 정확히 1 증가시키며 audit를 기록한다. 즉시형 in-flight delivery는 과거 snapshot으로 계속 처리되고, 예약형은 기존 cancel-request/reconciliation 계약을 따른다. 과거 terminal `delivery_unknown`은 보존하지만 pointer 전환을 영구 차단하지 않는다.

미래 예약형 pending/retry replacement만 기존 reconciliation 계약을 따르고 old delivery와 old template row를 수정하지 않는다. 즉시형 pending/retry, sent/failed/delivery_unknown 이력과 과거 대시보드 행도 보존한다. migration 재실행은 새 version, revision, reconciliation job을 만들지 않는 완전한 no-op이어야 한다. 사용자 custom 또는 동시 수정 rule은 건너뛰고 rule ID와 충돌 이유만 보고한다.

운영 전환을 예외 없는 완료로 보고하려면 범위 내 활성 `legacy_custom_nonconformant`가 0건이어야 한다. 1건 이상이면 해당 rule의 안전한 업무·event·channel label과 위반 종류를 보고한다. 운영자가 예외를 명시적으로 승인해도 결과는 `예외 포함 전환`으로 보고하며 “모든 활성 알림이 conformant하다”고 주장하지 않는다.

### 14.3 rollback

- 각 rule의 이전 active template ID를 전환 증거에 기록한다.
- 현재 active template, revision, 릴리스 template checksum이 전환 직후 값과 모두 일치할 때만 이전 pointer로 되돌린다.
- rollback도 새 변경으로 취급해 revision을 정확히 1 증가시키고 audit를 남긴다.
- 릴리스 이후 운영자가 문구를 수정했다면 충돌로 보고 자동 rollback하지 않는다.
- template row, 과거 dashboard 알림, delivery 이력을 삭제하지 않는다.

## 15. QA 전략

### 15.1 정적·단위 테스트

- manifest가 레지스트리와 rule tuple을 양방향으로 덮고 각 identity가 scope/configuration/enabled/owner 축에서 정확히 한 값을 갖는지 검사한다.
- rule이 있는 모든 event × audience × channel × variant의 기본 title/body 골든 문자열을 검사한다.
- event content contract의 `must_have_facts`를 이용해 대상·발생 사실·핵심 값·변경 전후·진행 주체가 실제 렌더 결과에 포함됐는지 의미 단위로도 검사한다. 골든 문자열 일치만으로 자기완결성을 주장하지 않는다.
- 필수·선택 payload 조합, KST 자정·연말, 긴 한글, 이모지·대괄호, 여러 줄 댓글을 검사한다.
- 필수 key 부재, 허용된 명시적 null, 금지된 null을 각각 검사하고 `미배정 → 담당자`, `담당자 → 미배정`, `일정 없음 → 일정`, 빈 과목 배열과 과목 key 부재를 구분한다.
- UUID, ISO 시각, raw code, JSON, `/admin/`, `null`, 미치환 token이 title/body에 없는지 부정 assertion을 둔다.
- 과목 단위 `withdrawal.completed`가 다른 과목까지 퇴원한 것처럼 표현되지 않는지 검사한다.
- Google Chat href는 `/admin/`으로 시작하는 정상 상대 경로만 허용하고 `//evil.example`, 외부 절대 URL, path traversal, 잘못된 scheme, 중복·비정상 query를 provider 호출 전에 거절하는지 검사한다.

### 15.2 template 편집·저장 QA

- 제목 이모지, 라벨, 말투, 행 순서를 바꾼 뒤 저장하면 새 version과 active pointer가 생성되는지 확인한다.
- 저장한 custom 문구가 snapshot 재조회와 실제 renderer output에 유지되는지 확인한다.
- 같은 내용을 다시 저장하면 version이 늘지 않는지 확인한다.
- 알 수 없는 token, 중괄호 오류, 필수 token 누락을 브라우저와 서버가 모두 거절하는지 확인한다.
- Google Chat custom 문구에 `[다음]` 또는 대표 직접 지시 표현을 다시 넣으면 단체방 경고와 nonconformant 판정이 나타나는지 확인한다.
- 사용자 custom version이 system 기본본 migration 재실행으로 덮어써지지 않는지 확인한다.
- custom template을 `conformant` 또는 `legacy_custom_nonconformant`로 정확히 판정하고 후자의 문구를 자기완결형이라고 보고하지 않는지 확인한다.
- active custom template의 과거 allowlist를 수정하지 않고, 새 token을 사용해 저장한 새 version만 최신 event content contract를 snapshot하는지 확인한다.
- 저장 충돌 때 사용자의 초안이 사라지지 않는지 기존 rebase 흐름을 회귀 테스트한다.
- 등록 고정 rule은 전달 toggle이 없거나 잠겨 있고, content만 수정·저장되며 enabled/owner/runtime flag가 바뀌지 않는지 브라우저와 DB에서 확인한다.

### 15.3 provider-zero Google Chat QA

- 순수 formatting 테스트에서는 production webhook/connection secret를 제거하고 fake provider/fetch를 주입해 최종 `{ text }`를 정확히 비교한다. 가짜 함수 호출 횟수는 기대값으로 별도 기록한다.
- 최종 payload에 제목·여러 줄 본문·전체 앱 URL이 있으며 URL은 정확히 한 번인지 확인한다.
- process-level network trap은 실제 `fetch`·HTTP 요청이 발생하면 즉시 실패시킨다. 실제 외부 네트워크 요청과 실제 provider delivery attempt 행은 각각 0이어야 한다.
- dispatch·shadow·registration adapter runtime flag를 모두 false로 고정하고 cron·worker는 실행하지 않는다.
- 실제 운영 DB에는 도메인 event를 만들지 않으며 pending/claimed/sending, inbox/read-model, provider attempt 원장의 전후 delta가 모두 0인지 확인한다.
- 연결 저장이나 설정 QA 중 `테스트 메시지 보내기` 동작을 실행하지 않는다.

template 저장 round-trip은 로컬 테스트 DB transaction을 사용하는 별도 QA다. 이때 필요한 로컬 template/rule write는 허용하고 rollback하거나 격리된 fixture로 정리한다. provider-zero 증거와 “모든 DB write 0”이라는 잘못된 하나의 주장으로 합치지 않는다.

### 15.4 대시보드 브라우저 QA

- 데스크톱 1440×900, 모바일 320×568·360×800·390×844, 가로 화면과 200% 확대에서 확인한다.
- 여러 줄 본문, 긴 과목·반 이름, 결정적으로 잘린 240자 댓글 미리보기가 CSS에서 추가로 잘리지 않고 카드 밖으로 넘치지 않는지 확인한다.
- 제목·본문의 실제 `innerText`가 골든 문자열과 일치하는지 확인한다.
- href를 숨기고 클릭을 막은 상태에서도 `innerText`만으로 content contract의 must-have facts를 판정한다.
- 열기, Escape 닫기, trigger 초점 복귀, 내부 스크롤, 읽음 처리, 44×44px 터치 영역, 읽지 않은 개수, 키보드 포커스, `status`·`alert`·`time`·접근 가능한 이름을 확인한다.
- 화면에 보였다는 사실과 저장 persistence, provider payload, 실제 운영 전송을 서로 다른 증거로 기록한다.

### 15.5 코드·DB 검증

- 관련 TypeScript 테스트, lint/typecheck, Next.js Webpack build를 수행한다.
- 로컬 Supabase runtime이 준비된 경우 template versioning, migration idempotency, conditional activation, rollback을 pgTAP/SQL fixture로 검증한다.
- canonical과 legacy renderer fixture parity를 확인한다.

## 16. 완료 기준

다음 조건을 모두 만족해야 구현 완료로 판단한다.

콘텐츠 전환 효과의 시간 경계는 새 template pointer가 활성화된 뒤 생성된 즉시 event와 reconciliation으로 새로 만들어진 미래 예약형 pending/retry replacement다. 기존 즉시형 event·delivery, 과거 sent/failed/delivery_unknown과 이미 표시된 대시보드 알림은 완료 판정에서 새 문구로 소급 변경됐다고 주장하지 않는다.

1. 모든 시스템 권장 기본본과 자동 전환된 기존 system rule, manifest에 포함된 known legacy/direct producer는 링크 없이 대상·event·핵심 사실·현재 진행 상태를 알 수 있다.
2. Google Chat 기본 문구에는 개인별 `[다음]` 지시가 없고 `{진행주체}`를 이용한 단체방 공용 상태 문장이 있다.
3. 운영자는 기존 설정 화면에서 새 기본 title/body를 수정하고 저장할 수 있다.
4. 등록 전화상담·방문상담 고정 rule도 전달 toggle 없이 콘텐츠를 찾아 수정·저장할 수 있다.
5. 사용자 custom template은 system 권장본 추가·재실행으로 덮어써지지 않고 `conformant` 또는 `legacy_custom_nonconformant`로 정직하게 보고된다. 모든 활성 custom 문구가 자기완결형이라는 주장은 conformant 전환 후에만 한다.
6. 비활성 rule, channel 연결, dispatch owner, runtime flag는 콘텐츠 변경 때문에 자동 활성화되지 않는다.
7. 시스템 권장본과 이번 변경 후 새로 저장한 template의 Google Chat 최종 payload에는 전체 앱 URL이 정확히 한 번만 나타난다. 기존 nonconformant custom template의 상대 deep-link 사용은 감사 결과로 별도 보고한다.
8. 대시보드에서 여러 줄 구조가 유지되고 모바일에서도 가로 넘침이 없다.
9. 과목 단위 수강 제외는 선택 과목만 제외되며 다른 과목을 건드렸다고 표현하지 않는다.
10. 실제 Google Chat 전송 없이 provider attempt와 외부 요청 0건을 증명한다.
11. 테스트, DB/runtime 상태, 브라우저 관찰, Git, 배포, 실제 provider 상태를 각각 구분해 보고한다.
12. 팀 목적지가 확정되는 fixture는 예상 방에만 payload가 생기고 비대상 네 방의 실제 delivery는 0건이다.
13. 첨부 snapshot이 있는 event는 민감한 파일명 없이 첨부 개수·안전한 유형을 알 수 있다.

## 17. 구현 분해 원칙

상세 구현 계획은 이 설계 승인 후 별도 문서로 작성한다. 구현은 다음 경계를 한 태스크씩 진행하고 각 태스크마다 테스트·diff 확인·커밋 후 멈춘다.

1. 커버리지 manifest, event content contract, 자기완결성 의미 assertion 기반
2. 공통 formatter, renderer filtering, 선택 행·필수 token 검증
3. 할 일 presentation builder와 producer snapshot
4. 영어 단어 재시험 presentation builder와 producer snapshot
5. 등록 presentation builder, 예약·전화·방문 고정 rule 편집 노출, producer snapshot
6. 전반 presentation builder와 producer snapshot
7. 과목 단위 퇴원·수강 제외 presentation builder와 producer snapshot
8. 휴보강 presentation builder와 canonical 단일 쓰기 경계
9. 전자결재 presentation builder와 producer snapshot
10. editable system template vNext, custom 보호, conditional activation·rollback migration
11. canonical/legacy renderer parity와 Google Chat URL 한 번 보장
12. 대시보드 여러 줄·반응형·접근성 표시
13. template 수정·저장 round-trip과 전체 provider-zero QA
