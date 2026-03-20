import {
  getClassroomCanonicalKey,
  getClassroomDisplayName,
  getTeacherCanonicalKey,
  parseSchedule,
  splitClassroomList,
  splitTeacherList,
} from '../data/sampleData';
import { sortSubjectOptions } from './subjectUtils';

function text(value) {
  return String(value || '').trim();
}

function normalizeSubjects(subjects = []) {
  return sortSubjectOptions(
    (Array.isArray(subjects) ? subjects : [subjects])
      .map((subject) => text(subject))
      .filter(Boolean),
    { includeDefaults: false }
  );
}

function registerResourceEntry(bucket, key, input = {}, fallbackIndex = 0) {
  if (!key) {
    return null;
  }

  const name = text(input.name || input.label || key);
  const current = bucket.get(key) || {
    id: '',
    key,
    name,
    subjects: [],
    isVisible: true,
    sortOrder: fallbackIndex,
    source: input.source || 'master',
  };

  const nextSubjects = normalizeSubjects([
    ...(current.subjects || []),
    ...(input.subjects || []),
    ...(input.subject ? [input.subject] : []),
  ]);

  const next = {
    ...current,
    id: input.id || current.id || '',
    key,
    name: name || current.name || key,
    subjects: nextSubjects,
    isVisible: input.isVisible ?? current.isVisible ?? true,
    sortOrder:
      current.source === 'master' && input.source === 'fallback'
        ? current.sortOrder
        : (Number.isFinite(Number(input.sortOrder))
            ? Number(input.sortOrder)
            : current.sortOrder),
    source:
      current.source === 'master' || input.source !== 'fallback'
        ? current.source
        : input.source,
  };

  bucket.set(key, next);
  return next;
}

function sortResourceEntries(entries = []) {
  return [...entries].sort((left, right) => {
    const orderGap = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
    if (orderGap !== 0) {
      return orderGap;
    }
    return String(left.name || '').localeCompare(String(right.name || ''), 'ko');
  });
}

function buildSubjectOptions(catalogs = [], classes = []) {
  return sortSubjectOptions(
    [
      ...(classes || []).map((classItem) => classItem.subject),
      ...(catalogs || []).flatMap((item) => item.subjects || []),
    ].filter(Boolean),
    { includeDefaults: false }
  );
}

export function buildTeacherMaster(catalogs = [], classes = []) {
  const teacherMap = new Map();

  (catalogs || []).forEach((entry, index) => {
    const teacherName = text(entry.name);
    const teacherKey = getTeacherCanonicalKey(teacherName);
    registerResourceEntry(teacherMap, teacherKey, {
      id: entry.id,
      name: teacherName,
      subjects: entry.subjects,
      isVisible: entry.isVisible ?? entry.is_visible ?? true,
      sortOrder: entry.sortOrder ?? entry.sort_order ?? index,
      source: 'master',
    }, index);
  });

  (classes || []).forEach((classItem, index) => {
    const subject = text(classItem.subject);

    splitTeacherList(classItem.teacher).forEach((teacherName) => {
      const teacherKey = getTeacherCanonicalKey(teacherName);
      registerResourceEntry(teacherMap, teacherKey, {
        name: teacherName,
        subject,
        sortOrder: index,
        source: 'fallback',
      }, index);
    });

    parseSchedule(classItem.schedule, classItem).forEach((slot) => {
      splitTeacherList(slot.teacher).forEach((teacherName) => {
        const teacherKey = getTeacherCanonicalKey(teacherName);
        registerResourceEntry(teacherMap, teacherKey, {
          name: teacherName,
          subject,
          sortOrder: index,
          source: 'fallback',
        }, index);
      });
    });
  });

  return sortResourceEntries([...teacherMap.values()]);
}

export function buildClassroomMaster(catalogs = [], classes = []) {
  const classroomMap = new Map();

  (catalogs || []).forEach((entry, index) => {
    const classroomName = getClassroomDisplayName(entry.name);
    const classroomKey = getClassroomCanonicalKey(classroomName);
    registerResourceEntry(classroomMap, classroomKey, {
      id: entry.id,
      name: classroomName,
      subjects: entry.subjects,
      isVisible: entry.isVisible ?? entry.is_visible ?? true,
      sortOrder: entry.sortOrder ?? entry.sort_order ?? index,
      source: 'master',
    }, index);
  });

  (classes || []).forEach((classItem, index) => {
    const subject = text(classItem.subject);

    splitClassroomList(classItem.classroom || classItem.room).forEach((classroomName) => {
      const normalized = getClassroomDisplayName(classroomName);
      const classroomKey = getClassroomCanonicalKey(normalized);
      registerResourceEntry(classroomMap, classroomKey, {
        name: normalized,
        subject,
        sortOrder: index,
        source: 'fallback',
      }, index);
    });

    parseSchedule(classItem.schedule, classItem).forEach((slot) => {
      const normalized = getClassroomDisplayName(slot.classroom);
      const classroomKey = getClassroomCanonicalKey(normalized);
      registerResourceEntry(classroomMap, classroomKey, {
        name: normalized,
        subject,
        sortOrder: index,
        source: 'fallback',
      }, index);
    });
  });

  return sortResourceEntries([...classroomMap.values()]);
}

function matchesSubject(entry, subject = '') {
  const normalizedSubject = text(subject);
  if (!normalizedSubject) {
    return true;
  }

  const entrySubjects = normalizeSubjects(entry?.subjects || []);
  return entrySubjects.length === 0 || entrySubjects.includes(normalizedSubject);
}

export function getVisibleTeacherOptions(master = [], subject = '') {
  return master
    .filter((entry) => entry?.isVisible !== false && matchesSubject(entry, subject))
    .map((entry) => entry.name);
}

export function getVisibleClassroomOptions(master = [], subject = '') {
  return master
    .filter((entry) => entry?.isVisible !== false && matchesSubject(entry, subject))
    .map((entry) => entry.name);
}

export function getSubjectOptionMap(master = []) {
  const map = { '': [], __all__: [] };
  const allVisible = master.filter((entry) => entry?.isVisible !== false);
  map.__all__ = allVisible.map((entry) => entry.name);

  const subjectSet = new Set(
    allVisible.flatMap((entry) => normalizeSubjects(entry.subjects || []))
  );

  subjectSet.forEach((subject) => {
    map[subject] = allVisible
      .filter((entry) => matchesSubject(entry, subject))
      .map((entry) => entry.name);
  });

  return map;
}

export function getResourceSubjectOptions(catalogs = [], classes = []) {
  return buildSubjectOptions(catalogs, classes);
}
