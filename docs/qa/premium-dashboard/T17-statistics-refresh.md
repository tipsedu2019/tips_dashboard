# T17 통계 갱신

동일 query/auth key에서 수락한 snapshot은 새로고침 중과 실패 후 유지한다. 마지막 갱신 시각, 작은 갱신 상태, 실패와 다시 시도를 함께 표시한다. 최초 조회에는 loading/error만 표시하며 다른 query/role/account의 snapshot은 기존 key guard가 즉시 숨긴다. 일정 충돌도 accepted snapshot이 있으면 기존 목록을 유지한다.

검증: statistics-snapshot-cache, statistics-workspace-interaction, statistics-resource-pressure 34개 및 실제 hook의 fetch/refresh500/query/role/logout 테스트 1개 통과. UI fixture와 실제 브라우저 검증은 후속 T18/T19 통합 기록에서 별도 보고한다. 운영 데이터 조회·API 변경·배포 없음.
