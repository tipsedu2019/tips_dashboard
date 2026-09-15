# T18 통계 비교와 단위

재원 학생 명 / 수강 등록 건 / 운영 수업 개 / 수업당 평균 명으로 표시한다. 학생 분포는 학년 교육 순서와 학교 학생 수 내림차순·동률 한국어 숫자 정렬을 사용한다. 서버 key를 변환하지 않는다. 학교는 전체 학교 수와 상위 8개를 표시하며 모두 보기로 50개 등 나머지도 탐색할 수 있다. 두 학생 분포는 같은 최대값의 0 baseline 막대와 텍스트값을 사용한다. 막대는 기존 drilldown 버튼이며 학생/과목/부서/학년/학교/부모 key를 전달한다. 수업 그룹도 수업 수 기준 비교를 제공한다.

교재 수는 원본 visible_textbooks 행 수(종), 배정 여부는 수업 개수(개), 진도는 progress_logs 기록 수(건)로 분리한다. 검증 근거: 기존 metrics 테스트와 20260905123149 textbook 통계 정의. 재고 권수나 추세는 표시하지 않는다.

검증: workspace/interaction/drilldown/presentation/metrics 38개 통과. 0·invalid·동률·교육순서·50개 긴 학교명·key 보존·상위 8개와 전체 펼치기·수강 단위를 검증했다. 실제 브라우저는 T19 통합 기록으로 별도 보완한다. 운영 데이터/배포 검증 아님.

## 독립 리뷰 P2 보완

`foundation-feature-review.md`에서 막대 버튼의 aria-label이 보이는 숫자·단위를 덮는 문제를 확인했다. 학생 분포 버튼 이름에 실제 표시된 N명, 수업 그룹 버튼 이름에 N개를 포함했다. 실제 StatisticsDrilldown 렌더링을 사용한 테스트에서 0명·1,200명·12개와 해당 action 이름 및 보이는 값의 일치를 확인한다. workspace interaction/drilldown 10개와 변경 파일 focused ESLint 통과. 이 보완에서는 서버 build/restart 또는 별도 실제 보조기기 검증을 실행하지 않았다.
