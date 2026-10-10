# 등록 학생 UUID 연결 — 소스 검토 후보

UUID가 없는 등록 사건은 최종 수강·대기 명단 반영 후보에서 거절된다. 기존 현대 등록 화면에는 학생 연결 선택·서비스 호출자가 없고 전화/이름 자동 매칭이 이 역할을 맡았다. 후속 후보는 대기 또는 등록 영역에 기존 학생의 **명시적 UUID 연결**을 추가한다. 앞선 `83ac8b5e680e872f0818b6de1be96628cb301cc1` 검토본·release는 보존한다.

## 실제 호출 경로

`RegistrationApplication` → `RegistrationStudentBinding` → `searchRegistrationStudentCandidates` / `bindRegistrationStudent` → 기존 세션 transport → `/api/registration/contact` → 서버 actor·사건 접근·HMAC → `mutate_registration_contact_v1(command=bind_student)` 후보다. 수강 명단·진행상태·연락처 재개를 연결 성공의 부작용으로 실행하지 않는다.

- 기존 `SearchCombobox`, `SearchComboboxItem`, `Button`, `Label`과 semantic CSS를 사용한다. 관리팀에만 선택/연결 행동을 노출한다. 대기/등록 영역에 한 개만 마운트하며 기존 shell의 권한/잠금과 미저장 입력 보호를 유지한다.
- 기존 `list_management_numbered_page_v1` 소비자를 재사용해 **20개씩** 조회한다. 해당 계약은 10/15/20이며 30은 지원하지 않는다. 필터는 전체 상태를 포함해 새로 생성한 학생도 선택할 수 있고 검색은 이름·학교·학년이다. DTO는 `id/name/school/grade/uid`뿐이다. 표시 원생번호는 비교 정보이며 identity는 `students.id`다.
- 검색 결과가 없으면 `/admin/students`를 새 탭으로 열어 기존 기본정보 생성 흐름을 사용한 뒤 다시 조회한다. 이름/전화/원생번호로 자동 생성하거나 동일인을 추정하지 않는다. 등록 원문·이름·전화는 링크 query에 넣지 않는다.
- 연결은 원래 task/generation/revision, 선택 UUID, bare UUID 요청 키를 사용한다. 임시 parentPhone은 snapshot 복사에서 null로 제거한다. 동기 intent 가드로 중복 클릭·확인된 성공 뒤 재실행을 막고, 불확실한 실패는 같은 입력/키로 수동 재시도한다.
- task/generation/revision/viewer가 바뀌면 이전 선택·시도·응답을 소비하지 않는다. 검색은 popover를 열 때만 시작하고 debounce/abort/응답 소유권을 검사한다. 오류 재조회는 별도의 read epoch로 실제 다시 실행한다.
- 서버는 binding 결과의 taskId/studentId/changed를 필수로 요구하고 요청 UUID·contactState UUID·세대·새 revision과 대조한다. binding 응답은 이 필드와 parentPhone:null인 metadata만 반환한다. 클라이언트도 phase·세대·현재 과목·commonRevision을 검증한 뒤 캐시를 갱신한다.
- 확인된 연결을 상세 metadata와 task DTO에 반영한 뒤 재조회한다. 재조회 실패에는 저장된 UUID를 유지하고 다시 mutation을 보내지 않는다. 이미 연결된 다른 UUID로 변경하지 않는다. 종결된 사건의 명시 UUID 연결은 사건을 재개하거나 연락처를 복원하지 않는다.

## 실패와 미실행을 구분한다

| 검증 | 상태 | 의미 |
| --- | --- | --- |
| Node/mock·mounted 화면·전체 tsc·lint | 실행·통과 | 실제 서비스/controller/UI 소비자를 합성 I/O로 검증한다. |
| Free-tier 전체 candidate 검사 | 실행·실패 3건 | `submitContactCommand`, `readBundleContactFence`, `readBundleSource`의 `rpc_page_limit_missing`. 실제 과다조회의 증거는 아니며, 최종 DB에서 검증된 비페이지형 계약이 미등록이다. |
| SQL 설치·pgTAP·정확 SQLSTATE·ACL/RLS·rollback·두 세션 경합 | 미실행 | 격리 DB 재생성이 자동 승인 검토에서 실행 전에 거절됐다. 추가 재시도·우회·운영 DB 대체는0이다. |
| 운영 적용·고객 발송·과거 원문 삭제 | 미실행0 | 이 소스 후보는 운영 개선 완료가 아니다. |

DB 검증이 없는 상태에서 가짜 `p_limit`, 검사기/부채 예외 추가, 호출 은폐로 세 실패를 없애지 않았다. 각 실행의 정확한 수와 source SHA, 브라우저 화면은 전달 패키지 `validation-manifest.json`·`evidence/`에 기록한다. 겹치는 suite 수는 합산하지 않는다.

## 남은 설치·운영 조건

기존 numbered reader SQL은 연락처 JSON을 포함한다. 소비자의 DTO 재projection만으로 HTTP 응답 원문 전송을 막지 못하므로 `student-contact-reader-minimization-draft.sql`의 최종 ordered reader 교체를 함께 설치·검증해야 한다. 새 mutation RPC ACL은 withheld이며 client/server/reader/lifecycle/UUID/fence를 함께 cutover하기 전 배포하면 업무가 막힐 수 있다.

SQL 실행 승인 전에는 설치·SQLSTATE·권한·경합 통과를 표시하지 않는다. 과거 사본·직접 Data API의 원문/UUID 권한·자유 메모·백업 삭제, 별도 transfer 작업과의 최종 함수/잠금 통합, 정확한 dashboard 배포 SHA는 기존 인계 문서의 미결 범위를 따른다. 따라서 **학생 연결 UI 미구현은 소스 수준에서 해소했지만 운영 적용 불가 상태는 유지한다.**
