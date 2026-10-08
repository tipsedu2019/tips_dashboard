'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogContent } from '@/components/ui/form-dialog';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { aiCreateRequestSchema, type AiCreateRequest, type AiRequest } from './ai-agent-request-contract';
import { type AiAgentRequestService, type AiSpaceCatalog, aiRequestErrorMessage } from './ai-agent-request-service';
import { readAiRequestDraft, writeAiRequestDraft, deleteAiRequestDraft, getAiRequestAttempt } from './ai-agent-request-recovery';
const empty: AiCreateRequest = { title: '', body: '', notifyOnDone: false };
export function AiAgentRequestCreateDialog({ open, onOpenChange, service, requesterName, returnFocusRef, onSaved, onDirtyChange }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    service: AiAgentRequestService;
    requesterName: string;
    returnFocusRef: React.RefObject<HTMLElement | null>;
    onSaved: (request: AiRequest) => void;
    onDirtyChange: (dirty: boolean) => void;
}) {
    const scope = 'create';
    const form = useForm<AiCreateRequest>({ defaultValues: readAiRequestDraft<AiCreateRequest>(service.actor, scope) ?? empty });
    const values = useWatch({ control: form.control });
    const [catalog, setCatalog] = useState<AiSpaceCatalog | null>(null);
    const [error, setError] = useState('');
    const attempt = getAiRequestAttempt<AiCreateRequest>(service.actor, scope);
    const busy = useSyncExternalStore(attempt.subscribe, () => attempt.busy, () => false);
    useEffect(() => form.subscribe({ formState: { values: true }, callback: ({ values }) => { if (service.active())
            writeAiRequestDraft(service.actor, scope, values); } }), [form, scope, service]);
    useEffect(() => { onDirtyChange(Boolean(values.title || values.body || values.notifyOnDone)); }, [values.title, values.body, values.notifyOnDone, onDirtyChange]);
    useEffect(() => { const controller = new AbortController(); void service.spaces(controller.signal).then(value => { if (service.active())
        setCatalog(value); }).catch(() => { }); return () => controller.abort(); }, [service]);
    const selectable = catalog?.items.filter(item => item.selectable && item.configured) ?? [];
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (attempt.busy || !service.active())
            return;
        const input = aiCreateRequestSchema.safeParse(form.getValues());
        form.clearErrors();
        if (!input.success) {
            for (const issue of input.error.issues) {
                const path = issue.path[0];
                if (path === 'title' || path === 'body')
                    form.setError(path, { message: '내용과 길이를 확인해 주세요.' });
            }
            setError('제목과 내용을 확인해 주세요.');
            return;
        }
        setError('');
        try {
            const outcome = await attempt.submit(input.data, (payload, key) => service.create(payload, key));
            if (!outcome || !service.active())
                return;
            const unchanged = JSON.stringify(form.getValues()) === JSON.stringify(outcome.submitted);
            if (unchanged) {
                form.reset(empty);
                deleteAiRequestDraft(service.actor, scope);
                onOpenChange(false);
            }
            onSaved(outcome.receipt);
        }
        catch (failure) {
            if (service.active())
                setError(aiRequestErrorMessage(failure));
        }
    };
    return <Dialog open={open} onOpenChange={onOpenChange}>
    <Form {...form}>
    <FormDialogContent title="요청 작성" description="현재 로그인한 계정으로 AI 작업을 요청합니다." onSubmit={submit} onCancel={() => onOpenChange(false)} cancelLabel="요청 작성 취소" submitLabel={attempt.pending ? '저장 결과 확인' : '요청 저장'} busy={busy} error={error} returnFocusRef={returnFocusRef}>
    <div className="grid gap-2">
    <Label htmlFor="ai-requester">요청자</Label>
    <Input id="ai-requester" name="requester" value={requesterName} readOnly/>
    </div>
    <FormField control={form.control} name="title" render={({ field }) => <FormItem>
        <FormLabel>제목</FormLabel>
        <FormControl>
        <Input {...field} maxLength={200} required/>
        </FormControl>
        <FormMessage />
        </FormItem>}/>
    <FormField control={form.control} name="body" render={({ field }) => <FormItem>
        <FormLabel>요청 내용</FormLabel>
        <FormControl>
        <Textarea {...field} rows={10} maxLength={20000} required/>
        </FormControl>
        <FormMessage />
        </FormItem>}/>
    <FormField control={form.control} name="notifyOnDone" render={({ field }) => <FormItem>
        <div className="flex items-center gap-2">
        <FormControl>
        <Checkbox checked={field.value} onCheckedChange={checked => { field.onChange(checked === true); if (!checked)
            form.setValue('notificationSpace', undefined); }} disabled={!selectable.length}/>
        </FormControl>
        <FormLabel>완료 시 Google Chat 알림</FormLabel>
        </div>
        <FormMessage />
        </FormItem>}/>
    {!selectable.length ? <p role="status" className="text-sm text-muted-foreground">선택할 수 있는 알림 공간이 없습니다.</p> : null}
    {values.notifyOnDone ? <FormField control={form.control} name="notificationSpace" render={({ field }) => <FormItem>
            <FormLabel>알림 공간</FormLabel>
            <Select value={field.value ?? ''} onValueChange={field.onChange}>
            <FormControl>
            <SelectTrigger>
            <SelectValue placeholder="알림 공간 선택"/>
            </SelectTrigger>
            </FormControl>
            <SelectContent>{selectable.map(item => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
            <FormMessage />
            </FormItem>}/> : null}
  </FormDialogContent>
    </Form>
    </Dialog>;
}
