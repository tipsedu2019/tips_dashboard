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
  academicCurriculumProfiles: [],
  academicSupplementMaterials: [],
  academicExamScopes: [],
  academicExamDays: [],
  academicEventExamDetails: [],
  academyCurriculumPlans: [],
  academyCurriculumMaterials: [],
  isConnected: false,
  isLoading: false,
  lastUpdated: null,
  error: null
};

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

export class DataService {
  constructor() {
    this.listeners = new Set();
    this.channel = null;
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
        this._notify();
      })
      .subscribe();
  }

  _snapshot(overrides = {}) {
    return {
      ...EMPTY_SNAPSHOT,
      lastUpdated: this.lastUpdated,
      error: this.error,
      ...overrides
    };
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
    try {
      const snapshot = await this._getSnapshot();
      this.listeners.forEach((listener) => listener(snapshot));
    } catch (err) {
      console.error('DataService notification error:', err);
    }
  }

  async _getSnapshot() {
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
      const resources = [
        {
          key: 'classes',
          table: 'classes',
          map: (rows) => (rows || []).map((row) => this._processClass(row))
        },
        {
          key: 'classTerms',
          table: 'class_terms',
          map: (rows) => (rows || []).map((row) => this._processClassTerm(row)),
          optional: true
        },
        {
          key: 'students',
          table: 'students',
          map: (rows) => (rows || []).map((row) => this._processStudent(row))
        },
        {
          key: 'textbooks',
          table: 'textbooks',
          map: (rows) => (rows || []).map((row) => this._processTextbook(row))
        },
        {
          key: 'progressLogs',
          table: 'progress_logs',
          map: (rows) => (rows || []).map((row) => this._processProgressLog(row))
        },
        {
          key: 'academicEvents',
          table: 'academic_events',
          map: (rows) => (rows || []).map((row) => this._processAcademicEvent(row))
        },
        {
          key: 'academicSchools',
          table: 'academic_schools',
          map: (rows) => (rows || []).map((row) => this._processAcademicSchool(row)),
          optional: true
        },
        {
          key: 'academicCurriculumProfiles',
          table: 'academic_curriculum_profiles',
          map: (rows) => (rows || []).map((row) => this._processAcademicCurriculumProfile(row)),
          optional: true
        },
        {
          key: 'academicSupplementMaterials',
          table: 'academic_supplement_materials',
          map: (rows) => (rows || []).map((row) => this._processAcademicSupplementMaterial(row)),
          optional: true
        },
        {
          key: 'academicExamScopes',
          table: 'academic_exam_scopes',
          map: (rows) => (rows || []).map((row) => this._processAcademicExamScope(row)),
          optional: true
        },
        {
          key: 'academicExamDays',
          table: 'academic_exam_days',
          map: (rows) => (rows || []).map((row) => this._processAcademicExamDay(row)),
          optional: true
        },
        {
          key: 'academicEventExamDetails',
          table: 'academic_event_exam_details',
          map: (rows) => (rows || []).map((row) => this._processAcademicEventExamDetail(row)),
          optional: true
        },
        {
          key: 'academyCurriculumPlans',
          table: 'academy_curriculum_plans',
          map: (rows) => (rows || []).map((row) => this._processAcademyCurriculumPlan(row)),
          optional: true
        },
        {
          key: 'academyCurriculumMaterials',
          table: 'academy_curriculum_materials',
          map: (rows) => (rows || []).map((row) => this._processAcademyCurriculumMaterial(row)),
          optional: true
        }
      ];

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

          nextData[resource.key] = resource.map(data);
          return;
        }

        if (!resource.optional || !this._isMissingTableError(settled.reason, resource.table)) {
          errors.push(settled.reason);
        }
        nextData[resource.key] = EMPTY_SNAPSHOT[resource.key];
      });

      if (errors.length > 0) {
        console.error('Supabase fetch errors:', errors);
      }

      const uniqueErrorMessages = [...new Set(
        errors
          .map((error) => error?.message || String(error))
          .filter(Boolean)
      )];

      this.isConnected = uniqueErrorMessages.length === 0;
      this.lastUpdated = new Date();
      this.error = uniqueErrorMessages.length > 0 ? uniqueErrorMessages[0] : null;

      return this._snapshot({
        ...nextData,
        isConnected: this.isConnected,
        isLoading: false,
        lastUpdated: this.lastUpdated,
        error: this.error
      });
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
    const payload = this._pickFields(textbook, ['id', 'title', 'publisher', 'price', 'tags', 'lessons']);
    const { data, error } = await client.from('textbooks').insert([payload]).select().single();
    if (error) throw error;
    this._notify();
    return this._processTextbook(data);
  }

  async updateTextbook(id, updates) {
    const client = this._ensureClient();
    const finalUpdates = this._pickFields(updates, ['title', 'publisher', 'price', 'tags', 'lessons']);
    const { error } = await client.from('textbooks').update(finalUpdates).eq('id', id);
    if (error) throw error;
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
        .select('id, school_id, grade, subject')
        .eq('school_id', schoolId);

      if (error) {
        throw error;
      }

      existingRows.push(...(data || []));
    }

    const existingIdByKey = new Map(
      existingRows.map((row) => [`${row.school_id}::${row.grade}::${row.subject}`, row.id])
    );

    const payload = requestedProfiles.map((profile) => {
      const key = `${profile.schoolId}::${profile.grade}::${profile.subject}`;
      return {
        id: profile.id || existingIdByKey.get(key) || generateId(),
        academic_year: Number(profile.academicYear || profile.academic_year || new Date().getFullYear()),
        school_id: profile.schoolId,
        grade: profile.grade,
        subject: profile.subject,
        main_textbook_title: profile.mainTextbookTitle || null,
        main_textbook_publisher: profile.mainTextbookPublisher || null,
        note: profile.note || null,
      };
    });

    const { data, error } = await client
      .from('academic_curriculum_profiles')
      .upsert(payload, { onConflict: 'school_id,grade,subject' })
      .select();

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
    const payload = (plans || []).map((plan, index) => ({
      id: plan.id || generateId(),
      academic_year: Number(plan.academicYear || plan.academic_year || new Date().getFullYear()),
      academy_grade: plan.academyGrade || plan.academy_grade || null,
      subject: plan.subject || null,
      class_id: plan.classId || plan.class_id || null,
      main_textbook_id: plan.mainTextbookId || plan.main_textbook_id || null,
      note: plan.note || null,
      sort_order: plan.sortOrder ?? plan.sort_order ?? index,
    }));

    const { data, error } = await client
      .from('academy_curriculum_plans')
      .upsert(payload, { onConflict: 'id' })
      .select();

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
    return {
      ...profileRow,
      academicYear: Number(profileRow.academic_year || new Date().getFullYear()),
      schoolId: profileRow.school_id,
      mainTextbookTitle: profileRow.main_textbook_title || '',
      mainTextbookPublisher: profileRow.main_textbook_publisher || '',
      note: profileRow.note || '',
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
    return {
      ...planRow,
      academicYear: Number(planRow.academic_year || new Date().getFullYear()),
      academyGrade: planRow.academy_grade || '',
      classId: planRow.class_id || '',
      mainTextbookId: planRow.main_textbook_id || '',
      note: planRow.note || '',
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
      note: eventRow.note || ''
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
