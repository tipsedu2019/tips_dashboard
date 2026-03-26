function normalizeId(value) {
  return String(value || '').trim();
}

function appendUnique(target, value) {
  const safeValue = normalizeId(value);
  if (!safeValue || target.includes(safeValue)) {
    return target;
  }
  return [...target, safeValue];
}

function normalizeUniqueIds(values = [], blockedIds = new Set()) {
  const next = [];

  (Array.isArray(values) ? values : []).forEach((value) => {
    const safeValue = normalizeId(value);
    if (!safeValue || blockedIds.has(safeValue) || next.includes(safeValue)) {
      return;
    }
    next.push(safeValue);
  });

  return next;
}

function sanitizeIds(values = [], allowedIds = new Set(), blockedIds = new Set()) {
  const next = [];

  (Array.isArray(values) ? values : []).forEach((value) => {
    const safeValue = normalizeId(value);
    if (!safeValue || !allowedIds.has(safeValue) || blockedIds.has(safeValue) || next.includes(safeValue)) {
      return;
    }
    next.push(safeValue);
  });

  return next;
}

function normalizeStudents(students = [], classIds = new Set()) {
  const studentMap = new Map();

  (students || []).forEach((student) => {
    const studentId = normalizeId(student?.id);
    if (!studentId) {
      return;
    }

    const classIdsForStudent = sanitizeIds(student.classIds || [], classIds);
    const waitlistIdsForStudent = sanitizeIds(
      student.waitlistClassIds || [],
      classIds,
      new Set(classIdsForStudent),
    );

    studentMap.set(studentId, {
      ...student,
      id: studentId,
      classIds: classIdsForStudent,
      waitlistClassIds: waitlistIdsForStudent,
    });
  });

  return studentMap;
}

function normalizeClasses(classes = [], studentIds = new Set()) {
  const classMap = new Map();

  (classes || []).forEach((classItem) => {
    const classId = normalizeId(classItem?.id);
    if (!classId) {
      return;
    }

    const studentIdsForClass = sanitizeIds(classItem.studentIds || [], studentIds);
    const waitlistIdsForClass = sanitizeIds(
      classItem.waitlistIds || [],
      studentIds,
      new Set(studentIdsForClass),
    );

    classMap.set(classId, {
      ...classItem,
      id: classId,
      studentIds: studentIdsForClass,
      waitlistIds: waitlistIdsForClass,
    });
  });

  return classMap;
}

function upsertItemById(items = [], nextItem) {
  const safeId = normalizeId(nextItem?.id);
  if (!safeId) {
    return [...(items || [])];
  }

  const source = Array.isArray(items) ? items : [];
  const existingIndex = source.findIndex((item) => normalizeId(item?.id) === safeId);
  const normalizedItem = {
    ...nextItem,
    id: safeId,
  };

  if (existingIndex < 0) {
    return [...source, normalizedItem];
  }

  return source.map((item, index) => (index === existingIndex ? normalizedItem : item));
}

function removeItemById(items = [], id) {
  const safeId = normalizeId(id);
  if (!safeId) {
    return [...(items || [])];
  }

  return (Array.isArray(items) ? items : []).filter((item) => normalizeId(item?.id) !== safeId);
}

export function getClassRosterAffectedStudentIds({
  previousStudentIds = [],
  previousWaitlistIds = [],
  studentIds = [],
  waitlistIds = [],
} = {}) {
  return normalizeUniqueIds([
    ...previousStudentIds,
    ...previousWaitlistIds,
    ...studentIds,
    ...waitlistIds,
  ]);
}

export function getStudentEnrollmentAffectedClassIds({
  previousClassIds = [],
  previousWaitlistClassIds = [],
  classIds = [],
  waitlistClassIds = [],
} = {}) {
  return normalizeUniqueIds([
    ...previousClassIds,
    ...previousWaitlistClassIds,
    ...classIds,
    ...waitlistClassIds,
  ]);
}

export function syncClassRosterToStudents({
  students = [],
  classId = '',
  studentIds = [],
  waitlistIds = [],
} = {}) {
  const safeClassId = normalizeId(classId);
  if (!safeClassId) {
    return [...(students || [])];
  }

  const enrolledSet = new Set(normalizeUniqueIds(studentIds));
  const waitlistSet = new Set(normalizeUniqueIds(waitlistIds, enrolledSet));

  return (students || []).map((student) => {
    const studentId = normalizeId(student?.id);
    if (!studentId) {
      return student;
    }

    const nextClassIds = normalizeUniqueIds(student.classIds || []).filter((id) => id !== safeClassId);
    const nextWaitlistIds = normalizeUniqueIds(student.waitlistClassIds || []).filter((id) => id !== safeClassId);

    if (enrolledSet.has(studentId)) {
      return {
        ...student,
        classIds: appendUnique(nextClassIds, safeClassId),
        waitlistClassIds: nextWaitlistIds,
      };
    }

    if (waitlistSet.has(studentId)) {
      return {
        ...student,
        classIds: nextClassIds,
        waitlistClassIds: appendUnique(nextWaitlistIds, safeClassId),
      };
    }

    return {
      ...student,
      classIds: nextClassIds,
      waitlistClassIds: nextWaitlistIds,
    };
  });
}

export function applyClassRosterMutation({
  students = [],
  classes = [],
  classId = '',
  classItem = null,
} = {}) {
  const safeClassId = normalizeId(classItem?.id || classId);
  if (!safeClassId) {
    return {
      students: [...(students || [])],
      classes: [...(classes || [])],
    };
  }

  const nextClasses = classItem
    ? upsertItemById(classes, classItem)
    : removeItemById(classes, safeClassId);

  const nextStudents = syncClassRosterToStudents({
    students,
    classId: safeClassId,
    studentIds: classItem?.studentIds || [],
    waitlistIds: classItem?.waitlistIds || [],
  });

  return reconcileRosterRelations({
    students: nextStudents,
    classes: nextClasses,
  });
}

export function syncStudentEnrollmentToClasses({
  classes = [],
  studentId = '',
  classIds = [],
  waitlistClassIds = [],
} = {}) {
  const safeStudentId = normalizeId(studentId);
  if (!safeStudentId) {
    return [...(classes || [])];
  }

  const enrolledSet = new Set(normalizeUniqueIds(classIds));
  const waitlistSet = new Set(normalizeUniqueIds(waitlistClassIds, enrolledSet));

  return (classes || []).map((classItem) => {
    const classId = normalizeId(classItem?.id);
    if (!classId) {
      return classItem;
    }

    const nextStudentIds = normalizeUniqueIds(classItem.studentIds || []).filter((id) => id !== safeStudentId);
    const nextWaitlistIds = normalizeUniqueIds(classItem.waitlistIds || []).filter((id) => id !== safeStudentId);

    if (enrolledSet.has(classId)) {
      return {
        ...classItem,
        studentIds: appendUnique(nextStudentIds, safeStudentId),
        waitlistIds: nextWaitlistIds,
      };
    }

    if (waitlistSet.has(classId)) {
      return {
        ...classItem,
        studentIds: nextStudentIds,
        waitlistIds: appendUnique(nextWaitlistIds, safeStudentId),
      };
    }

    return {
      ...classItem,
      studentIds: nextStudentIds,
      waitlistIds: nextWaitlistIds,
    };
  });
}

export function applyStudentEnrollmentMutation({
  students = [],
  classes = [],
  studentId = '',
  student = null,
} = {}) {
  const safeStudentId = normalizeId(student?.id || studentId);
  if (!safeStudentId) {
    return {
      students: [...(students || [])],
      classes: [...(classes || [])],
    };
  }

  const nextStudents = student
    ? upsertItemById(students, student)
    : removeItemById(students, safeStudentId);

  const nextClasses = syncStudentEnrollmentToClasses({
    classes,
    studentId: safeStudentId,
    classIds: student?.classIds || [],
    waitlistClassIds: student?.waitlistClassIds || [],
  });

  return reconcileRosterRelations({
    students: nextStudents,
    classes: nextClasses,
  });
}

export function reconcileRosterRelations({ students = [], classes = [] } = {}) {
  const knownClassIds = new Set(
    (classes || [])
      .map((classItem) => normalizeId(classItem?.id))
      .filter(Boolean),
  );
  const knownStudentIds = new Set(
    (students || [])
      .map((student) => normalizeId(student?.id))
      .filter(Boolean),
  );

  const studentMap = normalizeStudents(students, knownClassIds);
  const classMap = normalizeClasses(classes, knownStudentIds);

  studentMap.forEach((student, studentId) => {
    student.classIds.forEach((classId) => {
      const classItem = classMap.get(classId);
      if (!classItem) {
        return;
      }

      classItem.studentIds = appendUnique(classItem.studentIds, studentId);
      classItem.waitlistIds = classItem.waitlistIds.filter((id) => id !== studentId);
    });

    student.waitlistClassIds.forEach((classId) => {
      if (student.classIds.includes(classId)) {
        return;
      }

      const classItem = classMap.get(classId);
      if (!classItem || classItem.studentIds.includes(studentId)) {
        return;
      }

      classItem.waitlistIds = appendUnique(classItem.waitlistIds, studentId);
    });
  });

  classMap.forEach((classItem, classId) => {
    classItem.studentIds.forEach((studentId) => {
      const student = studentMap.get(studentId);
      if (!student) {
        return;
      }

      student.classIds = appendUnique(student.classIds, classId);
      student.waitlistClassIds = student.waitlistClassIds.filter((id) => id !== classId);
    });

    classItem.waitlistIds.forEach((studentId) => {
      const student = studentMap.get(studentId);
      if (!student || student.classIds.includes(classId)) {
        return;
      }

      student.waitlistClassIds = appendUnique(student.waitlistClassIds, classId);
    });
  });

  const reconciledStudents = (students || []).map((student) => {
    const studentId = normalizeId(student?.id);
    return studentMap.get(studentId) || student;
  });
  const reconciledClasses = (classes || []).map((classItem) => {
    const classId = normalizeId(classItem?.id);
    return classMap.get(classId) || classItem;
  });

  return {
    students: reconciledStudents,
    classes: reconciledClasses,
  };
}
