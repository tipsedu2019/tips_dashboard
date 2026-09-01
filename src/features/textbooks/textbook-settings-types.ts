import type { NumberedPage } from "@/lib/numbered-pagination";
import type { PageRequest } from "./textbook-read-types";

export type SettingFilters = { search: string };
export type SettingPageRequest = PageRequest<SettingFilters, "name"> & { draft: OwnerDraft | null };
export type OwnerCounts = { publishers: number; suppliers: number };
export type OwnerDraftOperation =
  | { type: "publisher.add"; id: string; name: string; subjects: string[]; supplierIds: string[] }
  | { type: "publisher.patch"; id: string; patch: Partial<Pick<PublisherDraftFields, "name" | "subjects" | "supplierIds">> }
  | { type: "publisher.delete"; id: string }
  | { type: "supplier.add"; id: string; name: string; contact: string; memo: string }
  | { type: "supplier.patch"; id: string; patch: Partial<Pick<SupplierDraftFields, "name" | "contact" | "memo">> }
  | { type: "supplier.delete"; id: string };

export type OwnerDraft = { version: 1; baseRevision: string; operations: OwnerDraftOperation[] };
export type PublisherDraftFields = { name: string; subjects: string[]; supplierIds: string[] };
export type SupplierDraftFields = { name: string; contact: string; memo: string };
export type SupplierSettingOption = { id: string; name: string };
export type PublisherSettingRow = { id: string; name: string; subjects: string[]; suppliers: SupplierSettingOption[]; textbookCount: number; isNew: boolean };
export type SupplierSettingRow = SupplierDraftFields & { id: string; linkedPublisherCount: number; linkedPublisherNames: string[]; isNew: boolean };
export type OwnerSettingsPage<T> = NumberedPage<T> & { baseRevision: string; ownerCounts: OwnerCounts };
export type OwnerSettingsDetail<T> = { row: T | null; baseRevision: string; ownerCounts: OwnerCounts };
export type SaveTextbookSettingsDraftRequest = { requestId: string; draft: { version: 1; owners: OwnerDraft | null; subSubjects: null } };
export type SaveTextbookSettingsDraftResult = {
  requestId: string;
  owners: {
    baseRevision: string; newRevision: string;
    changedPublisherIds: string[]; deletedPublisherIds: string[];
    changedSupplierIds: string[]; deletedSupplierIds: string[];
    changedLinkPublisherIds: string[];
  };
  subSubjects: null;
};
