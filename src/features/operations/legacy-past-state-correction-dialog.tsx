"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { createLegacyPastStateCorrectionAction, legacyPastStateCorrectionErrorMessage,
  type LegacyPastStateCorrectionInput, type LegacyPastStateCorrectionPreview,
  type LegacyPastStateCorrectionTarget } from "./legacy-past-state-correction";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  expectedPlan: Record<string, unknown>;
  target: LegacyPastStateCorrectionTarget;
  initialState: "active" | "exception";
  stateLocked: boolean;
  scopeKey: string;
  rpc: (name: string, parameters: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  isCurrent: () => boolean;
  onApplied: (input: LegacyPastStateCorrectionInput) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onReload: () => Promise<void>;
};

export function LegacyPastStateCorrectionDialog({ open, onOpenChange, classId, expectedPlan, target,
  initialState, stateLocked, scopeKey, rpc, isCurrent, onApplied, onDirtyChange, onReload }: Props) {
  const [state, setState] = useState(initialState);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<LegacyPastStateCorrectionPreview | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState<"preview" | "save" | "reload" | null>(null);
  const [error, setError] = useState("");
  const busyRef = useRef(false), activeRef = useRef(true);
  const editRevisionRef = useRef(0), lastOpenRef = useRef(open);
  if (lastOpenRef.current !== open) { lastOpenRef.current = open; editRevisionRef.current++; }
  const currentRef = useRef({ open, scopeKey, isCurrent });
  currentRef.current = { open, scopeKey, isCurrent };
  const errorRef = useRef<HTMLDivElement>(null);
  const action = useMemo(() => createLegacyPastStateCorrectionAction({ invoke: rpc }), [rpc]);
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);
  useEffect(() => { onDirtyChange(open && Boolean(reason.trim())); }, [onDirtyChange, open, reason]);
  useEffect(() => {
    if (!error || !open) return;
    errorRef.current?.scrollIntoView({ block: "nearest" });
    errorRef.current?.focus({ preventScroll: true });
  }, [error, open]);
  const value: LegacyPastStateCorrectionInput = { classId, expectedPlan, target, state, reason };
  const owned = () => activeRef.current && currentRef.current.scopeKey === scopeKey && currentRef.current.isCurrent();
  const accepts = () => owned() && currentRef.current.open;
  const invalidate = () => { editRevisionRef.current++; setPreview(null); setAcknowledge(false); setError(""); };
  const check = async () => {
    if (busyRef.current || !reason.trim() || !accepts()) return;
    const revision = editRevisionRef.current;
    busyRef.current = true; setBusy("preview"); setError(""); setPreview(null); setAcknowledge(false);
    try {
      const result = await action.preview(value);
      if (accepts() && editRevisionRef.current === revision) setPreview(result);
    } catch (failure) {
      if (accepts() && editRevisionRef.current === revision) setError(legacyPastStateCorrectionErrorMessage(failure));
    } finally {
      busyRef.current = false; if (owned()) setBusy(null);
    }
  };
  const save = async () => {
    if (busyRef.current || !preview || (preview.reviewRequired && !acknowledge) || !accepts()) return;
    busyRef.current = true; setBusy("save"); setError("");
    try {
      await action.save(value, preview, acknowledge);
      if (!accepts()) return;
      await onApplied(value);
      if (accepts()) { setReason(""); setPreview(null); setAcknowledge(false); onOpenChange(false); }
    } catch (failure) {
      if (accepts()) {
        setError(legacyPastStateCorrectionErrorMessage(failure, true));
        if ((failure as { code?: string })?.code === "23P01" || (failure as { code?: string })?.code === "P0001") setPreview(null);
      }
    } finally {
      busyRef.current = false; if (owned()) setBusy(null);
    }
  };
  const reload = async () => {
    if (busyRef.current || !accepts()) return;
    busyRef.current = true; setBusy("reload");
    try { await onReload(); }
    catch { if (accepts()) setError("회차를 다시 불러오지 못했습니다. 다시 불러오기를 눌러 주세요."); }
    finally { busyRef.current = false; if (owned()) setBusy(null); }
  };
  const currentLabel = target.currentState === "active" ? "정상" : target.currentState === "exception" ? "휴강" : "해제";
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent layer="nested" restoreFocusToOpener className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>과거 상태 정정</DialogTitle>
        <DialogDescription>{target.date} · 현재 {currentLabel}</DialogDescription>
      </DialogHeader>
      <div className="grid min-w-0 gap-4">
        <label className="grid gap-1.5 text-sm font-medium">
          <span>정정 상태</span>
          <NativeSelect aria-label={`${target.date} 정정 상태`} value={state} disabled={busy === "save" || busy === "reload" || stateLocked}
            onChange={event => { setState(event.target.value as "active" | "exception"); invalidate(); }}>
            <option value="active" disabled={target.currentState === "active"}>정상</option>
            <option value="exception" disabled={target.currentState === "exception"}>휴강</option>
          </NativeSelect>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          <span>정정 사유 *</span>
          <Textarea aria-label={`${target.date} 정정 사유`} value={reason} required maxLength={300} rows={3} disabled={busy === "save" || busy === "reload"}
            onChange={event => { setReason(event.target.value); invalidate(); }} />
        </label>
        {preview ? <div className="grid min-w-0 gap-3">
          <p className="text-sm">{target.date} · {currentLabel} → {state === "active" ? "정상" : "휴강"}</p>
          {preview.unknownOccupancyCount > 0 ? <>
            <Alert><AlertDescription className="min-w-0 break-words">시간·강사·강의실 정보가 부족한 일정 {preview.unknownOccupancyCount}건이 있습니다.</AlertDescription></Alert>
            <label className="flex min-w-0 items-start gap-2 text-sm">
              <Checkbox aria-label="확인이 필요한 일정 경고를 확인했습니다." checked={acknowledge} disabled={Boolean(busy)}
                onCheckedChange={checked => setAcknowledge(checked === true)} />
              <span className="min-w-0 break-words">확인이 필요한 일정 경고를 확인했습니다.</span>
            </label>
          </> : null}
        </div> : null}
        {error ? <Alert ref={errorRef} tabIndex={-1} variant="destructive">
          <AlertDescription className="min-w-0 break-words">{error}</AlertDescription>
        </Alert> : null}
      </div>
      <DialogFooter>
        <Button type="button" size="form" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
        {error ? <Button type="button" size="form" variant="outline" disabled={Boolean(busy)}
          onClick={() => void reload()}>회차 다시 불러오기</Button> : null}
        {preview ? <Button type="button" size="form" disabled={Boolean(busy) || (preview.reviewRequired && !acknowledge)}
          onClick={() => void save()}>{busy === "save" ? "상태 정정 저장 중" : "상태 정정 저장"}</Button>
          : <Button type="button" size="form" disabled={Boolean(busy) || !reason.trim() || state === target.currentState}
            onClick={() => void check()}>{busy === "preview" ? "정정 내용 확인 중" : "정정 내용 확인"}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
