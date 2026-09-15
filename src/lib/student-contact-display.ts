/** Display only. Inputs, persistence, and contact actions retain their original value. */
export function formatStudentContact(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const original = String(value);
  return /^010\d{8}$/.test(original)
    ? original.replace(/^(010)(\d{4})(\d{4})$/, "$1-$2-$3")
    : original;
}
