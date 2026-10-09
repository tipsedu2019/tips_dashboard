import Link from "next/link";
import { SettingsWorkspaceShell, SettingsTableFrame, settingsTableCellClass, settingsTableHeadClass } from "@/features/management/settings-master-layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const PERSONAL_READ_FEATURES = [
  { name: "담당 수업 일정", path: "GET /api/v2/classes/{classId}?from=YYYY-MM-DD&to=YYYY-MM-DD", detail: "직접 선택한 수업 중 현재 본인이 담당하는 수업의 기본 정보·시간표·회차" },
  { name: "허용 학교 목록", path: "GET /api/v2/calendar/schools?search=&page=1", detail: "연결에 직접 선택한 학교 목록" },
  { name: "학교 학사일정", path: "GET /api/v2/calendar/schools/{schoolId}?schoolYear=YYYY", detail: "직접 선택한 학교의 학년도별 학사일정" },
] as const;

export function PersonalConnectionSupport() {
  return <SettingsWorkspaceShell>
    <p className="text-sm">교사 본인의 담당 수업과 선택한 학교를 읽는 연결입니다.</p>
    <SettingsTableFrame><Table className="min-w-[320px] table-fixed">
      <TableHeader><TableRow><TableHead className={`${settingsTableHeadClass} w-[32%]`}>지원 기능</TableHead><TableHead className={settingsTableHeadClass}>읽을 수 있는 범위</TableHead></TableRow></TableHeader>
      <TableBody>{PERSONAL_READ_FEATURES.map(feature => <TableRow key={feature.name}><TableCell className={`${settingsTableCellClass} whitespace-normal align-top`}>{feature.name}</TableCell><TableCell className={`${settingsTableCellClass} whitespace-normal`}>{feature.detail}</TableCell></TableRow>)}</TableBody>
    </Table></SettingsTableFrame>
    <p className="text-sm text-muted-foreground">학생 명단·연락처·수강료 조회, 업무 수정·승인·발송은 지원하지 않습니다. 담당 배정이나 연결 권한이 바뀌면 다음 조회부터 다시 확인합니다.</p>
  </SettingsWorkspaceShell>;
}

export function PersonalConnectionGuide() {
  return <SettingsWorkspaceShell className="gap-6">
    <section className="space-y-2" aria-labelledby="personal-steps"><h2 id="personal-steps" className="text-base font-semibold">개인 연결 방법</h2>
      <p className="text-sm">연결 키 탭에서 개인 읽기 연결을 만듭니다.</p>
      <ol className="list-decimal space-y-2 pl-5 text-sm"><li>연결 이름과 사용 목적, 만료, 허용 수업·학교를 직접 선택하고 확인합니다.</li><li>발급 직후 한 번만 표시되는 키를 본인이 사용할 에이전트의 보안 입력란에 직접 넣습니다. 채팅·공유 문서에 붙여 넣지 마세요.</li><li>아래의 허용된 조회로 연결을 확인합니다. 연결 목록에서 만료를 확인하고 사용을 마치면 해당 키를 폐기합니다.</li></ol>
      <p className="text-sm text-muted-foreground">키는 자동 복사·전송하지 않습니다. 창을 닫으면 다시 표시할 수 없습니다.</p>
    </section>
    <section className="space-y-3" aria-labelledby="personal-get"><h2 id="personal-get" className="text-base font-semibold">사용할 수 있는 조회 3개</h2>
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
