'use client';
import { Button } from '@/components/ui/button';
import type { TimetableControllerState } from './timetable-plan-model';

/** Pending intents remain recoverable even when their optimistic item is absent. */
export function TimetablePlanRecoveryActions({ operations, onResolve, onDiscard, onRetry }: {
    operations: TimetableControllerState['pendingOperations'];
    onResolve: (itemId: string, choice: 'accept_server' | 'reapply_draft') => void;
    onDiscard: (itemId: string) => void;
    onRetry: (itemId: string) => void;
}) {
    return operations.filter(entry => entry.failure).map(entry => <div key={entry.itemId} className="flex flex-wrap items-center gap-1" aria-label={`${entry.name} ${entry.operation === 'delete' ? '삭제' : '저장'} 복구`}>
        <span>{entry.name}{entry.operation === 'delete' ? ' · 삭제 요청' : ''}</span>
        {entry.failure === 'stale' ? <>
            <Button size="sm" variant="outline" onClick={() => onResolve(entry.itemId, 'accept_server')}>최신 내용 사용</Button>
            <Button size="sm" variant="outline" onClick={() => onResolve(entry.itemId, 'reapply_draft')}>{entry.operation === 'delete' ? '삭제 다시 적용' : '내 입력 다시 적용'}</Button>
        </> : entry.failure === 'rejected' ? <Button size="sm" variant="outline" onClick={() => onDiscard(entry.itemId)}>거절된 요청 버리기</Button>
            : <Button size="sm" variant="outline" onClick={() => onRetry(entry.itemId)}>원래 요청 재시도</Button>}
    </div>);
}
