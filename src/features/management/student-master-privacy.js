const STUDENT_CONTACT_FIELDS = new Set([
  "contact", "parent_contact", "parentContact", "phone", "student_contact",
  "studentContact", "student_phone", "studentPhone", "parent_phone", "parentPhone",
  "guardian_contact", "guardianContact", "guardian_phone", "guardianPhone",
]);

export const STUDENT_MASTER_READ_COLUMNS = "id,name,uid,school,grade,enroll_date,status,class_ids,waitlist_class_ids,created_at,updated_at";
const STUDENT_MASTER_READ_FIELDS = STUDENT_MASTER_READ_COLUMNS.split(",");

export function projectStudentMasterRecord(record = {}, extraFields = []) {
  return Object.fromEntries([...STUDENT_MASTER_READ_FIELDS, ...extraFields]
    .filter((key) => !STUDENT_CONTACT_FIELDS.has(key) && Object.prototype.hasOwnProperty.call(record, key))
    .map((key) => [key, record[key]]));
}

/** Drop contact fields from client projections; this never writes or clears DB values. */
export function omitStudentContactFields(record = {}) {
  return Object.fromEntries(Object.entries(record)
    .filter(([key]) => !STUDENT_CONTACT_FIELDS.has(key)));
}
