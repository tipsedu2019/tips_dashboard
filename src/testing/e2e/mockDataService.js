import { createE2EMockData } from './mockAppData.js';

function clone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function createId(prefix = 'e2e') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const MOCK_STATE_STORAGE_KEY = 'tips:e2e:mock-data-service:state:v1';
const MOCK_PREFERENCES_STORAGE_KEY = 'tips:e2e:mock-data-service:preferences:v1';

function resolveStorage(explicitStorage) {
  if (explicitStorage) return explicitStorage;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export class E2EMockDataService {
  constructor({ storage } = {}) {
    this.listeners = new Set();
    this.storage = resolveStorage(storage);
    this.preferences = new Map();
    this.reset();
  }

  reset() {
    const persistedState = this._readJson(MOCK_STATE_STORAGE_KEY);
    const persistedPreferences = this._readJson(MOCK_PREFERENCES_STORAGE_KEY);

    this.state = persistedState || createE2EMockData();
    this.preferences = new Map(
      Array.isArray(persistedPreferences)
        ? persistedPreferences
            .filter((entry) => Array.isArray(entry) && entry.length === 2)
            .map(([key, value]) => [key, value])
        : []
    );
    this._persist();
  }

  _snapshot(overrides = {}) {
    return {
      ...clone(this.state),
      isConnected: true,
      isLoading: false,
      lastUpdated: new Date(),
      error: null,
      ...overrides,
    };
  }

  _emit() {
    const snapshot = this._snapshot();
    this._persist();
    this.listeners.forEach((listener) => listener(snapshot));
    return snapshot;
  }

  _readJson(key) {
    if (!this.storage?.getItem) {
      return null;
    }

    try {
      const raw = this.storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  _writeJson(key, value) {
    if (!this.storage?.setItem) {
      return;
    }

    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage failures in the lightweight E2E service.
    }
  }

  _persist() {
    this._writeJson(MOCK_STATE_STORAGE_KEY, this.state);
    this._writeJson(MOCK_PREFERENCES_STORAGE_KEY, [...this.preferences.entries()]);
  }

  _upsertById(collectionKey, rows = []) {
    const current = Array.isArray(this.state[collectionKey]) ? [...this.state[collectionKey]] : [];
    const nextMap = new Map(current.map((item) => [item.id, item]));

    rows.forEach((row, index) => {
      const id = row.id || createId(collectionKey);
      nextMap.set(id, {
        ...(nextMap.get(id) || {}),
        ...clone(row),
        id,
        sortOrder: row.sortOrder ?? row.sort_order ?? nextMap.get(id)?.sortOrder ?? index,
      });
    });

    this.state[collectionKey] = [...nextMap.values()];
    return rows.map((row) => nextMap.get(row.id || rows.find((item) => item === row)?.id) || row);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this._snapshot());
    return () => this.listeners.delete(listener);
  }

  async normalizeLegacyClassrooms() {
    return 0;
  }

  async getAcademicWorkspaceSupport() {
    return {
      ready: true,
      missingTables: [],
      missingOptionalTables: [],
      checkedAt: new Date(),
    };
  }

  async getCurriculumRoadmapSupport() {
    return {
      ready: true,
      missingTables: [],
      checkedAt: new Date(),
    };
  }

  async migrateLegacyCurriculumRoadmap() {
    return {
      migrated: false,
      reason: 'e2e-fixture',
    };
  }

  async getAppPreference(key) {
    return this.preferences.get(key) || null;
  }

  async setAppPreference(key, value) {
    const next = {
      key,
      value: clone(value),
      updatedAt: new Date().toISOString(),
    };
    this.preferences.set(key, next);
    this._persist();
    return next;
  }

  async addClass(classObj) {
    const saved = {
      id: classObj.id || createId('class'),
      ...clone(classObj),
    };
    this._upsertById('classes', [saved]);
    this._emit();
    return clone(saved);
  }

  async updateClass(id, updates) {
    this.state.classes = (this.state.classes || []).map((item) => (
      item.id === id ? { ...item, ...clone(updates), id } : item
    ));
    this._emit();
    return true;
  }

  async deleteClass(id) {
    this.state.classes = (this.state.classes || []).filter((item) => item.id !== id);
    this.state.classScheduleSyncGroupMembers = (this.state.classScheduleSyncGroupMembers || []).filter(
      (item) => item.classId !== id
    );
    this._emit();
  }

  async addProgressLog(log) {
    const saved = {
      id: log.id || createId('progress-log'),
      classId: log.classId,
      textbookId: log.textbookId || null,
      chapterId: log.chapterId || null,
      completedLessonIds: Array.isArray(log.completedLessonIds)
        ? [...log.completedLessonIds]
        : (log.chapterId ? [log.chapterId] : []),
      date: log.date || new Date().toISOString(),
      content: log.content || '',
      homework: log.homework || '',
    };
    this.state.progressLogs = [...(this.state.progressLogs || []), saved];
    this._emit();
    return clone(saved);
  }

  async deleteProgressLog(logId) {
    this.state.progressLogs = (this.state.progressLogs || []).filter((item) => item.id !== logId);
    this._emit();
  }

  async upsertSessionProgressLog(log) {
    const progressKey =
      log.progressKey ||
      [log.classId, log.sessionId, log.textbookId].map((value) => String(value || '').trim()).join(':');

    const saved = {
      id: log.id || createId('session-progress'),
      classId: log.classId,
      textbookId: log.textbookId || null,
      progressKey,
      sessionId: log.sessionId || '',
      sessionOrder: Number(log.sessionOrder || 0),
      status: log.status || 'pending',
      rangeStart: log.rangeStart || '',
      rangeEnd: log.rangeEnd || '',
      rangeLabel: log.rangeLabel || '',
      publicNote: log.publicNote || '',
      teacherNote: log.teacherNote || '',
      updatedAt: log.updatedAt || new Date().toISOString(),
      content: log.content || log.rangeLabel || '',
      homework: log.homework || '',
      date: log.date || log.updatedAt || new Date().toISOString(),
    };

    const current = [...(this.state.progressLogs || [])];
    const index = current.findIndex((item) => item.progressKey === progressKey);
    if (index >= 0) {
      current[index] = { ...current[index], ...saved, id: current[index].id || saved.id };
    } else {
      current.push(saved);
    }
    this.state.progressLogs = current;
    this._emit();
    return clone(index >= 0 ? current[index] : saved);
  }

  async deleteSessionProgressLog({ id = '', progressKey = '' } = {}) {
    this.state.progressLogs = (this.state.progressLogs || []).filter((item) => {
      if (id) {
        return item.id !== id;
      }
      if (progressKey) {
        return item.progressKey !== progressKey;
      }
      return true;
    });
    this._emit();
  }

  async upsertClassScheduleSyncGroup(group) {
    const saved = {
      id: group.id || createId('sync-group'),
      termId: group.termId || group.term_id || null,
      name: group.name || '',
      subject: group.subject || '',
      color: group.color || '#3182f6',
      note: group.note || '',
      updatedAt: new Date().toISOString(),
    };
    this._upsertById('classScheduleSyncGroups', [saved]);
    this._emit();
    return clone(saved);
  }

  async replaceClassScheduleSyncGroupMembers(groupId, members = []) {
    const retained = (this.state.classScheduleSyncGroupMembers || []).filter((item) => item.groupId !== groupId);
    const saved = members.map((member, index) => ({
      id: member.id || createId('sync-member'),
      groupId,
      classId: member.classId,
      sortOrder: member.sortOrder ?? index,
      createdAt: new Date().toISOString(),
    }));
    this.state.classScheduleSyncGroupMembers = [...retained, ...saved];
    this._emit();
    return clone(saved);
  }

  async deleteClassScheduleSyncGroup(groupId) {
    this.state.classScheduleSyncGroups = (this.state.classScheduleSyncGroups || []).filter(
      (item) => item.id !== groupId
    );
    this.state.classScheduleSyncGroupMembers = (this.state.classScheduleSyncGroupMembers || []).filter(
      (item) => item.groupId !== groupId
    );
    this._emit();
  }

  async upsertAcademicSchools(rows = []) {
    const saved = rows.map((row, index) => ({
      id: row.id || createId('school'),
      name: row.name,
      category: row.category || 'middle',
      color: row.color || '#1F6B5B',
      textbooks: row.textbooks || {},
      sortOrder: row.sortOrder ?? row.sort_order ?? index,
    }));
    this._upsertById('academicSchools', saved);
    this._emit();
    return clone(saved);
  }

  async deleteAcademicSchools(ids = []) {
    const idSet = new Set(ids);
    this.state.academicSchools = (this.state.academicSchools || []).filter((item) => !idSet.has(item.id));
    this._emit();
  }

  async upsertTeacherCatalogs(rows = []) {
    const saved = rows.map((row, index) => ({
      id: row.id || createId('teacher'),
      name: row.name,
      subjects: row.subjects || [],
      isVisible: row.isVisible !== false,
      sortOrder: row.sortOrder ?? row.sort_order ?? index,
    }));
    this._upsertById('teacherCatalogs', saved);
    this._emit();
    return clone(saved);
  }

  async deleteTeacherCatalogs(ids = []) {
    const idSet = new Set(ids);
    this.state.teacherCatalogs = (this.state.teacherCatalogs || []).filter((item) => !idSet.has(item.id));
    this._emit();
  }

  async upsertClassroomCatalogs(rows = []) {
    const saved = rows.map((row, index) => ({
      id: row.id || createId('classroom'),
      name: row.name,
      subjects: row.subjects || [],
      isVisible: row.isVisible !== false,
      sortOrder: row.sortOrder ?? row.sort_order ?? index,
    }));
    this._upsertById('classroomCatalogs', saved);
    this._emit();
    return clone(saved);
  }

  async deleteClassroomCatalogs(ids = []) {
    const idSet = new Set(ids);
    this.state.classroomCatalogs = (this.state.classroomCatalogs || []).filter((item) => !idSet.has(item.id));
    this._emit();
  }

  async upsertClassTerms(rows = []) {
    const saved = rows.map((row, index) => ({
      id: row.id || createId('term'),
      academicYear: row.academicYear || row.academic_year || new Date().getFullYear(),
      name: row.name || '',
      status: row.status || '수업 진행 중',
      startDate: row.startDate || row.start_date || '',
      endDate: row.endDate || row.end_date || '',
      sortOrder: row.sortOrder ?? row.sort_order ?? index,
    }));
    this._upsertById('classTerms', saved);
    this.state.classTerms = [...(this.state.classTerms || [])].sort((left, right) => {
      const yearGap = Number(right.academicYear || 0) - Number(left.academicYear || 0);
      if (yearGap !== 0) {
        return yearGap;
      }
      return Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
    });
    this._emit();
    return clone(saved);
  }

  async deleteClassTerm(id) {
    this.state.classTerms = (this.state.classTerms || []).filter((item) => item.id !== id);
    this._emit();
  }

  async addAcademicEvent(payload) {
    const saved = {
      id: createId('event'),
      ...clone(payload),
    };
    this.state.academicEvents = [...(this.state.academicEvents || []), saved];
    this._emit();
    return clone(saved);
  }

  async updateAcademicEvent(id, payload) {
    this.state.academicEvents = (this.state.academicEvents || []).map((event) => (
      event.id === id ? { ...event, ...clone(payload), id } : event
    ));
    this._emit();
  }

  async deleteAcademicEvent(id) {
    this.state.academicEvents = (this.state.academicEvents || []).filter((event) => event.id !== id);
    this.state.academicEventExamDetails = (this.state.academicEventExamDetails || []).filter(
      (detail) => detail.academicEventId !== id
    );
    this._emit();
  }

  async bulkUpsertAcademicEvents(events = []) {
    const current = new Map((this.state.academicEvents || []).map((item) => [item.id, item]));
    const saved = events.map((event) => {
      const id = event.id || createId('event');
      const next = { ...(current.get(id) || {}), ...clone(event), id };
      current.set(id, next);
      return next;
    });
    this.state.academicEvents = [...current.values()];
    this._emit();
    return clone(saved);
  }

  async replaceAcademicEventExamDetails(eventId, items = []) {
    const retained = (this.state.academicEventExamDetails || []).filter((detail) => detail.academicEventId !== eventId);
    const saved = items.map((item, index) => ({
      id: item.id || createId('exam-detail'),
      academicEventId: eventId,
      schoolId: item.schoolId || null,
      grade: item.grade || null,
      subject: item.subject || null,
      examDate: item.examDate || null,
      examDateStatus: item.examDateStatus || 'tbd',
      curriculumProfileId: item.curriculumProfileId || null,
      academyCurriculumPlanId: item.academyCurriculumPlanId || null,
      textbookScope: item.textbookScope || null,
      supplementScope: item.supplementScope || null,
      otherScope: item.otherScope || null,
      note: item.note || null,
      sortOrder: item.sortOrder ?? index,
    }));
    this.state.academicEventExamDetails = [...retained, ...saved];
    this._emit();
    return clone(saved);
  }

  async bulkUpsertAcademicExamMaterialPlans(plans = []) {
    const current = new Map((this.state.academicExamMaterialPlans || []).map((item) => [item.id, item]));
    const saved = plans.map((plan, index) => {
      const id = plan.id || createId('school-plan');
      const next = {
        ...(current.get(id) || {}),
        ...clone(plan),
        id,
        sortOrder: plan.sortOrder ?? plan.sort_order ?? index,
      };
      current.set(id, next);
      return next;
    });
    this.state.academicExamMaterialPlans = [...current.values()];
    this._emit();
    return clone(saved);
  }

  async replaceAcademicExamMaterialItems(planId, items = []) {
    const retained = (this.state.academicExamMaterialItems || []).filter((item) => item.planId !== planId);
    const saved = items.map((item, index) => ({
      id: item.id || createId('school-item'),
      planId,
      materialCategory: item.materialCategory || 'other',
      title: item.title || null,
      publisher: item.publisher || null,
      scopeDetail: item.scopeDetail || null,
      note: item.note || null,
      sortOrder: item.sortOrder ?? index,
    }));
    this.state.academicExamMaterialItems = [...retained, ...saved];
    this._emit();
    return clone(saved);
  }

  async deleteAcademicExamMaterialPlan(planId) {
    this.state.academicExamMaterialPlans = (this.state.academicExamMaterialPlans || []).filter((item) => item.id !== planId);
    this.state.academicExamMaterialItems = (this.state.academicExamMaterialItems || []).filter((item) => item.planId !== planId);
    this._emit();
  }

  async upsertAcademyCurriculumPeriodCatalogs(periods = []) {
    const current = new Map((this.state.academyCurriculumPeriodCatalogs || []).map((item) => [item.id, item]));
    const saved = periods.map((period, index) => {
      const id = period.id || createId('period-catalog');
      const next = {
        ...(current.get(id) || {}),
        ...clone(period),
        id,
        sortOrder: period.sortOrder ?? period.sort_order ?? index,
      };
      current.set(id, next);
      return next;
    });
    this.state.academyCurriculumPeriodCatalogs = [...current.values()];
    this._emit();
    return clone(saved);
  }

  async deleteAcademyCurriculumPeriodCatalog(catalogId) {
    this.state.academyCurriculumPeriodCatalogs = (this.state.academyCurriculumPeriodCatalogs || []).filter(
      (item) => item.id !== catalogId
    );
    this._emit();
  }

  async bulkUpsertAcademyCurriculumPeriodPlans(plans = []) {
    const current = new Map((this.state.academyCurriculumPeriodPlans || []).map((item) => [item.id, item]));
    const saved = plans.map((plan, index) => {
      const id = plan.id || createId('academy-plan');
      const next = {
        ...(current.get(id) || {}),
        ...clone(plan),
        id,
        sortOrder: plan.sortOrder ?? plan.sort_order ?? index,
      };
      current.set(id, next);
      return next;
    });
    this.state.academyCurriculumPeriodPlans = [...current.values()];
    this._emit();
    return clone(saved);
  }

  async replaceAcademyCurriculumPeriodItems(planId, items = []) {
    const retained = (this.state.academyCurriculumPeriodItems || []).filter((item) => item.planId !== planId);
    const saved = items.map((item, index) => ({
      id: item.id || createId('academy-item'),
      planId,
      materialCategory: item.materialCategory || 'other',
      textbookId: item.textbookId || null,
      title: item.title || null,
      publisher: item.publisher || null,
      planDetail: item.planDetail || null,
      note: item.note || null,
      sortOrder: item.sortOrder ?? index,
    }));
    this.state.academyCurriculumPeriodItems = [...retained, ...saved];
    this._emit();
    return clone(saved);
  }

  async deleteAcademyCurriculumPeriodPlan(planId) {
    this.state.academyCurriculumPeriodPlans = (this.state.academyCurriculumPeriodPlans || []).filter(
      (item) => item.id !== planId
    );
    this.state.academyCurriculumPeriodItems = (this.state.academyCurriculumPeriodItems || []).filter(
      (item) => item.planId !== planId
    );
    this._emit();
  }
}

export const e2eDataService = new E2EMockDataService();
