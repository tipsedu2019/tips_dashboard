'use client';
import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableHeader } from '@/components/ui/table';
import { ActionFeedback } from '@/components/ui/action-feedback';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { DATA_TABLE_LAYOUT_CLASS_NAME, DATA_TABLE_MOBILE_LIST_CLASS_NAME, DATA_TABLE_MOBILE_ITEM_CLASS_NAME, DATA_TABLE_PAGER_CLASS_NAME, DataTableWorkspaceToolbar, DataTableReadFeedback, DataTableFilters, DataTableViewport, DataTableHeaderRow, DataTableHeaderCell, DataTableBodyRow, DataTableBodyCell } from '@/components/data-table/data-table-surface';
import { useDataTablePageSize } from '@/hooks/use-data-table-page-size';
import { useDraftNavigation } from '@/hooks/use-draft-navigation';
import { AI_REQUEST_STATUSES, type AiRequestListQuery } from './ai-agent-request-contract';
import { type AiRequestActor } from './ai-agent-request-access';
import { useAiAgentRequestActorBoundary, useAiAgentRequestService, useAiAgentRequests, type AiRequestBoundary } from './use-ai-agent-requests';
import { AiAgentRequestCreateDialog } from './ai-agent-request-create-dialog';

export const AI_REQUEST_STATUS_LABELS={pending:'대기',processing:'처리 중',question:'답변 필요',done:'완료',cancelled:'취소'};
export const aiRequestDate=(value:string)=>new Intl.DateTimeFormat('ko-KR',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Seoul'}).format(new Date(value));
export function AiAgentRequestWorkspace(){
  const boundary=useAiAgentRequestActorBoundary();
  if(boundary.loading)return <p role="status">권한 확인 중…</p>;
  if(!boundary.actor)return <p role="alert">AI 요청에 접근할 권한이 없습니다.</p>;
  return <RequestWorkspace key={`${boundary.actor.userId}:${boundary.actor.role}:${boundary.recoveryRevision}`} actor={boundary.actor} boundary={boundary}/>;
}
function RequestWorkspace({actor,boundary}:{actor:AiRequestActor;boundary:AiRequestBoundary}){
  const service=useAiAgentRequestService(boundary,actor);
  const {pageSize,ready,setPreference}=useDataTablePageSize('ai-agent:requests');
  const [page,setPage]=useState(1);const [scope,setScope]=useState<'own'|'all'>('own');const [status,setStatus]=useState<AiRequestListQuery['status']>();const [search,setSearch]=useState('');
  const [open,setOpen]=useState(false);const [dirty,setDirty]=useState(false);const [message,setMessage]=useState('');
  const createRef=useRef<HTMLButtonElement>(null);const searchRef=useRef<HTMLInputElement>(null);
  const {snapshot,retry}=useAiAgentRequests({service,page,pageSize,scope,status,search,ready});
  const draft=useDraftNavigation({dirty});const onDirtyChange=useCallback((value:boolean)=>setDirty(value),[]);
  const rows=snapshot.rows;
  return <div className="mx-auto w-full min-w-0 max-w-[1560px] space-y-4 px-4 sm:px-5 lg:px-6">
    <div className={DATA_TABLE_LAYOUT_CLASS_NAME}>
      <DataTableWorkspaceToolbar search={<Input ref={searchRef} type="search" aria-label="AI 요청 검색" placeholder="제목 검색" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} maxLength={200}/>} actions={<><Button variant="outline" onClick={()=>void retry()} disabled={snapshot.loading} aria-label="AI 요청 새로고침"><RefreshCw/>새로고침</Button><Button ref={createRef} onClick={()=>setOpen(true)}><Plus/>요청 작성</Button></>} feedback={snapshot.error?<DataTableReadFeedback label="조회 실패" message="AI 요청을 불러오지 못했습니다." retryLabel="AI 요청 다시 조회" onRetry={retry} returnFocusRef={searchRef}/>:undefined} filters={<DataTableFilters>
        {boundary.access.canViewAll?<div className="grid gap-1.5"><Label htmlFor="ai-request-scope">요청 범위</Label><NativeSelect id="ai-request-scope" value={scope} onChange={event=>{setScope(event.target.value as 'own'|'all');setPage(1);}}><option value="own">내 요청</option><option value="all">전체 요청</option></NativeSelect></div>:null}
        <div className="grid gap-1.5"><Label htmlFor="ai-request-status">상태</Label><NativeSelect id="ai-request-status" value={status??''} onChange={event=>{setStatus(event.target.value as AiRequestListQuery['status']||undefined);setPage(1);}}><option value="">전체 상태</option>{AI_REQUEST_STATUSES.map(value=><option key={value} value={value}>{AI_REQUEST_STATUS_LABELS[value]}</option>)}</NativeSelect></div>
      </DataTableFilters>}/>
      <DataTableViewport className="hidden md:block [&>[data-slot=table-container]]:overflow-visible" role="region" aria-label="AI 요청 목록 스크롤" tabIndex={0} aria-busy={snapshot.loading}><Table className="min-w-[720px] table-fixed"><TableHeader><DataTableHeaderRow>{['제목','상태','요청자','생성일','수정일'].map((label,index)=><DataTableHeaderCell key={label} className={index===0?'w-[38%]':undefined}>{label}</DataTableHeaderCell>)}</DataTableHeaderRow></TableHeader><TableBody>
        {rows.map(row=><DataTableBodyRow key={row.id}><DataTableBodyCell wrap><Link prefetch={false} href={`/admin/ai-agent/${row.id}`} className="font-semibold hover:underline">{row.title}</Link></DataTableBodyCell><DataTableBodyCell>{AI_REQUEST_STATUS_LABELS[row.status]}</DataTableBodyCell><DataTableBodyCell wrap>{row.requesterName??'이름 없음'}</DataTableBodyCell><DataTableBodyCell wrap><time dateTime={row.createdAt}>{aiRequestDate(row.createdAt)}</time></DataTableBodyCell><DataTableBodyCell wrap><time dateTime={row.updatedAt}>{aiRequestDate(row.updatedAt)}</time></DataTableBodyCell></DataTableBodyRow>)}
        {!rows.length?<DataTableBodyRow><DataTableBodyCell colSpan={5} className="h-24 text-center text-muted-foreground">{snapshot.loading?'불러오는 중…':snapshot.error?'목록을 확인할 수 없습니다.':search||status?'검색 결과가 없습니다.':'AI 요청이 없습니다.'}</DataTableBodyCell></DataTableBodyRow>:null}
      </TableBody></Table></DataTableViewport>
      <div className={DATA_TABLE_MOBILE_LIST_CLASS_NAME} aria-busy={snapshot.loading}>{rows.map(row=><div key={row.id} className={DATA_TABLE_MOBILE_ITEM_CLASS_NAME}><Link prefetch={false} href={`/admin/ai-agent/${row.id}`} className="break-words font-semibold hover:underline">{row.title}</Link><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm"><span>{AI_REQUEST_STATUS_LABELS[row.status]}</span><span className="text-muted-foreground">{row.requesterName??'이름 없음'}</span><time dateTime={row.createdAt} className="text-muted-foreground">생성일 {aiRequestDate(row.createdAt)}</time><time dateTime={row.updatedAt} className="text-muted-foreground">수정일 {aiRequestDate(row.updatedAt)}</time></div></div>)}{!rows.length?<p className="py-6 text-center text-sm text-muted-foreground">{snapshot.loading?'불러오는 중…':snapshot.error?'목록을 확인할 수 없습니다.':'AI 요청이 없습니다.'}</p>:null}</div>
      <div className={DATA_TABLE_PAGER_CLASS_NAME}><div className="w-full"><DataTablePagination page={snapshot.page} pageSize={pageSize} totalCount={snapshot.error?null:snapshot.totalCount} loading={snapshot.loading} onPageChange={setPage} onPageSizeChange={value=>{setPreference(value);setPage(1);}} ariaLabel="AI 요청 페이지"/></div></div>
    </div>
    {message?<ActionFeedback message={message} onDismiss={()=>setMessage('')}/>:null}
    <AiAgentRequestCreateDialog open={open} onOpenChange={setOpen} service={service} requesterName={boundary.requesterName} returnFocusRef={createRef} onDirtyChange={onDirtyChange} onSaved={()=>{if(service.active()){setMessage('요청을 저장했습니다.');void retry();}}}/>
    {draft.confirmation}
  </div>;
}
