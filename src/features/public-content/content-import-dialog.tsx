"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  importTemplate,
  parseDelimited,
  readSpreadsheet,
  reviewImport,
} from "./content-import";
import {
  KIND_LABELS,
  type ContentDraft,
  type ContentKind,
} from "./content-contract";
export function ContentImportDialog({
  kind,
  onClose,
  onReview,
  onReturnFocus,
}: {
  kind: ContentKind;
  onClose: () => void;
  onReturnFocus: () => void;
  onReview: (entries: ContentDraft[]) => void;
}) {
  const [text, setText] = useState(""),
    [rows, setRows] = useState<string[][] | null>(null),
    [fileName, setFileName] = useState(""),
    [errors, setErrors] = useState<string[]>([]),
    [reading, setReading] = useState(false);
  async function file(file?: File) {
    if (!file) return;
    setReading(true);
    setErrors([]);
    setRows(null);
    try {
      setRows(await readSpreadsheet(file));
      setFileName(file.name);
      setText("");
    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : "파일을 읽지 못했습니다.",
      ]);
    } finally {
      setReading(false);
    }
  }
  function review() {
    try {
      const result = reviewImport(kind, rows || parseDelimited(text));
      if (result.errors.length) {
        setErrors(
          result.errors.map((error) => `${error.row}행 · ${error.message}`),
        );
        return;
      }
      onReview(result.entries);
    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : "자료를 확인해 주세요.",
      ]);
    }
  }
  function template() {
    const url = URL.createObjectURL(
      new Blob([importTemplate(kind)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${KIND_LABELS[kind]}-가져오기.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !reading) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{KIND_LABELS[kind]} 한 번에 가져오기</DialogTitle>
          <DialogDescription>
            파일 또는 엑셀에서 복사한 표를 넣고, 다음 화면에서 공개 내용을
            확인합니다. 초안을 기본으로, 모두 공개할지도 선택할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="min-w-0 flex-1 text-sm font-medium">
              CSV · TSV · XLSX
              <Input
                className="mt-2"
                type="file"
                accept=".csv,.tsv,.xlsx"
                disabled={reading}
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  event.target.value = "";
                  void file(selected);
                }}
              />
            </label>
            <Button className="mt-6" variant="outline" onClick={template}>
              양식 받기
            </Button>
          </div>
          {fileName && rows && (
            <p role="status" className="text-sm text-muted-foreground">
              {fileName} · {Math.max(0, rows.length - 1)}행
            </p>
          )}
          <label className="block text-sm font-medium">
            표 붙여넣기
            <Textarea
              className="mt-2 min-h-48 font-mono text-xs"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setRows(null);
                setFileName("");
                setErrors([]);
              }}
              placeholder="첫 줄의 항목 이름과 함께 붙여넣어 주세요."
              disabled={reading}
            />
          </label>
          {errors.length > 0 && (
            <div
              role="alert"
              className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              <p className="font-medium">
                모든 오류를 수정한 뒤 다시 검토해 주세요.
              </p>
              {errors.map((error, index) => (
                <p key={index}>{error}</p>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={reading}>
            취소
          </Button>
          <Button
            onClick={review}
            disabled={reading || (!rows && !text.trim())}
          >
            {reading ? "파일 읽는 중…" : "내용 검토"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
