# 로컬 정적 검사 실행 순서

`scripts/run-release-static-checks.mjs`는 PR193 월 통합 후 검토했던 로컬 정적11명령을 보존하며, 빠른 실패 검사를 앞에서 실행한다. 전체 필수45검사 또는108SQL/27probe를 대신하는 실행기가 아니다. workflow·검사 assertion·migration·권한·배포 절차는 변경하지 않는다. PR193 기존 배포 후보도 변경하지 않는다.

기존 순서:

```text
affected-consumers → notification-catalog-bodies → types → combined-js-lint
→ build → squawk → migration-layout → domain-sqlstate
→ diff-check → query-exact-head → migration-exact-head
```

새 순서:

```text
diff-check → query-exact-head → migration-exact-head
→ migration-layout → domain-sqlstate → squawk
→ affected-consumers → notification-catalog-bodies → types → combined-js-lint → build
```

11개 명령의 roots/옵션은 그대로다. `migration-exact-head`는 `--review-head --require-final` plan이며 `--execute`/`--authorized`를 사용하지 않는다. EOF를 자동 수정하거나 실패한 검사를 생략하지 않는다. 다른 릴리스의 검사 범위를 자동 선정하는 도구는 아니며, 현재 고정된 두SQL/영향roots를 다른 변경에 근거 없이 적용하지 않는다.

## 실행 경계

- 커밋 전에는 working-tree diff/EOF와 필요한 SQL 정적 검사를 먼저 확인한다. 이 실행기는 **이미 확정한 clean commit**의 base/head를 받는다. 최종 커밋이 없는 상태에서 가상의 head로 gate를 통과시키지 않는다.
- 기존 설치 Node와 Squawk를 사용한다. 로컬 검증에 사용한 Node는22.18.0이다. Node는 실제 실행한 `process.execPath`를 사용하고 version/path를 영수증에 기록한다. toolchain이 달라졌다면 과거 결과를 동일 입력으로 재사용하지 않는다. 설치·업데이트는 하지 않는다.
- CLI 인수는 `--root`, `--base`, `--head`, `--output`, `--squawk`를 모두 명시한다. SHA는40자리, Squawk는 기존 절대 경로여야 한다.
- `--output`은 소스 밖의 **새** 디렉터리다. 기존 evidence 디렉터리를 재사용하거나 덮어쓰지 않는다.
- 각 명령 전 HEAD와 clean 상태를 확인하고, 마지막에 tracked 파일의 raw byte SHA와 HEAD를 다시 확인한다. 실행 중 checkout/commit/파일 변경이 생기면 완료로 판정하지 않는다.
- 자식 환경은 Node PATH·LANG/LC_ALL·telemetry 비활성화만 제공한다. 부모의 임의 환경/자격증명을 전달하지 않는다. Next와 Supabase telemetry를 모두 비활성화한다.
- 자식 `close`까지 기다리고 exit/signal과 로그 SHA를 기록한다. 실패 시 이후 명령을 실행하지 않는다. 시간 제한·사용자 중단 시 descendant 회수나 중단 후 자동 재개는 이번 범위가 아니다.

`inputs.json`, `invocation.json`, 단계별 `.log`, `steps.json`, 최종 `result.json`을 남긴다. HEAD 안정성과 파일 내용 안정성은 별도 필드다. 실패 전에 끝난 명령의 로그·실제 head/지문을 지우거나 후속 head에서 실행한 것처럼 고치지 않는다. 단, 기록 보존이 자동 재사용 승인을 뜻하지는 않는다. 다른 소스의 성공을 자동 skip/cache하는 기능도 없다.

## 좁은 경계 검증

```sh
node --test tests/release-static-preflight.test.mjs
```

실제 임시 Git 저장소의 EOF·HEAD·dirty/drift를 확인하며, 고비용11검사 경계는 더미 프로세스로 대체한다. 성공 시 명령/옵션11개 불변·순서, 실패 시 고비용 명령0회, 실패 전 근거 보존, 기존 evidence 보호, 실제 ENOENT 및 SIGTERM 자식 종료를 검증한다. 이 테스트 성공을 제품/DB/배포 성공으로 표현하지 않는다.
