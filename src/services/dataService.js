import { supabase } from '../lib/supabase';

export class DataService {
  constructor() {
    this.listeners = new Set();
    this.isConnected = false; 
    this.isLoading = false;
    this.lastUpdated = null;
    this.error = null;
    
    // Subscribe to changes in all tables for real-time updates
    this._setupRealtime();
  }

  _setupRealtime() {
    supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        this._notify();
      })
      .subscribe();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    // Send initial data
    this._getSnapshot().then(snap => {
      listener(snap);
    });
    return () => this.listeners.delete(listener);
  }

  async _notify() {
    try {
      const snap = await this._getSnapshot();
      this.listeners.forEach(fn => fn(snap));
    } catch (err) {
      console.error('DataService notification error:', err);
    }
  }

  async _getSnapshot() {
    try {
      const results = await Promise.all([
        supabase.from('classes').select('*'),
        supabase.from('students').select('*'),
        supabase.from('textbooks').select('*'),
        supabase.from('progress_logs').select('*'),
        supabase.from('academic_events').select('*'),
        supabase.from('reference_materials').select('*')
      ]);

      const errors = results.filter(r => r.error).map(r => r.error);
      if (errors.length > 0) {
          console.error('Supabase fetch errors:', errors);
          // Still try to return what we have, but mark as disconnected/error
      }

      const [
        { data: classes },
        { data: students },
        { data: textbooks },
        { data: progressLogs },
        { data: academicEvents },
        { data: referenceMaterials }
      ] = results;

      this.isConnected = errors.length === 0;
      this.lastUpdated = new Date();

      return {
        classes: (classes || []).map(c => ({
          ...c,
          studentIds: c.student_ids,
          textbookIds: c.textbook_ids,
          waitlistIds: c.waitlist_ids
        })),
        students: (students || []).map(s => ({
          ...s,
          enrollDate: s.enroll_date,
          classIds: s.class_ids,
          waitlistClassIds: s.waitlist_class_ids
        })),
        textbooks: (textbooks || []).map(t => ({
          ...t,
          tags: t.tags
        })),
        progressLogs: (progressLogs || []).map(p => ({
          ...p,
          classId: p.class_id
        })),
        academicEvents: (academicEvents || []).map(e => ({ ...e })),
        referenceMaterials: referenceMaterials || [],
        isConnected: this.isConnected,
        isLoading: false,
        lastUpdated: this.lastUpdated,
        error: errors.length > 0 ? errors[0].message : null
      };
    } catch (err) {
      console.error('DataService critical error:', err);
      this.isConnected = false;
      return {
        classes: [],
        students: [],
        textbooks: [],
        progressLogs: [],
        academicEvents: [],
        referenceMaterials: [],
        isConnected: false,
        isLoading: false,
        lastUpdated: new Date(),
        error: err.message
      };
    }
  }

  // --- Classes ---
  async getClasses() {
    const { data } = await supabase.from('classes').select('*');
    return (data || []).map(c => ({ ...c, studentIds: c.student_ids, textbookIds: c.textbook_ids }));
  }

  async addClass(classObj) {
    const { data, error } = await supabase.from('classes').insert([{
      name: classObj.name,
      teacher: classObj.teacher,
      schedule: classObj.schedule,
      student_ids: classObj.studentIds || [],
      textbook_ids: classObj.textbookIds || [],
      waitlist_ids: classObj.waitlistIds || [],
      room: classObj.room,
      subject: classObj.subject,
      color: classObj.color
    }]).select().single();
    if (error) throw error;
    return data;
  }

  async updateClass(id, updates) {
    const mappedUpdates = { ...updates };
    if (updates.studentIds) {
        mappedUpdates.student_ids = updates.studentIds;
        delete mappedUpdates.studentIds;
    }
    if (updates.textbookIds) {
        mappedUpdates.textbook_ids = updates.textbookIds;
        delete mappedUpdates.textbookIds;
    }
    if (updates.waitlistIds) {
        mappedUpdates.waitlist_ids = updates.waitlistIds;
        delete mappedUpdates.waitlistIds;
    }

    const { error } = await supabase.from('classes').update(mappedUpdates).eq('id', id);
    if (error) throw error;
    return true;
  }

  async deleteClass(id) {
    const { error } = await supabase.from('classes').delete().eq('id', id);
    if (error) throw error;
  }

  async bulkDeleteClasses(ids) {
    const { error } = await supabase.from('classes').delete().in('id', ids);
    if (error) throw error;
  }

  async bulkUpdateClasses(ids, updates) {
    const mappedUpdates = { ...updates };
    if (updates.studentIds) {
        mappedUpdates.student_ids = updates.studentIds;
        delete mappedUpdates.studentIds;
    }
    if (updates.textbookIds) {
        mappedUpdates.textbook_ids = updates.textbookIds;
        delete mappedUpdates.textbookIds;
    }
    if (updates.waitlistIds) {
        mappedUpdates.waitlist_ids = updates.waitlistIds;
        delete mappedUpdates.waitlistIds;
    }
    const { error } = await supabase.from('classes').update(mappedUpdates).in('id', ids);
    if (error) throw error;
  }

  // --- Textbooks ---
  async getTextbooks() {
    const { data } = await supabase.from('textbooks').select('*');
    return data || [];
  }

  async addTextbook(tb) {
    const { data, error } = await supabase.from('textbooks').insert([tb]).select().single();
    if (error) throw error;
    return data;
  }

  async updateTextbook(id, updates) {
    const { error } = await supabase.from('textbooks').update(updates).eq('id', id);
    if (error) throw error;
  }

  async deleteTextbook(id) {
    const { error } = await supabase.from('textbooks').delete().eq('id', id);
    if (error) throw error;
  }

  async bulkDeleteTextbooks(ids) {
    const { error } = await supabase.from('textbooks').delete().in('id', ids);
    if (error) throw error;
  }

  async bulkUpdateTextbooks(ids, updates) {
    if (updates.addTags) {
      const { addTags, ...rest } = updates;
      if (Object.keys(rest).length > 0) {
        const { error } = await supabase.from('textbooks').update(rest).in('id', ids);
        if (error) throw error;
      }
    } else {
      const { error } = await supabase.from('textbooks').update(updates).in('id', ids);
      if (error) throw error;
    }
  }

  // --- Students ---
  async getStudents() {
    const { data } = await supabase.from('students').select('*');
    return (data || []).map(s => ({ ...s, classIds: s.class_ids, enrollDate: s.enroll_date }));
  }

  async addStudent(student) {
    const { data, error } = await supabase.from('students').insert([{
      name: student.name,
      grade: student.grade,
      enroll_date: student.enrollDate || new Date().toISOString().split('T')[0],
      class_ids: student.classIds || [],
      waitlist_class_ids: student.waitlistClassIds || []
    }]).select().single();
    if (error) throw error;
    return data;
  }

  async updateStudent(id, updates) {
    const mappedUpdates = { ...updates };
    if (updates.enrollDate) {
        mappedUpdates.enroll_date = updates.enrollDate;
        delete mappedUpdates.enrollDate;
    }
    if (updates.classIds) {
        mappedUpdates.class_ids = updates.classIds;
        delete mappedUpdates.classIds;
    }
    if (updates.waitlistClassIds) {
        mappedUpdates.waitlist_class_ids = updates.waitlistClassIds;
        delete mappedUpdates.waitlistClassIds;
    }
    const { error } = await supabase.from('students').update(mappedUpdates).eq('id', id);
    if (error) throw error;
  }

  async deleteStudent(id) {
    const { error } = await supabase.from('students').delete().eq('id', id);
    if (error) throw error;
  }

  async bulkDeleteStudents(ids) {
    const { error } = await supabase.from('students').delete().in('id', ids);
    if (error) throw error;
  }

  // --- Progress / Logs ---
  async addProgressLog(log) {
    const { data, error } = await supabase.from('progress_logs').insert([{
      class_id: log.classId,
      date: log.date,
      content: log.content,
      homework: log.homework
    }]).select().single();
    if (error) throw error;
    return data;
  }

  async deleteProgressLog(logId) {
    const { error } = await supabase.from('progress_logs').delete().eq('id', logId);
    if (error) throw error;
  }

  async getProgressLogsForClass(classId) {
    const { data } = await supabase.from('progress_logs').select('*').eq('class_id', classId);
    return (data || []).map(p => ({ ...p, classId: p.class_id }));
  }

  // --- Academic Events ---
  async getAcademicEvents() {
    const { data } = await supabase.from('academic_events').select('*');
    return data || [];
  }

  async addAcademicEvent(event) {
    const { data, error } = await supabase.from('academic_events').insert([event]).select().single();
    if (error) throw error;
    return data;
  }

  async updateAcademicEvent(id, updates) {
    const { error } = await supabase.from('academic_events').update(updates).eq('id', id);
    if (error) throw error;
  }

  async deleteAcademicEvent(id) {
    const { error } = await supabase.from('academic_events').delete().eq('id', id);
    if (error) throw error;
  }

  // --- Reference Materials ---
  async getReferenceMaterials() {
    const { data } = await supabase.from('reference_materials').select('*');
    return data || [];
  }

  // --- Sync Utility ---
  async syncLocalStorageData() {
    try {
      const storageKeys = {
        classes: 'classes',
        students: 'students',
        textbooks: 'textbooks',
        progressLogs: 'progressLogs',
        academicEvents: 'academicEvents'
      };

      const localData = {};
      for (const [key, storageKey] of Object.entries(storageKeys)) {
        const saved = localStorage.getItem(storageKey);
        localData[key] = saved ? JSON.parse(saved) : [];
      }

      console.log('Syncing data to Supabase...', localData);

      // Simple migration (overwrite if conflict, or just insert new)
      // Note: This is an idempotent sync for this project.
      
      // 1. Students
      if (localData.students.length > 0) {
        for (const s of localData.students) {
            await this.addStudent(s);
        }
      }

      // 2. Textbooks
      if (localData.textbooks.length > 0) {
        for (const t of localData.textbooks) {
            await this.addTextbook(t);
        }
      }

      // 3. Classes
      if (localData.classes.length > 0) {
        for (const c of localData.classes) {
            await this.addClass(c);
        }
      }

      // 4. Progress Logs
      if (localData.progressLogs.length > 0) {
         for (const p of localData.progressLogs) {
             await this.addProgressLog(p);
         }
      }
      
      this._notify();
      return { success: true, count: localData.classes.length + localData.students.length };
    } catch (err) {
      console.error('Sync failed:', err);
      return { success: false, error: err.message };
    }
  }

  // Helper dummy connect
  async connect() { return true; }
  disconnect() {}
}

export const dataService = new DataService();
