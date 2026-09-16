/** Display only. Inputs, persistence, and contact actions retain their original value. */
export function formatStudentContact(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const original = String(value);
  return /^010\d{8}$/.test(original)
    ? original.replace(/^(010)(\d{4})(\d{4})$/, "$1-$2-$3")
    : original;
}

/** Only dial recognizable telephone values; descriptive contact notes remain text. */
export function getStudentContactHref(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  if (!/^\+?[\d ()-]+$/.test(text)) return undefined;
  const phone = text.replace(/[ ()-]/g, "");
  return /^\+?\d{7,15}$/.test(phone) ? `tel:${phone}` : undefined;
}
