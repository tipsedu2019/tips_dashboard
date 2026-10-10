"use client";
import { Checkbox } from "@/components/ui/checkbox";
import { API_FEATURES, PERSONAL_FEATURES, featureCanSelect } from "./feature-registry";

export function FeatureChecklist({ value, onChange, classCount, schoolCount, disabled = false }: {
  value: string[]; onChange: (value: string[]) => void; classCount: number; schoolCount: number; disabled?: boolean;
}) {
  return <fieldset className="space-y-3" aria-label="연결별 기능 권한" disabled={disabled}>
    <legend className="text-sm font-medium">허용할 API 기능</legend>
    <p className="text-sm text-muted-foreground">체크한 기능만 허용됩니다. 새 기능은 자동 허용되지 않습니다.</p>
    {PERSONAL_FEATURES.map(feature => <label key={feature.id} className="flex items-start gap-2 text-sm">
      <Checkbox aria-label={feature.title} checked={value.includes(feature.id)} disabled={disabled || !value.includes(feature.id) && !featureCanSelect(feature.id, classCount, schoolCount)}
        onCheckedChange={checked => onChange(checked === true ? [...value, feature.id] : value.filter(id => id !== feature.id))} />
      <span>{feature.title}<span className="block text-xs text-muted-foreground">조회 · {feature.personal?.target === "classes" ? "선택한 담당 수업" : "선택한 학교"}{!featureCanSelect(feature.id, classCount, schoolCount) ? " 선택 필요" : ""}</span></span>
    </label>)}
    <details className="text-sm"><summary className="cursor-pointer">개인 연결에서 지원하지 않는 기능</summary>
      <ul className="mt-2 space-y-2">{API_FEATURES.filter(feature => !feature.personal).map(feature => <li key={feature.id}>{feature.title} · {feature.surface === "internal" ? "내부 전용" : feature.mode === "write" ? "변경 · 관리자 발급 키 전용" : "조회 · 관리자 발급 키 전용"}</li>)}</ul>
    </details>
  </fieldset>;
}
