import Link from "next/link";
import { SettingsWorkspaceShell } from "@/features/management/settings-master-layout";
import { PERSONAL_FEATURES } from "./feature-registry";
import { ApiFeatureCatalog } from "./feature-catalog";

const PERSONAL_READ_FEATURES = PERSONAL_FEATURES.map(feature => ({ name: feature.title, path: `GET /api/v2${feature.endpoint!.path}` }));
export function PersonalConnectionSupport() {
  return <SettingsWorkspaceShell><ApiFeatureCatalog /><p className="text-sm text-muted-foreground">개인 연결은 본인의 현재 담당 배정과 선택한 기능·수업·학교를 매 요청마다 확인합니다. 학생 명단·연락처·수강료·업무 변경·발송은 지원하지 않습니다.</p></SettingsWorkspaceShell>;
}

export function PersonalConnectionGuide() {
  return <SettingsWorkspaceShell className="gap-6">
    <section className="space-y-2" aria-labelledby="personal-steps"><h2 id="personal-steps" className="text-base font-semibold">개인 연결 방법</h2>
      <p className="text-sm">연결 키 탭에서 개인 읽기 연결을 만듭니다.</p>
      <ol className="list-decimal space-y-2 pl-5 text-sm"><li>연결 이름과 사용 목적, 만료, 허용 수업·학교와 API 기능을 직접 선택하고 확인합니다.</li><li>발급 직후 한 번만 표시되는 키를 본인이 사용할 에이전트의 보안 입력란에 직접 넣습니다. 채팅·공유 문서에 붙여 넣지 마세요.</li><li>아래의 허용된 조회로 연결을 확인합니다. 연결 목록의 기능 관리에서 허용 체크를 변경·저장할 수 있습니다. 저장 완료 이후의 요청부터 적용하며, 진행 중인 조회는 먼저 끝날 수 있습니다. 만료를 확인하고 사용을 마치면 해당 키를 폐기합니다.</li></ol>
      <p className="text-sm text-muted-foreground">키는 자동 복사·전송하지 않습니다. 창을 닫으면 다시 표시할 수 없습니다.</p>
    </section>
    <section className="space-y-3" aria-labelledby="personal-get"><h2 id="personal-get" className="text-base font-semibold">개인 연결에서 선택 가능한 조회 {PERSONAL_FEATURES.length}개</h2>
      {PERSONAL_READ_FEATURES.map(feature => <div key={feature.name}><p className="text-sm font-medium">{feature.name}</p><code className="block break-all text-xs">{feature.path}</code></div>)}
      <p className="text-sm text-muted-foreground">연결 확인용 health와 전체 수업 검색은 지원하지 않습니다. 연결 목록에 표시된 수업·학교 ID를 사용합니다. 요청 헤더에 Authorization: Bearer &lt;개인 연결 키&gt;를 넣습니다. API 명세는 키를 넣지 않고 열 수 있습니다.</p>
      <Link prefetch={false} href="/api/v2/openapi" className="text-sm underline underline-offset-4">API 명세 보기</Link>
    </section>
    <section className="space-y-2" aria-labelledby="personal-errors"><h2 id="personal-errors" className="text-base font-semibold">연결이 되지 않을 때</h2>
      <dl className="space-y-3 text-sm"><div><dt className="font-medium">401 · 인증 실패</dt><dd>만료되거나 폐기된 키인지 확인하세요. 키를 오류 보고에 넣지 마세요.</dd></div><div><dt className="font-medium">403 · 허용되지 않은 범위</dt><dd>본인 담당 배정과 선택한 수업·학교, 지원되는 조회인지 확인하세요. 다른 사람의 키로 우회하지 마세요.</dd></div><div><dt className="font-medium">404 · 대상 없음</dt><dd>선택한 정확한 ID인지 확인한 뒤 중단하세요.</dd></div><div><dt className="font-medium">429·503 · 일시적인 조회 실패</dt><dd>잠시 후 같은 조회만 다시 시도할 수 있습니다. 키 발급·폐기 중 연결이 끊겼다면 새 요청을 만들지 말고 기존 처리 결과부터 확인하세요.</dd></div></dl>
      <p className="text-sm text-muted-foreground">도움을 요청할 때는 오류 코드와 발생 시각만 전달하세요. 키 원문·학생 정보·전체 응답은 보내지 마세요.</p>
    </section>
  </SettingsWorkspaceShell>;
}
