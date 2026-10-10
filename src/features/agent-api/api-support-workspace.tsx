import Link from "next/link";
import { ApiFeatureCatalog } from "./feature-catalog";
import { SettingsMasterHeader, SettingsWorkspaceShell } from "@/features/management/settings-master-layout";

export function ApiSupportWorkspace({ apiEnabled }: { apiEnabled: boolean }) {
  return <SettingsWorkspaceShell>
    <SettingsMasterHeader filters={<span className="text-sm font-medium">API 기능 목록</span>} actions={<Link href="/api/v2/openapi" prefetch={false} className="text-sm hover:underline">API 명세</Link>} />
    {!apiEnabled ? <p role="status" className="text-sm text-muted-foreground">업무 API가 비활성화되어 있습니다.</p> : null}
    <ApiFeatureCatalog />
  </SettingsWorkspaceShell>;
}

export function ApiUsageGuide() {
  return <SettingsWorkspaceShell className="gap-6">
    <section className="space-y-2" aria-labelledby="api-connect-title">
      <h2 id="api-connect-title" className="text-base font-semibold">연결과 권한</h2>
      <p className="text-sm">연결 키 탭에서 기존 업무 API 키의 허용 작업·대상 수업·만료를 확인할 수 있습니다. 키는 비밀 저장소에 보관하고 채팅이나 공유 문서에 붙여 넣지 마세요.</p>
      <p className="text-sm text-muted-foreground">업무 연결 키, 개인 읽기 키, 이전 AI 요청 키는 서로 다른 권한입니다. 이전 AI 요청 키로 수업이나 학사일정을 수정할 수 없습니다.</p>
      <div className="flex flex-wrap gap-4 text-sm"><Link href="/api/v1/openapi" prefetch={false} className="hover:underline">수업 목록 API 명세</Link><Link href="/api/v2/openapi" prefetch={false} className="hover:underline">수업·학사일정 API 명세</Link></div>
    </section>
    <section className="space-y-2" aria-labelledby="api-result-title">
      <h2 id="api-result-title" className="text-base font-semibold">수정 결과 확인</h2>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>현재 내용을 조회하고 변경 미리보기에서 대상과 변경 내용을 확인합니다.</li>
        <li>요청 식별자와 제출 내용을 보존한 뒤 한 번 제출합니다.</li>
        <li>처리 결과를 조회하고 반영된 내용의 검증값과 실제 조회 결과를 비교합니다.</li>
      </ol>
      <p className="text-sm">시간 초과나 연결 끊김은 실패를 뜻하지 않습니다. 새 요청 식별자로 다시 제출하거나 같은 일을 화면에서 반복하지 말고, 먼저 기존 식별자로 처리 결과를 조회하세요. 결과가 미확정이면 중단하고 확인이 필요합니다.</p>
      <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">수업 결과: GET /api/v2/operations/&#123;requestKey&#125; · 학사일정 결과: GET /api/v2/calendar/operations/&#123;requestKey&#125;. HTTP 200만으로 완료를 판단하지 말고 applied·failed·unknown 상태와 결과 내용을 확인하세요. 401·403이면 중단합니다.</p>
    </section>
    <section className="space-y-2" aria-labelledby="api-history-title">
      <h2 id="api-history-title" className="text-base font-semibold">이전 요청 이력</h2>
      <p className="text-sm text-muted-foreground">기존 요청과 알림의 상세 링크는 읽기 전용으로 유지됩니다. 요청의 완료 표시가 업무 API의 반영 결과를 대신하지는 않습니다. 대시보드의 업무 완료 자동 알림은 알림 설정에서 관리합니다.</p>
      <Link href="/admin/ai-agent" prefetch={false} className="text-sm hover:underline">이전 요청 조회</Link>
    </section>
  </SettingsWorkspaceShell>;
}
