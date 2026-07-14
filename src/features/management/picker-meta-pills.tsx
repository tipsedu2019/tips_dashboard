import { cn } from "@/lib/utils";

export type PickerMetaItem = {
  key: string;
  value: unknown;
  tone?: "default" | "primary";
};

function text(value: unknown) {
  return String(value || "").trim();
}

export function PickerMetaPills({
  items,
  className,
}: {
  items: PickerMetaItem[];
  className?: string;
}) {
  const visibleItems = items
    .map((item) => ({ ...item, value: text(item.value) }))
    .filter((item) => item.value);

  if (visibleItems.length === 0) return null;

  return (
    <div className={cn("flex min-w-0 flex-wrap gap-1", className)}>
      {visibleItems.map((item) => (
        <span
          key={item.key}
          className={cn(
            "max-w-full rounded-full border bg-muted/60 px-2 py-0.5 text-[11px] leading-4 text-muted-foreground",
            item.tone === "primary" && "border-primary/20 bg-primary/10 text-primary",
          )}
        >
          {item.value}
        </span>
      ))}
    </div>
  );
}
