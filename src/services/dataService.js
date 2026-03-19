import { supabase, supabaseConfigError } from '../lib/supabase';
import { computeClassStatus, normalizeClassStatus } from '../lib/classStatus';
import { normalizeClassroomText } from '../lib/classroomUtils';

const EMPTY_SNAPSHOT = {
  classes: [],
  classTerms: [],
  students: [],
  textbooks: [],
  progressLogs: [],
  academicEvents: [],
  academicSchools: [],
  teacherCatalogs: [],
  classroomCatalogs: [],
  academicCurriculumProfiles: [],
  academicSupplementMaterials: [],
  academicExamScopes: [],
  academicExamDays: [],
  academicEventExamDetails: [],
  academyCurriculumPlans: [],
  academyCurriculumMaterials: [],
  academicExamMaterialPlans: [],
  academicExamMaterialItems: [],
  academyCurriculumPeriodCatalogs: [],
  academyCurriculumPeriodPlans: [],
  academyCurriculumPeriodItems: [],
  isConnected: false,
  isLoading: false,
  lastUpdated: null,
  error: null
};

const SCHOOL_EXAM_PERIODS = [
  { code: 'S1_MID', label: '1학기 중간', sortOrder: 1 },
  { code: 'S1_FINAL', label: '1학기 기말', sortOrder: 2 },
  { code: 'S2_MID', label: '2학기 중간', sortOrder: 3 },
  { code: 'S2_FINAL', label: '2학기 기말', sortOrder: 4 },
];

function normalizeLegacyAcademyGradeLabel(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (normalized === 'elementary') return '초등';
  if (normalized === 'middle') return '중등';
  if (normalized === 'high') return '고등';
  return normalized;
}

function generateId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === 'x' ? random : (random & 0x3 | 0x8);
    return value.toString(16);
  });
}

function extractEmbeddedNoteMeta(note) {
  const marker = '[[TIPS_META]]';
  const raw = String(note || '');
  const markerIndex = raw.indexOf(marker);
  if (markerIndex < 0) {
    return {};
  }

  const encoded = raw.slice(markerIndex + marker.length).trim();
  try {
    return JSON.parse(encoded);
  } catch {
    return {};
  }
}

function stripEmbeddedNoteMeta(note) {
  const marker = '[[TIPS_META]]';
  const raw = String(note || '');
  const markerIndex = raw.indexOf(marker);
  return (markerIndex < 0 ? raw : raw.slice(0, markerIndex)).trim();
}

function appendEmbeddedNoteMeta(note, meta = {}) {
  const cleanedNote = stripEmbeddedNoteMeta(note);
  const compactMeta = Object.fromEntries(
    Object.entries(meta || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );

  if (Object.keys(compactMeta).length === 0) {
    return cleanedNote || null;
  }

  return `${cleanedNote ? `${cleanedNote}\n\n` : ''}[[TIPS_META]]${JSON.stringify(compactMeta)}`;
}

export class DataService {
  constructor() {
    this.listeners = new Set();
    this.channel = null;
    this.cachedData = { ...EMPTY_SNAPSHOT };
    this.deferredSnapshotPromise = null;
    this.notifyPromise = null;
    this.notifyQueued = false;
    this.realtimeNotifyTimer = null;
    this.hasDeferredSnapshot = false;
    this.isConnected = false;
    this.isLoading = false;
    this.lastUpdated = null;
    this.error = supabaseConfigError;

    if (supabase) {
      this._setupRealtime();
    }
  }

  _setupRealtime() {
    if (!supabase || this.channel) return;

    this.channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        this._scheduleRealtimeNotify();
      })
      .subscribe();
  }

  _scheduleRealtimeNotify(delay = 120) {
    if (this.realtimeNotifyTimer) {
      clearTimeout(this.realtimeNotifyTimer);
    }

    this.realtimeNotifyTimer = setTimeout(() => {
      this.realtimeNotifyTimer = null;
      this._notify();
    }, delay);
  }

  _snapshot(overrides = {}) {
    return {
      ...EMPTY_SNAPSHOT,
      ...this.cachedData,
      lastUpdated: this.lastUpdated,
      error: this.error,
      ...overrides
    };
  }

  _getCoreResources() {
    return [
      { key: 'classes', table: 'classes', processor: '_processClass' },
      { key: 'classTerms', table: 'class_terms', processor: '_processClassTerm', optional: true },
      { key: 'students', table: 'students', processor: '_processStudent' },
      { key: 'textbooks', table: 'textbooks', processor: '_processTextbook' },
      { key: 'progressLogs', table: 'progress_logs', processor: '_processProgressLog' }
    ];
  }

  _getDeferredResources() {
    return [
      { key: 'academicEvents', table: 'academic_events', processor: '_processAcademicEvent' },
      { key: 'academicSchools', table: 'academic_schools', processor: '_processAcademicSchool', optional: true },
      { key: 'teacherCatalogs', table: 'teacher_catalogs', processor: '_processTeacherCatalog', optional: true },
      { key: 'classroomCatalogs', table: 'classroom_catalogs', processor: '_processClassroomCatalog', optional: true },
      { key: 'academicCurriculumProfiles', table: 'academic_curriculum_profiles', processor: '_processAcademicCurriculumProfile', optional: true },
      { key: 'academicSupplementMaterials', table: 'academic_supplement_materials', processor: '_processAcademicSupplementMaterial', optional: true },
      { key: 'academicExamScopes', table: 'academic_exam_scopes', processor: '_processAcademicExamScope', optional: true },
      { key: 'academicExamDays', table: 'academic_exam_days', processor: '_processAcademicExamDay', optional: true },
      { key: 'academicEventExamDetails', table: 'academic_event_exam_details', processor: '_processAcademicEventExamDetail', optional: true },
      { key: 'academyCurriculumPlans', table: 'academy_curriculum_plans', processor: '_processAcademyCurriculumPlan', optional: true },
      { key: 'academyCurriculumMaterials', table: 'academy_curriculum_materials', processor: '_processAcademyCurriculumMaterial', optional: true },
      { key: 'academicExamMaterialPlans', table: 'academic_exam_material_plans', processor: '_processAcademicExamMaterialPlan', optional: true },
      { key: 'academicExamMaterialItems', table: 'academic_exam_material_items', processor: '_processAcademicExamMaterialItem', optional: true },
      { key: 'academyCurriculumPeriodCatalogs', table: 'academy_curriculum_period_catalogs', processor: '_processAcademyCurriculumPeriodCatalog', optional: true },
      { key: 'academyCurriculumPeriodPlans', table: 'academy_curriculum_period_plans', processor: '_processAcademyCurriculumPeriodPlan', optional: true },
      { key: 'academyCurriculumPeriodItems', table: 'academy_curriculum_period_items', processor: '_processAcademyCurriculumPeriodItem', optional: true }
    ];
  }

  _mapResourceRows(resource, rows) {
    const processor = this[resource.processor];
    if (typeof processor !== 'function') {
      return rows || [];
    }
    return (rows || []).map((row) => processor.call(this, row));
  }

  _collectUniqueErrorMessages(errors = []) {
    return [...new Set(
      errors
        .map((error) => error?.message || String(error))
        .filter(Boolean)
    )];
  }

  async _fetchResources(resources = []) {
    const settledResults = await Promise.allSettled(
      resources.map((resource) => supabase.from(resource.table).select('*'))
    );

    const nextData = {};
    const errors = [];

    resources.forEach((resource, index) => {
      const settled = settledResults[index];

      if (settled.status === 'fulfilled') {
        const { data, error } = settled.value;
        if (error) {
          if (!resource.optional || !this._isMissingTableError(error, resource.table)) {
            errors.push(error);
          }
          nextData[resource.key] = EMPTY_SNAPSHOT[resource.key];
          return;
        }

        nextData[resource.key] = this._mapResourceRows(resource, data);
        return;
      }

      if (!resource.optional || !this._isMissingTableError(settled.reason, resource.table)) {
        errors.push(settled.reason);
      }
      nextData[resource.key] = EMPTY_SNAPSHOT[resource.key];
    });

    return { nextData, errors };
  }

  _createSnapshotFromFetch(nextData = {}, errors = []) {
    this.cachedData = {
      ...this.cachedData,
      ...nextData,
    };

    const uniqueErrorMessages = this._collectUniqueErrorMessages(errors);

    this.isConnected = uniqueErrorMessages.length === 0;
    this.lastUpdated = new Date();
    this.error = uniqueErrorMessages.length > 0 ? uniqueErrorMessages[0] : null;

    return this._snapshot({
      ...this.cachedData,
      isConnected: this.isConnected,
      isLoading: false,
      lastUpdated: this.lastUpdated,
      error: this.error
    });
  }

  _scheduleDeferredSnapshotLoad() {
    if (!supabase || this.hasDeferredSnapshot || this.deferredSnapshotPromise) {
      return;
    }

    const loadDeferredResources = async () => {
      if (this.hasDeferredSnapshot) {
        return;
      }

      try {
        const { nextData, errors } = await this._fetchResources(this._getDeferredResources());
        if (errors.length > 0) {
          console.error('Supabase deferred fetch errors:', errors);
        }

        this.hasDeferredSnapshot = true;
        const snapshot = this._createSnapshotFromFetch(nextData, errors);
        this.listeners.forEach((listener) => listener(snapshot));
      } catch (error) {
        console.error('DataService deferred snapshot error:', error);
      } finally {
        this.deferredSnapshotPromise = null;
      }
    };

    this.deferredSnapshotPromise = new Promise((resolve) => {
      const schedule = () => resolve(loadDeferredResources());
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(schedule, { timeout: 800 });
        return;
      }

      setTimeout(schedule, 0);
    });
  }

  _ensureClient() {
    if (!supabase) {
      throw new Error(supabaseConfigError || '지금은 Supabase에 연결할 수 없습니다.');
    }

    return supabase;
  }

  _pickFields(source, keys) {
    return keys.reduce((result, key) => {
      if (key in source) {
        result[key] = source[key];
      }
      return result;
    }, {});
  }

  _isMissingColumnError(error, columnNames) {
    const message = String(error?.message || '').toLowerCase();
    return columnNames.some((columnName) => message.includes(String(columnName).toLowerCase()));
  }

  _isOptionalReferenceError(error, columnName) {
    const message = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    const hint = String(error?.hint || '').toLowerCase();
    const haystack = `${message} ${details} ${hint}`;
    if (!haystack.includes(String(columnName).toLowerCase())) {
      return false;
    }
    return haystack.includes('foreign key') || haystack.includes('violates') || haystack.includes('constraint');
  }

  _isMissingTableError(error, tableName) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes(`relation "${tableName.toLowerCase()}"`) || message.includes(tableName.toLowerCase());
  }

  _removeColumnFromPayload(payload, columnName) {
    if (Array.isArray(payload)) {
      payload.forEach((item) => {
        if (item && typeof item === 'object') {
          delete item[columnName];
        }
      });
      return payload;
    }

    if (payload && typeof payload === 'object') {
      delete payload[columnName];
    }

    return payload;
  }

  async _runClassMutation(buildPayload, execute, optionalColumns = ['status', 'lessons', 'schedule_plan', 'term_id']) {
    const payload = buildPayload();
    const skippedColumns = [];
    let result = await execute(payload);

    while (result.error) {
      const missingColumn = optionalColumns.find((columnName) => (
        !skippedColumns.includes(columnName) &&
        this._isMissingColumnError(result.error, [columnName])
      ));

      const optionalReferenceColumn = optionalColumns.find((columnName) => (
        !skippedColumns.includes(columnName) &&
        this._isOptionalReferenceError(result.error, columnName)
      ));

      const skippedColumn = missingColumn || optionalReferenceColumn;

      if (!skippedColumn) {
        break;
      }

      skippedColumns.push(skippedColumn);
      this._removeColumnFromPayload(payload, skippedColumn);
      console.warn(`[DataService] classes.${skippedColumn} unavailable; retrying without it.`);
      result = await execute(payload);
    }

    return { result, skippedColumns };
  }

  _clonePayload(payload) {
    if (Array.isArray(payload)) {
      return payload.map((item) => (item && typeof item === 'object' ? { ...item } : item));
    }

    if (payload && typeof payload === 'object') {
      return { ...payload };
    }

    return payload;
  }

  _buildTextbookPayload(textbook, { useLegacyName = false } = {}) {
    const title = String(textbook?.title || textbook?.name || '').trim();
    const payload = {
      [useLegacyName ? 'name' : 'title']: title,
      publisher: textbook?.publisher || '',
      price: Number(textbook?.price || 0),
      tags: Array.isArray(textbook?.tags) ? textbook.tags : [],
      lessons: Array.isArray(textbook?.lessons) ? textbook.lessons : [],
    };

    if (textbook?.id) {
      payload.id = textbook.id;
    }

    return payload;
  }

  async _runTextbookMutation(textbook, execute) {
    const optionalColumns = ['publisher', 'price', 'tags', 'lessons'];
    let lastError = null;

    for (const useLegacyName of [false, true]) {
      const payload = this._buildTextbookPayload(textbook, { useLegacyName });
      const removedColumns = [];
      let result = await execute(payload);

      while (result.error) {
        if (this._isMissingColumnError(result.error, [useLegacyName ? 'name' : 'title'])) {
          break;
        }

        const missingColumn = optionalColumns.find((columnName) => (
          !removedColumns.includes(columnName) && this._isMissingColumnError(result.error, [columnName])
        ));

        if (!missingColumn) {
          break;
        }

        removedColumns.push(missingColumn);
        delete payload[missingColumn];
        result = await execute(payload);
      }

      if (!result.error) {
        return result;
      }

      lastError = result.error;
    }

    throw lastError;
  }

  _normalizeAcademicEventInput(event) {
    const start =
      event?.start ||
      event?.start_date ||
      event?.startDate ||
      event?.date ||
      event?.end ||
      event?.end_date ||
      event?.endDate ||
      '';
    const end =
      event?.end ||
      event?.end_date ||
      event?.endDate ||
      event?.start ||
      event?.start_date ||
      event?.startDate ||
      event?.date ||
      start;

    return {
      id: event?.id || generateId(),
      title: event?.title || '',
      school: event?.school || null,
      school_id: event?.schoolId || event?.school_id || null,
      type: event?.type || '',
      start,
      end,
      color: event?.color || null,
      grade: event?.grade || 'all',
      note: event?.note || null,
    };
  }

  _buildAcademicEventPayloadCandidates(events) {
    const items = (Array.isArray(events) ? events : [events]).map((event) => this._normalizeAcademicEventInput(event));
    const createPayload = (mapper) => items.map((event) => mapper(event));

    return [
      {
        payload: createPayload((event) => ({
          id: event.id,
          title: event.title,
          school: event.school,
          school_id: event.school_id,
          type: event.type,
          start: event.start,
          end: event.end,
          date: event.start,
          color: event.color,
          grade: event.grade,
          note: event.note,
        })),
        optionalColumns: ['school_id', 'school', 'color', 'grade', 'note', 'start', 'end', 'date'],
      },
      {
        payload: createPayload((event) => ({
          id: event.id,
          title: event.title,
          school: event.school,
          school_id: event.school_id,
          type: event.type,
          start_date: event.start,
          end_date: event.end,
          date: event.start,
          color: event.color,
          grade: event.grade,
          note: event.note,
        })),
        optionalColumns: ['school_id', 'school', 'color', 'grade', 'note', 'start_date', 'end_date', 'date'],
      },
      {
        payload: createPayload((event) => ({
          id: event.id,
          title: event.title,
          school: event.school,
          school_id: event.school_id,
          type: event.type,
          date: event.start,
          color: event.color,
          grade: event.grade,
          note: event.note,
        })),
        optionalColumns: ['school_id', 'school', 'color', 'grade', 'note', 'date'],
      },
    ];
  }

  async _runAcademicEventMutation(buildCandidates, execute) {
    const candidates = buildCandidates();
    let lastError = null;

    for (const candidate of candidates) {
      const payload = this._clonePayload(candidate.payload);
      const skippedColumns = [];
      let result = await execute(payload);

      while (result.error) {
        const missingColumn = (candidate.optionalColumns || []).find((columnName) => (
          !skippedColumns.includes(columnName) && this._isMissingColumnError(result.error, [columnName])
        ));

        if (!missingColumn) {
          break;
        }

        skippedColumns.push(missingColumn);
        this._removeColumnFromPayload(payload, missingColumn);
        console.warn(`[DataService] academic_events.${missingColumn} column missing; retrying without it.`);
        result = await execute(payload);
      }

      if (!result.error) {
        return { result, skippedColumns };
      }

      lastError = result.error;
    }

    return { result: { error: lastError, data: null }, skippedColumns: [] };
  }

  _normalizeClassroomValue(value) {
    return normalizeClassroomText(value);
  }

  _mapClassUpdates(updates) {
    const mapped = { ...updates };

    if ('className' in mapped) {
      mapped.name = mapped.className;
      delete mapped.className;
    }
    if ('classroom' in mapped) {
      mapped.room = this._normalizeClassroomValue(mapped.classroom);
      delete mapped.classroom;
    }
    if ('room' in mapped) {
      mapped.room = this._normalizeClassroomValue(mapped.room);
    }
    if ('studentIds' in mapped) {
      mapped.student_ids = mapped.studentIds;
      delete mapped.studentIds;
    }
    if ('textbookIds' in mapped) {
      mapped.textbook_ids = mapped.textbookIds;
      delete mapped.textbookIds;
    }
    if ('waitlistIds' in mapped) {
      mapped.waitlist_ids = mapped.waitlistIds;
      delete mapped.waitlistIds;
    }
    if ('startDate' in mapped) {
      mapped.start_date = mapped.startDate;
      delete mapped.startDate;
    }
    if ('endDate' in mapped) {
      mapped.end_date = mapped.endDate;
      delete mapped.endDate;
    }
    if ('textbookInfo' in mapped) {
      mapped.textbook_info = mapped.textbookInfo;
      delete mapped.textbookInfo;
    }
    if ('termId' in mapped) {
      mapped.term_id = mapped.termId;
      delete mapped.termId;
    }
    if ('schedulePlan' in mapped) {
      mapped.schedule_plan = mapped.schedulePlan;
      delete mapped.schedulePlan;
    }
    if ('status' in mapped) {
      mapped.status = normalizeClassStatus(mapped.status);
    }

    return this._pickFields(mapped, [
      'name', 'teacher', 'schedule', 'student_ids', 'textbook_ids',
      'waitlist_ids', 'room', 'subject', 'color', 'capacity',
      'period', 'start_date', 'end_date', 'fee', 'grade', 'status',
      'textbook_info', 'lessons', 'schedule_plan', 'term_id'
    ]);
  }

  _mapStudentUpdates(updates) {
    const mapped = { ...updates };

    if ('classIds' in mapped) {
      mapped.class_ids = mapped.classIds;
      delete mapped.classIds;
    }
    if ('waitlistClassIds' in mapped) {
      mapped.waitlist_class_ids = mapped.waitlistClassIds;
      delete mapped.waitlistClassIds;
    }
    if ('parentContact' in mapped) {
      mapped.parent_contact = mapped.parentContact;
      delete mapped.parentContact;
    }
    if ('enrollDate' in mapped) {
      mapped.enroll_date = mapped.enrollDate;
      delete mapped.enrollDate;
    }

    return this._pickFields(mapped, [
      'name', 'uid', 'contact', 'parent_contact', 'school',
      'grade', 'enroll_date', 'class_ids', 'waitlist_class_ids'
    ]);
  }

  subscribe(listener) {
    let isSubscribed = true;

    this.listeners.add(listener);
    listener(this._snapshot({ isLoading: true }));

    this._getSnapshot()
      .then((snapshot) => {
        if (isSubscribed) {
          listener(snapshot);
        }
      })
      .catch((error) => {
        console.error('DataService initial snapshot error:', error);
        if (!isSubscribed) return;

        this.lastUpdated = new Date();
        this.error = error?.message || '데이터를 불러오지 못했습니다.';
        listener(this._snapshot({
          isConnected: false,
          isLoading: false,
          lastUpdated: this.lastUpdated,
          error: this.error
        }));
      });

    return () => {
      isSubscribed = false;
      this.listeners.delete(listener);
    };
  }

  async _notify() {
    if (this.notifyPromise) {
      this.notifyQueued = true;
      return this.notifyPromise;
    }

    this.notifyPromise = (async () => {
      try {
        const snapshot = await this._getSnapshot({ includeDeferred: true });
        this.listeners.forEach((listener) => listener(snapshot));
      } catch (err) {
        console.error('DataService notification error:', err);
      } finally {
        this.notifyPromise = null;
        if (this.notifyQueued) {
          this.notifyQueued = false;
          this._notify();
        }
      }
    })();

    try {
      return await this.notifyPromise;
    } catch (err) {
      console.error('DataService notification error:', err);
    }
  }

  async _getSnapshot({ includeDeferred = false } = {}) {
    if (!supabase) {
      this.isConnected = false;
      this.lastUpdated = new Date();
      this.error = supabaseConfigError;
      return this._snapshot({
        isConnected: false,
        isLoading: false,
        lastUpdated: this.lastUpdated
      });
    }

    try {
      const resources = includeDeferred
        ? [...this._getCoreResources(), ...this._getDeferredResources()]
        : this._getCoreResources();
      const { nextData, errors } = await this._fetchResources(resources);

      if (errors.length > 0) {
        console.error('Supabase fetch errors:', errors);
      }

      if (includeDeferred) {
        this.hasDeferredSnapshot = true;
      } else {
        this._scheduleDeferredSnapshotLoad();
      }

      return this._createSnapshotFromFetch(nextData, errors);
    } catch (err) {
      console.error('DataService critical error:', err);
      this.isConnected = false;
      this.lastUpdated = new Date();
      this.error = err.message;

      return this._snapshot({
        isConnected: false,
        isLoading: false,
        lastUpdated: this.lastUpdated
      });
    }
  }

  async getClasses() {
    const client = this._ensureClient();
    const { data } = await client.from('classes').select('*');
    return (data || []).map((row) => this._processClass(row));
  }

  async addClass(classObj) {
    const client = this._ensureClient();
    const { result } = await this._runClassMutation(
      () => ({
        id: classObj.id || generateId(),
        name: classObj.name || classObj.className,
        teacher: classObj.teacher,
        schedule: classObj.schedule,
        student_ids: classObj.studentIds || [],
        textbook_ids: classObj.textbookIds || [],
        waitlist_ids: classObj.waitlistIds || [],
        room: this._normalizeClassroomValue(classObj.room || classObj.classroom),
        subject: classObj.subject,
        status: normalizeClassStatus(classObj.status) || computeClassStatus(classObj),
        color: classObj.color,
        capacity: classObj.capacity || 0,
        period: classObj.period,
        term_id: classObj.termId || classObj.term_id || null,
        start_date: classObj.startDate,
        end_date: classObj.endDate,
        fee: classObj.fee || 0,
        grade: classObj.grade,
        textbook_info: classObj.textbookInfo,
        lessons: classObj.lessons || [],
        schedule_plan: classObj.schedulePlan || classObj.schedule_plan || null,
      }),
      (payload) => client.from('classes').insert([payload]).select().single()
    );

    if (result.error) throw result.error;
    this._notify();
    return this._processClass(result.data);
  }

  async updateClass(id, updates) {
    const client = this._ensureClient();
    const { result } = await this._runClassMutation(
      () => this._mapClassUpdates(updates),
      (payload) => client.from('classes').update(payload).eq('id', id)
    );

    if (result.error) throw result.error;
    this._notify();
    return true;
  }

  async deleteClass(id) {
    const client = this._ensureClient();
    const { error } = await client.from('classes').delete().eq('id', id);
    if (error) throw error;
    this._notify();
  }

  async bulkDeleteClasses(ids) {
    const client = this._ensureClient();
    const { error } = await client.from('classes').delete().in('id', ids);
    if (error) throw error;
    this._notify();
  }

  async bulkUpdateClasses(ids, updates) {
    const client = this._ensureClient();
    const { result } = await this._runClassMutation(
      () => this._mapClassUpdates(updates),
      (payload) => client.from('classes').update(payload).in('id', ids)
    );

    if (result.error) throw result.error;
    this._notify();
  }

  async bulkUpsertClasses(classesArray) {
    const client = this._ensureClient();
    const { result } = await this._runClassMutation(
      () => classesArray.map((classItem) => ({
        id: classItem.id || generateId(),
        name: classItem.name || classItem.className,
        subject: classItem.subject,
        grade: classItem.grade,
        teacher: classItem.teacher,
        room: this._normalizeClassroomValue(classItem.room || classItem.classroom),
        schedule: classItem.schedule,
        status: normalizeClassStatus(classItem.status) || computeClassStatus(classItem),
        fee: classItem.fee || 0,
        capacity: classItem.capacity || 0,
        period: classItem.period,
        term_id: classItem.termId || classItem.term_id || null,
        start_date: classItem.startDate,
        end_date: classItem.endDate,
        textbook_info: classItem.textbookInfo,
        lessons: classItem.lessons || [],
        schedule_plan: classItem.schedulePlan || classItem.schedule_plan || null,
        student_ids: classItem.studentIds || [],
        textbook_ids: classItem.textbookIds || [],
        waitlist_ids: classItem.waitlistIds || []
      })),
      (payload) => client.from('classes').upsert(payload, { onConflict: 'id' }).select()
    );

    if (result.error) throw result.error;
    this._notify();
    return (result.data || []).map((row) => this._processClass(row));
  }

  async normalizeLegacyClassrooms(classesArray = []) {
    const client = this._ensureClient();
    const rows = (classesArray || [])
      .map((classItem) => {
        const normalizedRoom = this._normalizeClassroomValue(classItem.room || classItem.classroom);
        if (!normalizedRoom || normalizedRoom === (classItem.room || classItem.classroom || '')) {
          return null;
        }

        return {
          id: classItem.id,
          room: normalizedRoom,
        };
      })
      .filter(Boolean);

    if (rows.length === 0) {
      return 0;
    }

    const { error } = await client.from('classes').upsert(rows, { onConflict: 'id' });
    if (error) {
      throw error;
    }

    this._notify();
    return rows.length;
  }

  async getTextbooks() {
    const client = this._ensureClient();
    const { data } = await client.from('textbooks').select('*');
    return (data || []).map((row) => this._processTextbook(row));
  }

  async addTextbook(textbook) {
    const client = this._ensureClient();
    const { data } = await this._runTextbookMutation(
      textbook,
      (payload) => client.from('textbooks').insert([payload]).select().single()
    );
    this._notify();
    return this._processTextbook(data);
  }

  async updateTextbook(id, updates) {
    const client = this._ensureClient();
    await this._runTextbookMutation(
      updates,
      (payload) => {
        const { id: ignoredId, ...finalUpdates } = payload;
        return client.from('textbooks').update(finalUpdates).eq('id', id);
      }
    );
    this._notify();
  }

  async deleteTextbook(id) {
    const client = this._ensureClient();
    const { error } = await client.from('textbooks').delete().eq('id', id);
    if (error) throw error;
    this._notify();
  }

  async bulkDeleteTextbooks(ids) {
    const client = this._ensureClient();
    const { error } = await client.from('textbooks').delete().in('id', ids);
    if (error) throw error;
    this._notify();
  }

  async bulkUpdateTextbooks(ids, updates) {
    const client = this._ensureClient();

    if (updates.addTags) {
      const { data, error } = await client.from('textbooks').select('*').in('id', ids);
      if (error) throw error;

      const mergedRows = (data || []).map((row) => ({
        id: row.id,
        tags: [...new Set([...(row.tags || []), ...updates.addTags])]
      }));

      const { error: mergeError } = await client.from('textbooks').upsert(mergedRows, { onConflict: 'id' });
      if (mergeError) throw mergeError;
    }

    const rest = this._pickFields(updates, ['title', 'publisher', 'price', 'tags', 'lessons']);
    if (Object.keys(rest).length > 0) {
      const { error } = await client.from('textbooks').update(rest).in('id', ids);
      if (error) throw error;
    }

    this._notify();
  }

  async getStudents() {
    const client = this._ensureClient();
    const { data } = await client.from('students').select('*');
    return (data || []).map((row) => this._processStudent(row));
  }

  async addStudent(student) {
    const client = this._ensureClient();
    const payload = {
      id: student.id || undefined,
      name: student.name,
      uid: student.uid,
      contact: student.contact,
      parent_contact: student.parentContact,
      school: student.school,
      grade: student.grade,
      enroll_date: student.enrollDate || new Date().toISOString().split('T')[0],
      class_ids: student.classIds || [],
      waitlist_class_ids: student.waitlistClassIds || []
    };

    const { data, error } = await client.from('students').insert([payload]).select().single();
    if (error) throw error;
    this._notify();
    return this._processStudent(data);
  }

  async updateStudent(id, updates) {
    const client = this._ensureClient();
    const finalUpdates = this._mapStudentUpdates(updates);
    const { error } = await client.from('students').update(finalUpdates).eq('id', id);
    if (error) throw error;
    this._notify();
  }

  async deleteStudent(id) {
    const client = this._ensureClient();
    const { error } = await client.from('students').delete().eq('id', id);
    if (error) throw error;
    this._notify();
  }

  async bulkDeleteStudents(ids) {
    const client = this._ensureClient();
    const { error } = await client.from('students').delete().in('id', ids);
    if (error) throw error;
    this._notify();
  }

  async bulkUpsertStudents(studentsArray) {
    const client = this._ensureClient();
    const rows = studentsArray.map((student) => ({
      id: student.id || generateId(),
      name: student.name,
      uid: student.uid,
      grade: student.grade,
      school: student.school,
      contact: student.contact,
      parent_contact: student.parentContact,
      enroll_date: student.enrollDate || new Date().toISOString().split('T')[0],
      class_ids: student.classIds || [],
      waitlist_class_ids: student.waitlistClassIds || []
    }));

    const { data, error } = await client.from('students').upsert(rows, { onConflict: 'id' }).select();
    if (error) throw error;
    this._notify();
    return (data || []).map((row) => this._processStudent(row));
  }

  async addProgressLog(log) {
    const client = this._ensureClient();
    const completedLessonIds = log.completedLessonIds || (log.chapterId ? [log.chapterId] : []);
    const payload = {
      class_id: log.classId,
      textbook_id: log.textbookId,
      chapter_id: log.chapterId,
      completed_lesson_ids: completedLessonIds,
      date: log.date,
      content: log.content,
      homework: log.homework
    };

    let result = await client.from('progress_logs').insert([payload]).select().single();
    if (result.error && (String(result.error.message).includes('column') || String(result.error.message).includes('schema cache'))) {
      const legacyPayload = {
        class_id: log.classId,
        date: log.date,
        content: log.content,
        homework: log.homework
      };

      result = await client.from('progress_logs').insert([legacyPayload]).select().single();
    }

    if (result.error) throw result.error;
    this._notify();
    return this._processProgressLog(result.data);
  }

  async deleteProgressLog(logId) {
    const client = this._ensureClient();
    const { error } = await client.from('progress_logs').delete().eq('id', logId);
    if (error) throw error;
    this._notify();
  }

  async getProgressLogsForClass(classId) {
    const client = this._ensureClient();
    const { data } = await client.from('progress_logs').select('*').eq('class_id', classId);
    return (data || []).map((row) => this._processProgressLog(row));
  }

  async getAcademicSchools() {
    const client = this._ensureClient();
    const { data, error } = await client.from('academic_schools').select('*').order('sort_order', { ascending: true });
    if (error) throw error;
    return (data || []).map((row) => this._processAcademicSchool(row));
  }

  async getTeacherCatalogs() {
    const client = this._ensureClient();
    const { data, error } = await client.from('teacher_catalogs').select('*').order('sort_order', { ascending: true });
    if (error) {
      if (this._isMissingTableError(error, 'teacher_catalogs')) {
        return [];
      }
      throw error;
    }
    return (data || []).map((row) => this._processTeacherCatalog(row));
  }

  async getClassroomCatalogs() {
    const client = this._ensureClient();
    const { data, error } = await client.from('classroom_catalogs').select('*').order('sort_order', { ascending: true });
    if (error) {
      if (this._isMissingTableError(error, 'classroom_catalogs')) {
        return [];
      }
      throw error;
    }
    return (data || []).map((row) => this._processClassroomCatalog(row));
  }

  async getClassTerms() {
    const client = this._ensureClient();
    const { data, error } = await client
      .from('class_terms')
      .select('*')
      .order('academic_year', { ascending: false })
      .order('sort_order', { ascending: true });

    if (error) {
      if (this._isMissingTableError(error, 'class_terms')) {
        return [];
      }
      throw error;
    }

    return (data || []).map((row) => this._processClassTerm(row));
  }

  async upsertClassTerms(terms) {
    const client = this._ensureClient();
    const payload = (terms || []).map((term, index) => ({
      id: term.id || generateId(),
      academic_year: Number(term.academicYear || term.academic_year || new Date().getFullYear()),
      name: term.name,
      status: normalizeClassStatus(term.status) || term.status || '수업 진행 중',
      start_date: term.startDate || term.start_date || null,
      end_date: term.endDate || term.end_date || null,
      sort_order: term.sortOrder ?? term.sort_order ?? index,
    }));

    const { data, error } = await client
      .from('class_terms')
      .upsert(payload, { onConflict: 'id' })
      .select();

    if (error) {
      if (this._isMissingTableError(error, 'class_terms')) {
        return [];
      }
      throw error;
    }

    this._notify();
    return (data || []).map((row) => this._processClassTerm(row));
  }

  async deleteClassTerm(id) {
    const client = this._ensureClient();
    const { error } = await client.from('class_terms').delete().eq('id', id);
    if (error) {
      if (this._isMissingTableError(error, 'class_terms')) {
        return;
      }
      throw error;
    }
    this._notify();
  }

  async getAcademicWorkspaceSupport() {
    const client = this._ensureClient();
    const requiredTables = ['academic_schools'];
    const optionalTables = [
      'academic_curriculum_profiles',
      'academic_supplement_materials',
      'academic_event_exam_details',
      'academy_curriculum_plans',
      'academy_curriculum_materials',
    ];

    const settled = await Promise.all(
      [...requiredTables, ...optionalTables].map(async (table) => {
        const { error } = await client.from(table).select('id').limit(1);
        return {
          table,
          available: !error || !this._isMissingTableError(error, table),
          error,
        };
      })
    );

    const missingTables = settled.filter((entry) => !entry.available).map((entry) => entry.table);
    const missingRequiredTables = missingTables.filter((table) => requiredTables.includes(table));
    const missingOptionalTables = missingTables.filter((table) => optionalTables.includes(table));

    return {
      ready: missingRequiredTables.length === 0,
      missingTables: missingRequiredTables,
      missingOptionalTables,
      checkedAt: new Date(),
    };
  }

  async getCurriculumRoadmapSupport() {
    const client = this._ensureClient();
    const requiredTables = [
      'academic_exam_material_plans',
      'academic_exam_material_items',
      'academy_curriculum_period_catalogs',
      'academy_curriculum_period_plans',
      'academy_curriculum_period_items',
    ];

    const settled = await Promise.all(
      requiredTables.map(async (table) => {
        const { error } = await client.from(table).select('id').limit(1);
        return {
          table,
          available: !error || !this._isMissingTableError(error, table),
          error,
        };
      })
    );

    const missingTables = settled.filter((entry) => !entry.available).map((entry) => entry.table);

    return {
      ready: missingTables.length === 0,
      missingTables,
      checkedAt: new Date(),
    };
  }

  async upsertAcademicSchools(schools) {
    const client = this._ensureClient();
    const payload = (schools || []).map((school) => ({
      id: school.id,
      name: school.name,
      category: school.category,
      color: school.color,
      textbooks: school.textbooks || {},
      sort_order: school.sortOrder || 0
    }));

    const { data, error } = await client.from('academic_schools').upsert(payload, { onConflict: 'id' }).select();
    if (error) throw error;
    this._notify();
    return (data || []).map((row) => this._processAcademicSchool(row));
  }

  async deleteAcademicSchools(ids = []) {
    const client = this._ensureClient();
    const targets = [...new Set((ids || []).filter(Boolean))];
    if (targets.length === 0) {
      return;
    }
    const { error } = await client.from('academic_schools').delete().in('id', targets);
    if (error) throw error;
    this._notify();
  }

  async upsertTeacherCatalogs(resources) {
    const client = this._ensureClient();
    const payload = (resources || []).map((resource, index) => ({
      id: resource.id || generateId(),
      name: String(resource.name || '').trim(),
      subjects: Array.isArray(resource.subjects) ? resource.subjects : [],
      is_visible: resource.isVisible !== false,
      sort_order: resource.sortOrder ?? index,
    }));

    const { data, error } = await client.from('teacher_catalogs').upsert(payload, { onConflict: 'id' }).select();
    if (error) {
      if (this._isMissingTableError(error, 'teacher_catalogs')) {
        return [];
      }
      throw error;
    }
    this._notify();
    return (data || []).map((row) => this._processTeacherCatalog(row));
  }

  async deleteTeacherCatalogs(ids = []) {
    const client = this._ensureClient();
    const targets = [...new Set((ids || []).filter(Boolean))];
    if (targets.length === 0) {
      return;
    }
    const { error } = await client.from('teacher_catalogs').delete().in('id', targets);
    if (error) {
      if (this._isMissingTableError(error, 'teacher_catalogs')) {
        return;
      }
      throw error;
    }
    this._notify();
  }

  async upsertClassroomCatalogs(resources) {
    const client = this._ensureClient();
    const payload = (resources || []).map((resource, index) => ({
      id: resource.id || generateId(),
      name: this._normalizeClassroomValue(resource.name || ''),
      subjects: Array.isArray(resource.subjects) ? resource.subjects : [],
      is_visible: resource.isVisible !== false,
      sort_order: resource.sortOrder ?? index,
    }));

    const { data, error } = await client.from('classroom_catalogs').upsert(payload, { onConflict: 'id' }).select();
    if (error) {
      if (this._isMissingTableError(error, 'classroom_catalogs')) {
        return [];
      }
      throw error;
    }
    this._notify();
    return (data || []).map((row) => this._processClassroomCatalog(row));
  }

  async deleteClassroomCatalogs(ids = []) {
    const client = this._ensureClient();
    const targets = [...new Set((ids || []).filter(Boolean))];
    if (targets.length === 0) {
      return;
    }
    const { error } = await client.from('classroom_catalogs').delete().in('id', targets);
    if (error) {
      if (this._isMissingTableError(error, 'classroom_catalogs')) {
        return;
      }
      throw error;
    }
    this._notify();
  }

  async bulkUpsertAcademicCurriculumProfiles(profiles) {
    const client = this._ensureClient();
    const requestedProfiles = (profiles || []).filter((profile) => profile?.schoolId && profile?.grade && profile?.subject);
    if (requestedProfiles.length === 0) {
      return [];
    }

    const existingRows = [];
    const schoolIds = Array.from(new Set(requestedProfiles.map((profile) => profile.schoolId)));
    for (const schoolId of schoolIds) {
      const { data, error } = await client
        .from('academic_curriculum_profiles')
        .select('*')
        .eq('school_id', schoolId);

      if (error) {
        throw error;
      }

      existingRows.push(...((data || []).map((row) => this._processAcademicCurriculumProfile(row))));
    }

    const existingIdByKey = new Map(
      existingRows.map((row) => [`${row.schoolId}::${row.academicYear}::${row.grade}::${row.subject}`, row.id])
    );

    const buildPayload = ({ includeAcademicYear }) => requestedProfiles.map((profile) => {
      const academicYear = Number(profile.academicYear || profile.academic_year || new Date().getFullYear());
      const key = `${profile.schoolId}::${academicYear}::${profile.grade}::${profile.subject}`;

      return {
        id: profile.id || existingIdByKey.get(key) || generateId(),
        ...(includeAcademicYear ? { academic_year: academicYear } : null),
        school_id: profile.schoolId,
        grade: profile.grade,
        subject: profile.subject,
        main_textbook_title: profile.mainTextbookTitle || null,
        main_textbook_publisher: profile.mainTextbookPublisher || null,
        note: includeAcademicYear ? (profile.note || null) : appendEmbeddedNoteMeta(profile.note, { academicYear }),
      };
    });

    let { data, error } = await client
      .from('academic_curriculum_profiles')
      .upsert(buildPayload({ includeAcademicYear: true }), { onConflict: 'id' })
      .select();

    if (error && this._isMissingColumnError(error, ['academic_year'])) {
      const fallbackResult = await client
        .from('academic_curriculum_profiles')
        .upsert(buildPayload({ includeAcademicYear: false }), { onConflict: 'id' })
        .select();
      data = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error) throw error;
    this._notify();
    return (data || []).map((row) => this._processAcademicCurriculumProfile(row));
  }

  async replaceAcademicSupplementMaterials(profileId, items) {
    const client = this._ensureClient();
    const { error: deleteError } = await client.from('academic_supplement_materials').delete().eq('profile_id', profileId);
    if (deleteError) throw deleteError;

    const payload = (items || [])
      .map((item, index) => ({
        id: item.id || generateId(),
        profile_id: profileId,
        title: item.title || '',
        publisher: item.publisher || null,
        note: item.note || null,
        sort_order: item.sortOrder ?? index,
      }))
      .filter((item) => item.title.trim());

    if (payload.length > 0) {
      const { error } = await client.from('academic_supplement_materials').insert(payload);
      if (error) throw error;
    }

    this._notify();
    return payload.map((row) => this._processAcademicSupplementMaterial(row));
  }

  async bulkUpsertAcademicExamMaterialPlans(plans) {
    const client = this._ensureClient();
    const requestedPlans = (plans || []).filter(
      (plan) => plan?.schoolId && plan?.grade && plan?.subject && plan?.examPeriodCode
    );
    if (requestedPlans.length === 0) {
      return [];
    }

    const existingRows = [];
    const schoolIds = Array.from(new Set(requestedPlans.map((plan) => plan.schoolId)));
    for (const schoolId of schoolIds) {
      const { data, error } = await client
        .from('academic_exam_material_plans')
        .select('*')
        .eq('school_id', schoolId);

      if (error) {
        if (this._isMissingTableError(error, 'academic_exam_material_plans')) {
          return [];
        }
        throw error;
      }

      existingRows.push(...((data || []).map((row) => this._processAcademicExamMaterialPlan(row))));
    }

    const existingIdByKey = new Map(
      existingRows.map((row) => [
        `${row.schoolId}::${row.academicYear}::${row.grade}::${row.subject}::${row.examPeriodCode}`,
        row.id,
      ])
    );

    const payload = requestedPlans.map((plan, index) => {
      const academicYear = Number(plan.academicYear || plan.academic_year || new Date().getFullYear());
      const key = `${plan.schoolId}::${academicYear}::${plan.grade}::${plan.subject}::${plan.examPeriodCode}`;
      return {
        id: plan.id || existingIdByKey.get(key) || generateId(),
        academic_year: academicYear,
        subject: plan.subject,
        school_id: plan.schoolId,
        grade: plan.grade,
        exam_period_code: plan.examPeriodCode,
        note: plan.note || null,
        sort_order: plan.sortOrder ?? plan.sort_order ?? index,
      };
    });

    const { data, error } = await client
      .from('academic_exam_material_plans')
      .upsert(payload, { onConflict: 'id' })
      .select();

    if (error) {
      if (this._isMissingTableError(error, 'academic_exam_material_plans')) {
        return [];
      }
      throw error;
    }

    this._notify();
    return (data || []).map((row) => this._processAcademicExamMaterialPlan(row));
  }

  async replaceAcademicExamMaterialItems(planId, items) {
    const client = this._ensureClient();
    const { error: deleteError } = await client
      .from('academic_exam_material_items')
      .delete()
      .eq('plan_id', planId);
    if (deleteError) {
      if (this._isMissingTableError(deleteError, 'academic_exam_material_items')) {
        return [];
      }
      throw deleteError;
    }

    const payload = (items || [])
      .map((item, index) => ({
        id: item.id || generateId(),
        plan_id: planId,
        material_category: item.materialCategory || item.material_category || 'other',
        title: item.title || null,
        publisher: item.publisher || null,
        scope_detail: item.scopeDetail || item.scope_detail || null,
        note: item.note || null,
        sort_order: item.sortOrder ?? item.sort_order ?? index,
      }))
      .filter((item) => item.title || item.publisher || item.scope_detail || item.note);

    if (payload.length > 0) {
      const { error } = await client.from('academic_exam_material_items').insert(payload);
      if (error) {
        if (this._isMissingTableError(error, 'academic_exam_material_items')) {
          return [];
        }
        throw error;
      }
    }

    this._notify();
    return payload.map((row) => this._processAcademicExamMaterialItem(row));
  }

  async deleteAcademicExamMaterialPlan(planId) {
    const client = this._ensureClient();
    const { error } = await client
      .from('academic_exam_material_plans')
      .delete()
      .eq('id', planId);
    if (error) {
      if (this._isMissingTableError(error, 'academic_exam_material_plans')) {
        return;
      }
      throw error;
    }
    this._notify();
  }

  async upsertAcademyCurriculumPeriodCatalogs(periods) {
    const client = this._ensureClient();
    const payload = (periods || [])
      .filter((period) => period?.subject && period?.academyGrade && period?.periodCode && period?.periodLabel)
      .map((period, index) => ({
        id: period.id || generateId(),
        academic_year: Number(period.academicYear || period.academic_year || new Date().getFullYear()),
        subject: period.subject,
        academy_grade: period.academyGrade,
        period_code: period.periodCode,
        period_label: period.periodLabel,
        sort_order: period.sortOrder ?? period.sort_order ?? index,
      }));

    if (payload.length === 0) {
      return [];
    }

    const { data, error } = await client
      .from('academy_curriculum_period_catalogs')
      .upsert(payload, { onConflict: 'academic_year,subject,academy_grade,period_code' })
      .select();

    if (error) {
      if (this._isMissingTableError(error, 'academy_curriculum_period_catalogs')) {
        return [];
      }
      throw error;
    }

    this._notify();
    return (data || []).map((row) => this._processAcademyCurriculumPeriodCatalog(row));
  }

  async deleteAcademyCurriculumPeriodCatalog(catalogId) {
    const client = this._ensureClient();
    const { error } = await client
      .from('academy_curriculum_period_catalogs')
      .delete()
      .eq('id', catalogId);

    if (error) {
      if (this._isMissingTableError(error, 'academy_curriculum_period_catalogs')) {
        return;
      }
      throw error;
    }

    this._notify();
  }

  async bulkUpsertAcademyCurriculumPeriodPlans(plans) {
    const client = this._ensureClient();
    const requestedPlans = (plans || []).filter(
      (plan) => plan?.subject && plan?.academyGrade && plan?.periodCode && plan?.periodLabel && plan?.scopeType
    );
    if (requestedPlans.length === 0) {
      return [];
    }

    const existingRows = [];
    const filterKeys = Array.from(
      new Set(
        requestedPlans.map((plan) =>
          `${Number(plan.academicYear || plan.academic_year || new Date().getFullYear())}::${plan.subject}::${plan.academyGrade}`
        )
      )
    );

    for (const key of filterKeys) {
      const [academicYear, subject, academyGrade] = key.split('::');
      const { data, error } = await client
        .from('academy_curriculum_period_plans')
        .select('*')
        .eq('academic_year', Number(academicYear))
        .eq('subject', subject)
        .eq('academy_grade', academyGrade);

      if (error) {
        if (this._isMissingTableError(error, 'academy_curriculum_period_plans')) {
          return [];
        }
        throw error;
      }

      existingRows.push(...((data || []).map((row) => this._processAcademyCurriculumPeriodPlan(row))));
    }

    const existingIdByKey = new Map(
      existingRows.map((row) => [
        `${row.academicYear}::${row.subject}::${row.academyGrade}::${row.scopeType}::${row.classId || ''}::${row.periodCode}`,
        row.id,
      ])
    );

    const payload = requestedPlans.map((plan, index) => {
      const academicYear = Number(plan.academicYear || plan.academic_year || new Date().getFullYear());
      const classId = plan.classId || plan.class_id || null;
      const key = `${academicYear}::${plan.subject}::${plan.academyGrade}::${plan.scopeType}::${classId || ''}::${plan.periodCode}`;
      return {
        id: plan.id || existingIdByKey.get(key) || generateId(),
        academic_year: academicYear,
        subject: plan.subject,
        academy_grade: plan.academyGrade,
        catalog_id: plan.catalogId || plan.catalog_id || null,
        period_type: plan.periodType || plan.period_type || 'fixed',
        period_code: plan.periodCode,
        period_label: plan.periodLabel,
        scope_type: plan.scopeType,
        class_id: classId,
        note: plan.note || null,
        sort_order: plan.sortOrder ?? plan.sort_order ?? index,
      };
    });

    const { data, error } = await client
      .from('academy_curriculum_period_plans')
      .upsert(payload, { onConflict: 'id' })
      .select();

    if (error) {
      if (this._isMissingTableError(error, 'academy_curriculum_period_plans')) {
        return [];
      }
      throw error;
    }

    this._notify();
    return (data || []).map((row) => this._processAcademyCurriculumPeriodPlan(row));
  }

  async replaceAcademyCurriculumPeriodItems(planId, items) {
    const client = this._ensureClient();
    const { error: deleteError } = await client
      .from('academy_curriculum_period_items')
      .delete()
      .eq('plan_id', planId);

    if (deleteError) {
      if (this._isMissingTableError(deleteError, 'academy_curriculum_period_items')) {
        return [];
      }
      throw deleteError;
    }

    const payload = (items || [])
      .map((item, index) => ({
        id: item.id || generateId(),
        plan_id: planId,
        material_category: item.materialCategory || item.material_category || 'other',
        textbook_id: item.textbookId || item.textbook_id || null,
        title: item.title || null,
        publisher: item.publisher || null,
        plan_detail: item.planDetail || item.plan_detail || null,
        note: item.note || null,
        sort_order: item.sortOrder ?? item.sort_order ?? index,
      }))
      .filter((item) => item.textbook_id || item.title || item.publisher || item.plan_detail || item.note);

    if (payload.length > 0) {
      const { error } = await client.from('academy_curriculum_period_items').insert(payload);
      if (error) {
        if (this._isMissingTableError(error, 'academy_curriculum_period_items')) {
          return [];
        }
        throw error;
      }
    }

    this._notify();
    return payload.map((row) => this._processAcademyCurriculumPeriodItem(row));
  }

  async deleteAcademyCurriculumPeriodPlan(planId) {
    const client = this._ensureClient();
    const { error } = await client
      .from('academy_curriculum_period_plans')
      .delete()
      .eq('id', planId);

    if (error) {
      if (this._isMissingTableError(error, 'academy_curriculum_period_plans')) {
        return;
      }
      throw error;
    }

    this._notify();
  }

  async migrateLegacyCurriculumRoadmap(source = {}) {
    const client = this._ensureClient();
    const support = await this.getCurriculumRoadmapSupport();
    if (!support.ready) {
      return { migrated: false, reason: 'missing-tables', support };
    }

    const [existingSchoolPlans, existingAcademyPlans, existingCatalogs] = await Promise.all([
      client.from('academic_exam_material_plans').select('id').limit(1),
      client.from('academy_curriculum_period_plans').select('id').limit(1),
      client.from('academy_curriculum_period_catalogs').select('id').limit(1),
    ]);

    if ((existingSchoolPlans.data || []).length > 0 || (existingAcademyPlans.data || []).length > 0 || (existingCatalogs.data || []).length > 0) {
      return { migrated: false, reason: 'already-populated' };
    }

    const schoolProfiles = source.academicCurriculumProfiles || [];
    const schoolMaterials = source.academicSupplementMaterials || [];
    const academyPlans = source.academyCurriculumPlans || [];
    const academyMaterials = source.academyCurriculumMaterials || [];
    const classes = source.classes || [];
    const textbooks = source.textbooks || [];

    const classesById = new Map(classes.map((row) => [row.id, row]));
    const textbooksById = new Map(textbooks.map((row) => [row.id, row]));

    const schoolPlanRows = [];
    const schoolItemRows = [];
    schoolProfiles.forEach((profile, profileIndex) => {
      if (!profile?.schoolId || !profile?.grade || !profile?.subject) {
        return;
      }

      const planId = generateId();
      schoolPlanRows.push({
        id: planId,
        academic_year: Number(profile.academicYear || profile.academic_year || new Date().getFullYear()),
        subject: profile.subject,
        school_id: profile.schoolId,
        grade: profile.grade,
        exam_period_code: 'S1_MID',
        note: profile.note || null,
        sort_order: profileIndex,
      });

      if (profile.mainTextbookTitle || profile.mainTextbookPublisher) {
        schoolItemRows.push({
          id: generateId(),
          plan_id: planId,
          material_category: 'textbook',
          title: profile.mainTextbookTitle || null,
          publisher: profile.mainTextbookPublisher || null,
          scope_detail: null,
          note: null,
          sort_order: 0,
        });
      }

      schoolMaterials
        .filter((item) => item.profileId === profile.id)
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
        .forEach((item, itemIndex) => {
          schoolItemRows.push({
            id: generateId(),
            plan_id: planId,
            material_category: 'supplement',
            title: item.title || null,
            publisher: item.publisher || null,
            scope_detail: null,
            note: item.note || null,
            sort_order: itemIndex + 1,
          });
        });
    });

    const catalogRows = [];
    const catalogByKey = new Map();
    const academyPlanRows = [];
    const academyItemRows = [];

    academyPlans.forEach((plan, planIndex) => {
      const matchedClass = classesById.get(plan.classId || plan.class_id || '');
      const academicYear = Number(plan.academicYear || plan.academic_year || new Date().getFullYear());
      const academyGrade = matchedClass?.grade || normalizeLegacyAcademyGradeLabel(plan.academyGrade || plan.academy_grade);
      const subject = plan.subject || matchedClass?.subject || '';

      if (!academyGrade || !subject) {
        return;
      }

      const catalogKey = `${academicYear}::${subject}::${academyGrade}::custom-default-plan`;
      let catalog = catalogByKey.get(catalogKey);
      if (!catalog) {
        catalog = {
          id: generateId(),
          academic_year: academicYear,
          subject,
          academy_grade: academyGrade,
          period_code: 'custom-default-plan',
          period_label: '기본 운영안',
          sort_order: catalogRows.length,
        };
        catalogByKey.set(catalogKey, catalog);
        catalogRows.push(catalog);
      }

      const nextPlanId = generateId();
      academyPlanRows.push({
        id: nextPlanId,
        academic_year: academicYear,
        subject,
        academy_grade: academyGrade,
        catalog_id: catalog.id,
        period_type: 'custom',
        period_code: catalog.period_code,
        period_label: catalog.period_label,
        scope_type: plan.classId || plan.class_id ? 'class' : 'template',
        class_id: plan.classId || plan.class_id || null,
        note: plan.note || null,
        sort_order: plan.sortOrder ?? plan.sort_order ?? planIndex,
      });

      const matchedTextbook = textbooksById.get(plan.mainTextbookId || plan.main_textbook_id || '');
      if (matchedTextbook || plan.mainTextbookId || plan.main_textbook_id) {
        academyItemRows.push({
          id: generateId(),
          plan_id: nextPlanId,
          material_category: 'textbook',
          textbook_id: matchedTextbook?.id || plan.mainTextbookId || plan.main_textbook_id || null,
          title: matchedTextbook?.title || matchedTextbook?.name || null,
          publisher: matchedTextbook?.publisher || null,
          plan_detail: null,
          note: null,
          sort_order: 0,
        });
      }

      academyMaterials
        .filter((item) => item.planId === plan.id)
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
        .forEach((item, itemIndex) => {
          academyItemRows.push({
            id: generateId(),
            plan_id: nextPlanId,
            material_category: 'supplement',
            textbook_id: item.textbookId || item.textbook_id || null,
            title: item.title || null,
            publisher: item.publisher || null,
            plan_detail: null,
            note: item.note || null,
            sort_order: itemIndex + 1,
          });
        });
    });

    if (schoolPlanRows.length > 0) {
      const { error } = await client.from('academic_exam_material_plans').insert(schoolPlanRows);
      if (error) throw error;
    }
    if (schoolItemRows.length > 0) {
      const { error } = await client.from('academic_exam_material_items').insert(schoolItemRows);
      if (error) throw error;
    }
    if (catalogRows.length > 0) {
      const { error } = await client.from('academy_curriculum_period_catalogs').insert(catalogRows);
      if (error) throw error;
    }
    if (academyPlanRows.length > 0) {
      const { error } = await client.from('academy_curriculum_period_plans').insert(academyPlanRows);
      if (error) throw error;
    }
    if (academyItemRows.length > 0) {
      const { error } = await client.from('academy_curriculum_period_items').insert(academyItemRows);
      if (error) throw error;
    }

    this._notify();
    return {
      migrated: schoolPlanRows.length > 0 || academyPlanRows.length > 0,
      schoolPlanCount: schoolPlanRows.length,
      academyPlanCount: academyPlanRows.length,
      catalogCount: catalogRows.length,
    };
  }

  async replaceAcademicEventExamDetails(eventId, items) {
    const client = this._ensureClient();
    const { error: deleteError } = await client
      .from('academic_event_exam_details')
      .delete()
      .eq('academic_event_id', eventId);

    if (deleteError) {
      if (this._isMissingTableError(deleteError, 'academic_event_exam_details')) {
        return [];
      }
      throw deleteError;
    }

    const payload = (items || [])
      .map((item, index) => ({
        id: item.id || generateId(),
        academic_event_id: eventId,
        school_id: item.schoolId || item.school_id || null,
        grade: item.grade || null,
        subject: item.subject || null,
        exam_date: item.examDate || item.exam_date || null,
        exam_date_status: item.examDateStatus || item.exam_date_status || ((item.examDate || item.exam_date) ? 'exact' : 'tbd'),
        curriculum_profile_id: item.curriculumProfileId || item.curriculum_profile_id || null,
        academy_curriculum_plan_id: item.academyCurriculumPlanId || item.academy_curriculum_plan_id || null,
        textbook_scope: item.textbookScope || item.textbook_scope || null,
        supplement_scope: item.supplementScope || item.supplement_scope || null,
        other_scope: item.otherScope || item.other_scope || null,
        note: item.note || null,
        sort_order: item.sortOrder ?? item.sort_order ?? index,
      }))
      .filter((item) => item.subject || item.exam_date || item.textbook_scope || item.supplement_scope || item.other_scope || item.note);

    if (payload.length > 0) {
      let { error } = await client.from('academic_event_exam_details').insert(payload);
      if (error && this._isMissingColumnError(error, ['exam_date_status'])) {
        const fallbackPayload = payload.map(({ exam_date_status, ...rest }) => rest);
        const fallbackResult = await client.from('academic_event_exam_details').insert(fallbackPayload);
        error = fallbackResult.error;
      }
      if (error) {
        if (this._isMissingTableError(error, 'academic_event_exam_details')) {
          return [];
        }
        throw error;
      }
    }

    this._notify();
    return payload.map((row) => this._processAcademicEventExamDetail(row));
  }

  async bulkUpsertAcademyCurriculumPlans(plans) {
    const client = this._ensureClient();
    const buildPayload = ({ includeAcademicYear }) => (plans || []).map((plan, index) => {
      const academicYear = Number(plan.academicYear || plan.academic_year || new Date().getFullYear());
      return {
        id: plan.id || generateId(),
        ...(includeAcademicYear ? { academic_year: academicYear } : null),
        academy_grade: plan.academyGrade || plan.academy_grade || null,
        subject: plan.subject || null,
        class_id: plan.classId || plan.class_id || null,
        main_textbook_id: plan.mainTextbookId || plan.main_textbook_id || null,
        note: includeAcademicYear ? (plan.note || null) : appendEmbeddedNoteMeta(plan.note, { academicYear }),
        sort_order: plan.sortOrder ?? plan.sort_order ?? index,
      };
    });

    let { data, error } = await client
      .from('academy_curriculum_plans')
      .upsert(buildPayload({ includeAcademicYear: true }), { onConflict: 'id' })
      .select();

    if (error && this._isMissingColumnError(error, ['academic_year'])) {
      const fallbackResult = await client
        .from('academy_curriculum_plans')
        .upsert(buildPayload({ includeAcademicYear: false }), { onConflict: 'id' })
        .select();
      data = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error) {
      if (this._isMissingTableError(error, 'academy_curriculum_plans')) {
        return [];
      }
      throw error;
    }

    this._notify();
    return (data || []).map((row) => this._processAcademyCurriculumPlan(row));
  }

  async replaceAcademyCurriculumMaterials(planId, items) {
    const client = this._ensureClient();
    const { error: deleteError } = await client
      .from('academy_curriculum_materials')
      .delete()
      .eq('plan_id', planId);

    if (deleteError) {
      if (this._isMissingTableError(deleteError, 'academy_curriculum_materials')) {
        return [];
      }
      throw deleteError;
    }

    const payload = (items || [])
      .map((item, index) => ({
        id: item.id || generateId(),
        plan_id: planId,
        textbook_id: item.textbookId || item.textbook_id || null,
        title: item.title || null,
        publisher: item.publisher || null,
        note: item.note || null,
        sort_order: item.sortOrder ?? item.sort_order ?? index,
      }))
      .filter((item) => item.title || item.textbook_id || item.publisher || item.note);

    if (payload.length > 0) {
      const { error } = await client.from('academy_curriculum_materials').insert(payload);
      if (error) {
        if (this._isMissingTableError(error, 'academy_curriculum_materials')) {
          return [];
        }
        throw error;
      }
    }

    this._notify();
    return payload.map((row) => this._processAcademyCurriculumMaterial(row));
  }

  async replaceAcademicExamScopes(profileId, items) {
    const client = this._ensureClient();
    const { error: deleteError } = await client.from('academic_exam_scopes').delete().eq('profile_id', profileId);
    if (deleteError) throw deleteError;

    const payload = (items || [])
      .map((item, index) => ({
        id: item.id || generateId(),
        profile_id: profileId,
        academic_event_id: item.academicEventId || null,
        academic_exam_day_id: item.academicExamDayId || null,
        period_label: item.periodLabel || null,
        textbook_scope: item.textbookScope || null,
        supplement_scope: item.supplementScope || null,
        other_scope: item.otherScope || null,
        note: item.note || null,
        sort_order: item.sortOrder ?? index,
      }))
      .filter((item) => item.academic_event_id || item.period_label || item.textbook_scope || item.supplement_scope || item.other_scope || item.note);

    if (payload.length > 0) {
      const { error } = await client.from('academic_exam_scopes').insert(payload);
      if (error) throw error;
    }

    this._notify();
    return payload.map((row) => this._processAcademicExamScope(row));
  }

  async replaceAcademicExamDays(schoolId, grade, items) {
    const client = this._ensureClient();
    const safeGrade = String(grade || '').trim();
    const { error: deleteError } = await client
      .from('academic_exam_days')
      .delete()
      .eq('school_id', schoolId)
      .eq('grade', safeGrade);

    if (deleteError) throw deleteError;

    const payload = (items || [])
      .map((item, index) => ({
        id: item.id || generateId(),
        school_id: schoolId,
        grade: safeGrade,
        subject: item.subject,
        exam_date: item.examDate || item.exam_date,
        label: item.label || '',
        note: item.note || '',
        sort_order: item.sortOrder ?? index,
      }))
      .filter((item) => item.subject && item.exam_date);

    if (payload.length > 0) {
      const { error } = await client.from('academic_exam_days').insert(payload);
      if (error) throw error;
    }

    this._notify();
    return payload.map((row) => this._processAcademicExamDay(row));
  }

  async getAppPreference(key) {
    const client = this._ensureClient();
    const { data, error } = await client.from('app_preferences').select('*').eq('key', key).maybeSingle();
    if (error) {
      if (this._isMissingTableError(error, 'app_preferences')) {
        return null;
      }
      throw error;
    }
    return data ? {
      ...data,
      value: data.value || null,
      updatedAt: data.updated_at || null,
    } : null;
  }

  async setAppPreference(key, value) {
    const client = this._ensureClient();
    const payload = {
      key,
      value,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await client
      .from('app_preferences')
      .upsert(payload, { onConflict: 'key' })
      .select()
      .single();

    if (error) {
      if (this._isMissingTableError(error, 'app_preferences')) {
        return null;
      }
      throw error;
    }

    return {
      ...data,
      value: data?.value || value,
      updatedAt: data?.updated_at || payload.updated_at,
    };
  }

  async getAcademicEvents() {
    const client = this._ensureClient();
    const { data } = await client.from('academic_events').select('*');
    return (data || []).map((row) => this._processAcademicEvent(row));
  }

  async bulkUpsertAcademicEvents(events) {
    const client = this._ensureClient();
    const { result } = await this._runAcademicEventMutation(
      () => this._buildAcademicEventPayloadCandidates(events),
      (payload) => client.from('academic_events').upsert(payload, { onConflict: 'id' }).select()
    );
    if (result.error) throw result.error;
    this._notify();
    return (result.data || []).map((row) => this._processAcademicEvent(row));
  }

  async addAcademicEvent(event) {
    const client = this._ensureClient();
    const { result } = await this._runAcademicEventMutation(
      () => this._buildAcademicEventPayloadCandidates(event),
      async (payload) => {
        const rows = Array.isArray(payload) ? payload : [payload];
        const response = await client.from('academic_events').insert(rows).select().single();
        return response;
      }
    );
    if (result.error) throw result.error;
    this._notify();
    return this._processAcademicEvent(result.data);
  }

  async updateAcademicEvent(id, updates) {
    const client = this._ensureClient();
    const baseEvent = {
      ...updates,
      id,
      school_id: updates.schoolId ?? updates.school_id,
      grade: updates.grade || 'all',
      note: updates.note || null,
    };
    delete baseEvent.schoolId;

    const { result } = await this._runAcademicEventMutation(
      () => this._buildAcademicEventPayloadCandidates(baseEvent),
      async (payload) => {
        const row = Array.isArray(payload) ? payload[0] : payload;
        return client.from('academic_events').update(row).eq('id', id);
      }
    );
    if (result.error) throw result.error;
    this._notify();
  }

  async deleteAcademicEvent(id) {
    const client = this._ensureClient();
    const { error } = await client.from('academic_events').delete().eq('id', id);
    if (error) throw error;
    this._notify();
  }

  _processClass(classRow) {
    if (!classRow) return null;
    return {
      ...classRow,
      className: classRow.name,
      status: normalizeClassStatus(classRow.status) || computeClassStatus({
        status: classRow.status,
        startDate: classRow.start_date,
        endDate: classRow.end_date
      }),
      classroom: this._normalizeClassroomValue(classRow.room),
      room: classRow.room,
      roomRaw: classRow.room,
      termId: classRow.term_id || null,
      studentIds: classRow.student_ids || [],
      textbookIds: classRow.textbook_ids || [],
      waitlistIds: classRow.waitlist_ids || [],
      startDate: classRow.start_date,
      endDate: classRow.end_date,
      textbookInfo: classRow.textbook_info,
      lessons: classRow.lessons || [],
      schedulePlan: classRow.schedule_plan || null,
    };
  }

  _processAcademicSchool(schoolRow) {
    if (!schoolRow) return null;
    return {
      ...schoolRow,
      sortOrder: schoolRow.sort_order || 0,
      textbooks: schoolRow.textbooks || {},
      category: schoolRow.category || 'high',
    };
  }

  _processTeacherCatalog(resourceRow) {
    if (!resourceRow) return null;
    return {
      ...resourceRow,
      name: resourceRow.name || '',
      subjects: Array.isArray(resourceRow.subjects) ? resourceRow.subjects : [],
      isVisible: resourceRow.is_visible !== false,
      sortOrder: resourceRow.sort_order ?? 0,
    };
  }

  _processClassroomCatalog(resourceRow) {
    if (!resourceRow) return null;
    return {
      ...resourceRow,
      name: this._normalizeClassroomValue(resourceRow.name || ''),
      subjects: Array.isArray(resourceRow.subjects) ? resourceRow.subjects : [],
      isVisible: resourceRow.is_visible !== false,
      sortOrder: resourceRow.sort_order ?? 0,
    };
  }

  _processClassTerm(termRow) {
    if (!termRow) return null;
    return {
      ...termRow,
      academicYear: Number(termRow.academic_year || new Date().getFullYear()),
      startDate: termRow.start_date || '',
      endDate: termRow.end_date || '',
      sortOrder: termRow.sort_order ?? 0,
      status: normalizeClassStatus(termRow.status) || termRow.status || '수업 진행 중',
    };
  }

  _processAcademicCurriculumProfile(profileRow) {
    if (!profileRow) return null;
    const meta = extractEmbeddedNoteMeta(profileRow.note);
    return {
      ...profileRow,
      academicYear: Number(profileRow.academic_year || meta.academicYear || new Date().getFullYear()),
      schoolId: profileRow.school_id,
      mainTextbookTitle: profileRow.main_textbook_title || '',
      mainTextbookPublisher: profileRow.main_textbook_publisher || '',
      note: stripEmbeddedNoteMeta(profileRow.note),
    };
  }

  _processAcademicSupplementMaterial(materialRow) {
    if (!materialRow) return null;
    return {
      ...materialRow,
      profileId: materialRow.profile_id,
      publisher: materialRow.publisher || '',
      note: materialRow.note || '',
      sortOrder: materialRow.sort_order ?? 0,
    };
  }

  _processAcademicExamScope(scopeRow) {
    if (!scopeRow) return null;
    return {
      ...scopeRow,
      profileId: scopeRow.profile_id,
      academicEventId: scopeRow.academic_event_id || '',
      academicExamDayId: scopeRow.academic_exam_day_id || '',
      periodLabel: scopeRow.period_label || '',
      textbookScope: scopeRow.textbook_scope || '',
      supplementScope: scopeRow.supplement_scope || '',
      otherScope: scopeRow.other_scope || '',
      note: scopeRow.note || '',
      sortOrder: scopeRow.sort_order ?? 0,
    };
  }

  _processAcademicExamDay(dayRow) {
    if (!dayRow) return null;
    return {
      ...dayRow,
      schoolId: dayRow.school_id,
      examDate: dayRow.exam_date || '',
      label: dayRow.label || '',
      note: dayRow.note || '',
      sortOrder: dayRow.sort_order ?? 0,
    };
  }

  _processAcademicEventExamDetail(detailRow) {
    if (!detailRow) return null;
    return {
      ...detailRow,
      academicEventId: detailRow.academic_event_id,
      schoolId: detailRow.school_id || '',
      examDate: detailRow.exam_date || '',
      examDateStatus: detailRow.exam_date_status || (detailRow.exam_date ? 'exact' : 'tbd'),
      curriculumProfileId: detailRow.curriculum_profile_id || '',
      academyCurriculumPlanId: detailRow.academy_curriculum_plan_id || '',
      textbookScope: detailRow.textbook_scope || '',
      supplementScope: detailRow.supplement_scope || '',
      otherScope: detailRow.other_scope || '',
      note: detailRow.note || '',
      sortOrder: detailRow.sort_order ?? 0,
    };
  }

  _processAcademyCurriculumPlan(planRow) {
    if (!planRow) return null;
    const meta = extractEmbeddedNoteMeta(planRow.note);
    return {
      ...planRow,
      academicYear: Number(planRow.academic_year || meta.academicYear || new Date().getFullYear()),
      academyGrade: planRow.academy_grade || '',
      classId: planRow.class_id || '',
      mainTextbookId: planRow.main_textbook_id || '',
      note: stripEmbeddedNoteMeta(planRow.note),
      sortOrder: planRow.sort_order ?? 0,
    };
  }

  _processAcademyCurriculumMaterial(materialRow) {
    if (!materialRow) return null;
    return {
      ...materialRow,
      planId: materialRow.plan_id,
      textbookId: materialRow.textbook_id || '',
      title: materialRow.title || '',
      publisher: materialRow.publisher || '',
      note: materialRow.note || '',
      sortOrder: materialRow.sort_order ?? 0,
    };
  }

  _processAcademicExamMaterialPlan(planRow) {
    if (!planRow) return null;
    return {
      ...planRow,
      academicYear: Number(planRow.academic_year || new Date().getFullYear()),
      schoolId: planRow.school_id,
      examPeriodCode: planRow.exam_period_code || '',
      note: planRow.note || '',
      sortOrder: planRow.sort_order ?? 0,
    };
  }

  _processAcademicExamMaterialItem(itemRow) {
    if (!itemRow) return null;
    return {
      ...itemRow,
      planId: itemRow.plan_id,
      materialCategory: itemRow.material_category || 'other',
      scopeDetail: itemRow.scope_detail || '',
      note: itemRow.note || '',
      sortOrder: itemRow.sort_order ?? 0,
    };
  }

  _processAcademyCurriculumPeriodCatalog(row) {
    if (!row) return null;
    return {
      ...row,
      academicYear: Number(row.academic_year || new Date().getFullYear()),
      academyGrade: row.academy_grade || '',
      periodCode: row.period_code || '',
      periodLabel: row.period_label || '',
      sortOrder: row.sort_order ?? 0,
    };
  }

  _processAcademyCurriculumPeriodPlan(planRow) {
    if (!planRow) return null;
    return {
      ...planRow,
      academicYear: Number(planRow.academic_year || new Date().getFullYear()),
      academyGrade: planRow.academy_grade || '',
      catalogId: planRow.catalog_id || '',
      periodType: planRow.period_type || 'fixed',
      periodCode: planRow.period_code || '',
      periodLabel: planRow.period_label || '',
      scopeType: planRow.scope_type || 'template',
      classId: planRow.class_id || '',
      note: planRow.note || '',
      sortOrder: planRow.sort_order ?? 0,
    };
  }

  _processAcademyCurriculumPeriodItem(itemRow) {
    if (!itemRow) return null;
    return {
      ...itemRow,
      planId: itemRow.plan_id,
      materialCategory: itemRow.material_category || 'other',
      textbookId: itemRow.textbook_id || '',
      planDetail: itemRow.plan_detail || '',
      note: itemRow.note || '',
      sortOrder: itemRow.sort_order ?? 0,
    };
  }

  _processAcademicEvent(eventRow) {
    if (!eventRow) return null;
    const meta = extractEmbeddedNoteMeta(eventRow.note);
    const derivedStart = eventRow.start || eventRow.start_date || eventRow.date || '';
    const derivedEnd = eventRow.end || eventRow.end_date || meta.rangeEnd || derivedStart;
    return {
      ...eventRow,
      schoolId: eventRow.school_id || eventRow.schoolId || null,
      school: eventRow.school || null,
      type: eventRow.type || '',
      start: derivedStart,
      end: derivedEnd,
      color: eventRow.color || null,
      grade: eventRow.grade || 'all',
      academicYear:
        Number(meta.academicYear || String(derivedStart || '').slice(0, 4)) ||
        new Date().getFullYear(),
      note: stripEmbeddedNoteMeta(eventRow.note),
      meta,
      roadmapSync: meta.roadmapSync || null,
      roadmapPeriodCode: meta.roadmapPeriodCode || '',
      roadmapSubject: meta.roadmapSubject || '',
    };
  }

  _processStudent(studentRow) {
    if (!studentRow) return null;
    return {
      ...studentRow,
      classIds: studentRow.class_ids || [],
      waitlistClassIds: studentRow.waitlist_class_ids || [],
      enrollDate: studentRow.enroll_date,
      parentContact: studentRow.parent_contact
    };
  }

  _processTextbook(textbookRow) {
    if (!textbookRow) return null;
    return {
      ...textbookRow,
      title: textbookRow.title || textbookRow.name || '',
      publisher: textbookRow.publisher || '',
      price: Number(textbookRow.price || 0),
      tags: textbookRow.tags || [],
      lessons: textbookRow.lessons || []
    };
  }

  _processProgressLog(progressRow) {
    if (!progressRow) return null;

    const completedLessonIds = progressRow.completed_lesson_ids || progressRow.completedLessonIds || [];
    const chapterId = progressRow.chapter_id || progressRow.chapterId || completedLessonIds[0] || null;

    return {
      ...progressRow,
      classId: progressRow.class_id || progressRow.classId,
      textbookId: progressRow.textbook_id || progressRow.textbookId || null,
      chapterId,
      completedLessonIds: completedLessonIds.length > 0
        ? completedLessonIds
        : (chapterId ? [chapterId] : [])
    };
  }

  async connect() {
    return Boolean(supabase);
  }

  disconnect() {
    if (this.channel && supabase) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }
}

export const dataService = new DataService();
