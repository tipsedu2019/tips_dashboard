import { createE2EMockData } from './mockAppData';

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

class E2EMockDataService {
  constructor() {
    this.listeners = new Set();
    this.preferences = new Map();
    this.reset();
  }

  reset() {
    this.state = createE2EMockData();
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
    this.listeners.forEach((listener) => listener(snapshot));
    return snapshot;
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
    return next;
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
