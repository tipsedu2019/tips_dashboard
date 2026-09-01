"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import {
  getTextbookClassReference,
  getTextbookLocationReference,
  getTextbookMasterOptions,
  listTextbookClassReferencePage,
  listTextbookLocationReferencePage,
  listTextbookReferencePage,
  listTextbookTeacherReferencePage,
  resolveTextbookReference,
} from "./textbook-reference-service"
import {
  checkTextbookMasterDuplicate,
  getTextbookClosingPreview,
  getTextbookInventoryBalance,
  getTextbookMasterDetail,
  getTextbookPurchaseDetail,
  getTextbookSaleDetail,
} from "./textbook-read-service"
import { getClassTextbookSaleContext } from "./textbook-work-context-service"
import type {
  ClassTextbookSaleContext,
  ClassTextbookSaleContextInput,
  ClosingPreviewInput,
  PageRequest,
  SearchSelectFilterGroup,
  SearchSelectOption,
  TextbookClassReferenceFilters,
  TextbookClassReferenceResult,
  TextbookClosingPreview,
  TextbookInventoryBalance,
  TextbookInventoryBalanceInput,
  TextbookLocationReferencePage,
  TextbookLocationReferenceResult,
  TextbookMasterDetail,
  TextbookMasterDuplicate,
  TextbookMasterDuplicateInput,
  TextbookMasterOptions,
  TextbookMasterOptionsInput,
  TextbookPurchaseDetail,
  TextbookPurchaseDetailInput,
  TextbookReferenceFacetPage,
  TextbookReferenceFilters,
  TextbookReferenceInput,
  TextbookReferenceResult,
  TextbookReferenceSearch,
  TextbookSaleDetail,
} from "./textbook-read-types"

type PickerEnable = { enabled: boolean }
type PickerPageSize = 10 | 15 | 20
type Reader<TInput, TValue> = (input: TInput, options: { signal: AbortSignal }) => Promise<TValue>

export type TextbookReferenceDataInput = {
  viewerId: string
  viewerRole: string
  authReady: boolean
  managementEnabled: boolean
  bookOptions?: PickerEnable | null
  classOptions?: PickerEnable | null
  teacherOptions?: PickerEnable | null
  locationOptions?: PickerEnable | null
  selectedBook?: TextbookReferenceInput | null
  selectedClassId?: string | null
  selectedLocationId?: string | null
  masterOptions?: TextbookMasterOptionsInput | null
  masterDetailId?: string | null
  purchaseDetailInput?: TextbookPurchaseDetailInput | null
  saleDetailId?: string | null
  masterDuplicateInput?: TextbookMasterDuplicateInput | null
  classSalePreviewInput?: ClassTextbookSaleContextInput | null
  teacherSaleBalanceInput?: TextbookInventoryBalanceInput | null
  purchaseBalanceInput?: TextbookInventoryBalanceInput | null
  closingPreviewInput?: ClosingPreviewInput | null
}

export type TextbookReferenceResource<TInput, TValue> = {
  value: TValue | null
  loading: boolean
  error: unknown
  acceptedInput: TInput | null
  retry: () => Promise<void>
}

type PickerResult = TextbookReferenceFacetPage | TextbookLocationReferencePage | {
  rows: SearchSelectOption[]; page: number; pageSize: number; totalCount: number
}

export type TextbookReferencePickerState = {
  rows: SearchSelectOption[]
  page: number
  pageSize: PickerPageSize
  totalCount: number | null
  search: string
  selectedFilters: Record<string, string[]>
  baseFilterGroups: SearchSelectFilterGroup[]
  visibleFilterGroups: SearchSelectFilterGroup[]
  activeFilterCount: number
  defaultLocation: TextbookLocationReferencePage["defaultLocation"] | null
  loading: boolean
  error: unknown
  acceptedInput: PageRequest<unknown, string> | null
  retry: () => Promise<void>
  goToPage: (page: number) => Promise<void>
  setPageSize: (pageSize: PickerPageSize) => void
  setSearch: (search: string) => void
  setSelectedFilters: (filters: Record<string, string[]>) => void
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function inputIdentity(value: unknown) {
  return value === null || value === undefined ? "" : JSON.stringify(value)
}

function useIndependentResource<TInput, TValue>(
  actorKey: string,
  input: TInput | null,
  reader: Reader<TInput, TValue>,
): TextbookReferenceResource<TInput, TValue> {
  const identity = inputIdentity(input)
  // Intentional structural memoization: callers build typed request objects during render.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const frozenInput = useMemo(() => input === null ? null : clone(input), [identity]) // eslint-disable-line react-hooks/exhaustive-deps
  const publishKey = actorKey && frozenInput !== null ? JSON.stringify([actorKey, identity]) : ""
  const [state, setState] = useState<Omit<TextbookReferenceResource<TInput, TValue>, "retry"> & { publishKey: string }>({
    value: null, loading: false, error: null, acceptedInput: null, publishKey: "",
  })
  const mounted = useRef(false)
  const active = useRef<AbortController | null>(null)
  const requestId = useRef(0)
  const current = useRef({ actorKey, identity, input: frozenInput })

  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestId.current += 1
      active.current?.abort()
    }
  }, [])

  useLayoutEffect(() => {
    current.current = { actorKey, identity, input: frozenInput }
  }, [actorKey, frozenInput, identity])

  const retry = useCallback(async () => {
    const expected = { actorKey, identity, input: frozenInput }
    if (!mounted.current || !expected.actorKey || !expected.identity || expected.input === null
      || current.current.actorKey !== actorKey || current.current.identity !== identity) return
    active.current?.abort()
    const abort = new AbortController()
    active.current = abort
    const id = requestId.current + 1
    requestId.current = id
    const accepted = clone(expected.input)
    const expectedPublishKey = JSON.stringify([expected.actorKey, expected.identity])
    const valid = () => mounted.current && !abort.signal.aborted && requestId.current === id
      && current.current.actorKey === expected.actorKey && current.current.identity === expected.identity
    setState({ value: null, loading: true, error: null, acceptedInput: null, publishKey: expectedPublishKey })
    try {
      const value = await reader(accepted, { signal: abort.signal })
      if (valid()) setState({ value, loading: false, error: null, acceptedInput: accepted, publishKey: expectedPublishKey })
    } catch (error) {
      if (valid()) setState({ value: null, loading: false, error, acceptedInput: null, publishKey: expectedPublishKey })
    }
  }, [actorKey, frozenInput, identity, reader])

  useEffect(() => {
    active.current?.abort()
    requestId.current += 1
    if (!actorKey || frozenInput === null) {
      // Disabled resources synchronously clear any value accepted for the former identity.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ value: null, loading: false, error: null, acceptedInput: null, publishKey: "" })
      return
    }
    let live = true
    queueMicrotask(() => { if (live) void retry() })
    return () => { live = false; active.current?.abort(); requestId.current += 1 }
  }, [actorKey, frozenInput, retry])

  if (state.publishKey !== publishKey) {
    return { value: null, loading: Boolean(publishKey), error: null, acceptedInput: null, retry }
  }
  return { value: state.value, loading: state.loading, error: state.error, acceptedInput: state.acceptedInput, retry }
}

function usePicker(
  actorKey: string,
  enabled: boolean,
  kind: "book" | "class" | "teacher" | "location",
): TextbookReferencePickerState {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeState] = useState<PickerPageSize>(20)
  const [search, setSearchState] = useState("")
  const [selectedFilters, setSelectedFiltersState] = useState<Record<string, string[]>>({})
  const filters = kind === "book" || kind === "class" ? { search, selectedFilters } : { search }
  const sort = kind === "book" ? "match-title" : kind === "location" ? "match-order" : "match-name"
  const request = enabled ? { filters, page, pageSize, sort } : null
  const reader = useCallback(async (next: PageRequest<unknown, string>, options: { signal: AbortSignal }) => {
    if (kind === "book") return listTextbookReferencePage(next as PageRequest<TextbookReferenceFilters, "match-title">, options)
    if (kind === "class") return listTextbookClassReferencePage(next as PageRequest<TextbookClassReferenceFilters, "match-name">, options)
    if (kind === "teacher") return listTextbookTeacherReferencePage(next as PageRequest<TextbookReferenceSearch, "match-name">, options)
    return listTextbookLocationReferencePage(next as PageRequest<TextbookReferenceSearch, "match-order">, options)
  }, [kind])
  const resource = useIndependentResource<PageRequest<unknown, string>, PickerResult>(actorKey, request as PageRequest<unknown, string> | null, reader)
  const result = resource.value
  const setSearch = useCallback((value: string) => { setSearchState(value); setPage(1) }, [])
  const setSelectedFilters = useCallback((value: Record<string, string[]>) => { setSelectedFiltersState(clone(value)); setPage(1) }, [])
  const setPageSize = useCallback((value: PickerPageSize) => { setPageSizeState(value); setPage(1) }, [])
  const goToPage = useCallback(async (value: number) => {
    if (!Number.isInteger(value) || value < 1) return
    setPage(value)
  }, [])
  return {
    rows: result?.rows || [], page, pageSize,
    totalCount: result?.totalCount ?? null, search, selectedFilters,
    baseFilterGroups: result && "baseFilterGroups" in result ? result.baseFilterGroups : [],
    visibleFilterGroups: result && "visibleFilterGroups" in result ? result.visibleFilterGroups : [],
    activeFilterCount: result && "activeFilterCount" in result ? result.activeFilterCount : 0,
    defaultLocation: result && "defaultLocation" in result ? result.defaultLocation : null,
    loading: resource.loading, error: resource.error, acceptedInput: resource.acceptedInput,
    retry: resource.retry, goToPage, setPageSize, setSearch, setSelectedFilters,
  }
}

const readSelectedClass: Reader<string, TextbookClassReferenceResult> = (id, options) => getTextbookClassReference(id, options)
const readSelectedLocation: Reader<string, TextbookLocationReferenceResult> = (id, options) => getTextbookLocationReference(id, options)
const readMasterDetail: Reader<string, TextbookMasterDetail> = (id, options) => getTextbookMasterDetail(id, options)
const readSaleDetail: Reader<string, TextbookSaleDetail> = (id, options) => getTextbookSaleDetail(id, options)

export function useTextbookReferenceData(input: TextbookReferenceDataInput) {
  const actorKey = input.authReady && input.viewerId.trim() && input.viewerRole.trim()
    ? JSON.stringify([input.viewerId, input.viewerRole]) : ""
  const managementActor = input.managementEnabled ? actorKey : ""
  const bookOptions = usePicker(actorKey, Boolean(input.bookOptions?.enabled), "book")
  const classOptions = usePicker(actorKey, Boolean(input.classOptions?.enabled), "class")
  const teacherOptions = usePicker(actorKey, Boolean(input.teacherOptions?.enabled), "teacher")
  const locationOptions = usePicker(actorKey, Boolean(input.locationOptions?.enabled), "location")
  const selectedBook = useIndependentResource<TextbookReferenceInput, TextbookReferenceResult>(actorKey, input.selectedBook || null, resolveTextbookReference)
  const selectedClass = useIndependentResource<string, TextbookClassReferenceResult>(actorKey, input.selectedClassId?.trim() || null, readSelectedClass)
  const selectedLocation = useIndependentResource<string, TextbookLocationReferenceResult>(actorKey, input.selectedLocationId?.trim() || null, readSelectedLocation)
  const masterOptions = useIndependentResource<TextbookMasterOptionsInput, TextbookMasterOptions>(managementActor, input.masterOptions || null, getTextbookMasterOptions)
  const masterDetail = useIndependentResource<string, TextbookMasterDetail>(managementActor, input.masterDetailId?.trim() || null, readMasterDetail)
  const purchaseDetail = useIndependentResource<TextbookPurchaseDetailInput, TextbookPurchaseDetail>(actorKey, input.purchaseDetailInput || null, getTextbookPurchaseDetail)
  const saleDetail = useIndependentResource<string, TextbookSaleDetail>(managementActor, input.saleDetailId?.trim() || null, readSaleDetail)
  const masterDuplicate = useIndependentResource<TextbookMasterDuplicateInput, TextbookMasterDuplicate>(managementActor, input.masterDuplicateInput || null, checkTextbookMasterDuplicate)
  const classSalePreview = useIndependentResource<ClassTextbookSaleContextInput, ClassTextbookSaleContext>(managementActor, input.classSalePreviewInput || null, getClassTextbookSaleContext)
  const teacherSaleBalance = useIndependentResource<TextbookInventoryBalanceInput, TextbookInventoryBalance>(managementActor, input.teacherSaleBalanceInput || null, getTextbookInventoryBalance)
  const purchaseBalance = useIndependentResource<TextbookInventoryBalanceInput, TextbookInventoryBalance>(managementActor, input.purchaseBalanceInput || null, getTextbookInventoryBalance)
  const closingPreview = useIndependentResource<ClosingPreviewInput, TextbookClosingPreview>(managementActor, input.closingPreviewInput || null, getTextbookClosingPreview)
  return {
    bookOptions, classOptions, teacherOptions, locationOptions, selectedBook, selectedClass, selectedLocation,
    masterOptions, masterDetail, purchaseDetail, saleDetail, masterDuplicate, classSalePreview,
    teacherSaleBalance, purchaseBalance, closingPreview,
  }
}
