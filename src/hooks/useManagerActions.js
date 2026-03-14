import { useMemo, useState } from 'react';
import {
  createId,
  getClassDisplayName,
  getClassTextbookLabel,
  matchClassByName,
  mergeUniqueIds,
  parseListInput
} from '../components/data-manager/utils';
import { computeClassStatus, normalizeClassStatus } from '../lib/classStatus';
import { normalizeClassroomText } from '../lib/classroomUtils';
import { getUserFriendlyDataError } from '../lib/dataErrorUtils';

function getErrorMessage(error) {
  return getUserFriendlyDataError(error);
}

function normalizeHeaderKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()\-_/]/g, '');
}

function normalizeRow(row) {
  return Object.entries(row || {}).reduce((result, [key, value]) => {
    result[normalizeHeaderKey(key)] = value;
    return result;
  }, {});
}

function pickValue(row, keys) {
  const normalized = normalizeRow(row);
  for (const key of keys) {
    const candidate = normalized[normalizeHeaderKey(key)];
    if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') {
      return candidate;
    }
  }

  return '';
}

function asString(value) {
  return String(value || '').trim();
}

function normalizeClassroomValue(value) {
  return normalizeClassroomText(asString(value));
}

function asNumber(value) {
  const parsed = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseLessons(value) {
  return parseListInput(value).map((title) => ({ id: createId(), title }));
}

async function readWorkbookRows(file) {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(worksheet, { defval: '' });
}

async function downloadWorkbook(filename, rows, sheetName = 'TIPS') {
  const XLSX = await import('xlsx');
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename);
}

async function importStudents(rows, data, dataService) {
  const payloads = rows
    .map((row) => {
      const name = asString(pickValue(row, ['이름', '학생명', 'name']));
      const uid = asString(pickValue(row, ['학생고유번호', '고유번호', 'uid']));
      if (!name && !uid) {
        return null;
      }

      const existing = (data.students || []).find(
        (student) => (uid && student.uid === uid) || (name && student.name === name)
      );

      const classIds = parseListInput(pickValue(row, ['수강반', '등록반', '반', 'classes']))
        .map((className) => matchClassByName(data.classes || [], className)?.id)
        .filter(Boolean);

      const waitlistClassIds = parseListInput(pickValue(row, ['대기반', 'waitlist']))
        .map((className) => matchClassByName(data.classes || [], className)?.id)
        .filter(Boolean);

      return {
        ...(existing || {}),
        id: existing?.id || createId(),
        name: name || existing?.name || '',
        uid: uid || existing?.uid || '',
        grade: asString(pickValue(row, ['학년', 'grade'])) || existing?.grade || '',
        school: asString(pickValue(row, ['학교', 'school'])) || existing?.school || '',
        contact: asString(pickValue(row, ['연락처', '전화번호', 'contact'])) || existing?.contact || '',
        parentContact:
          asString(pickValue(row, ['보호자연락처', '부모연락처', 'parentcontact'])) ||
          existing?.parentContact ||
          '',
        enrollDate:
          asString(pickValue(row, ['등록일', 'enrolldate', 'enrolmentdate'])) ||
          existing?.enrollDate ||
          new Date().toISOString().split('T')[0],
        classIds: mergeUniqueIds(existing?.classIds || [], classIds),
        waitlistClassIds: mergeUniqueIds(existing?.waitlistClassIds || [], waitlistClassIds)
      };
    })
    .filter(Boolean);

  if (payloads.length === 0) {
    return { studentCount: 0 };
  }

  await dataService.bulkUpsertStudents(payloads);
  return { studentCount: payloads.length };
}

async function importTextbooks(rows, data, dataService) {
  const payloads = rows
    .map((row) => {
      const title = asString(pickValue(row, ['교재명', '제목', 'title']));
      if (!title) {
        return null;
      }

      const existing = (data.textbooks || []).find((textbook) => textbook.title === title);

      return {
        ...(existing || {}),
        id: existing?.id || createId(),
        title,
        publisher: asString(pickValue(row, ['출판사', 'publisher'])) || existing?.publisher || '',
        price: asNumber(pickValue(row, ['판매금액', '가격', 'price'])) || existing?.price || 0,
        tags: parseListInput(pickValue(row, ['태그', 'tags'])).length > 0
          ? parseListInput(pickValue(row, ['태그', 'tags']))
          : existing?.tags || [],
        lessons: parseLessons(pickValue(row, ['목차', '차시', 'lessons'])).length > 0
          ? parseLessons(pickValue(row, ['목차', '차시', 'lessons']))
          : existing?.lessons || []
      };
    })
    .filter(Boolean);

  for (const textbook of payloads) {
    if ((data.textbooks || []).some((item) => item.id === textbook.id)) {
      await dataService.updateTextbook(textbook.id, textbook);
    } else {
      await dataService.addTextbook(textbook);
    }
  }

  return { textbookCount: payloads.length };
}

async function importClasses(rows, data, dataService) {
  const currentClasses = [...(data.classes || [])];
  const currentStudents = [...(data.students || [])];
  const sessionClasses = {};
  const sessionStudents = {};

  rows.forEach((row) => {
    const className = asString(pickValue(row, ['수업명', '반명', 'classname', 'class']));
    if (!className) {
      return;
    }

    const subject = asString(pickValue(row, ['과목', 'subject']));
    const grade = asString(pickValue(row, ['학년', 'grade']));
    const teacher = asString(pickValue(row, ['강사', '담당강사', 'teacher']));
    const classroom = normalizeClassroomValue(pickValue(row, ['강의실', '교실', 'classroom']));
    const schedule = asString(pickValue(row, ['요일/시간', '시간표', 'schedule']));
    const fee = asNumber(pickValue(row, ['수업료', 'fee']));
    const capacity = asNumber(pickValue(row, ['정원', 'capacity']));
    const textbookInfo = asString(pickValue(row, ['교재', 'textbook']));
    const period = asString(pickValue(row, ['학기', 'period']));
    const startDate = asString(pickValue(row, ['시작일', '개강일', 'startdate']));
    const endDate = asString(pickValue(row, ['종료일', '종강일', 'enddate']));
    const explicitStatus = normalizeClassStatus(pickValue(row, ['상태', 'status']));
    const sessionKey = [subject, grade, className, teacher].join('|');

    const existingClass =
      sessionClasses[sessionKey] ||
      currentClasses.find(
        (item) =>
          (item.className === className || getClassDisplayName(item) === className) &&
          (subject ? item.subject === subject : true) &&
          (grade ? item.grade === grade : true) &&
          (teacher ? item.teacher === teacher : true)
      );

    const textbookIds = parseListInput(textbookInfo)
      .map((title) => (data.textbooks || []).find((textbook) => textbook.title === title)?.id)
      .filter(Boolean);

    if (!sessionClasses[sessionKey]) {
      const nextStatus = explicitStatus || normalizeClassStatus(existingClass?.status) || computeClassStatus({
        startDate,
        endDate
      });
      sessionClasses[sessionKey] = {
        ...(existingClass || {}),
        id: existingClass?.id || createId(),
        className,
        status: nextStatus,
        subject: subject || existingClass?.subject || '',
        grade: grade || existingClass?.grade || '',
        teacher: teacher || existingClass?.teacher || '',
        classroom: classroom || normalizeClassroomValue(existingClass?.classroom || '') || '',
        schedule: schedule || existingClass?.schedule || '',
        fee: fee || existingClass?.fee || 0,
        capacity: capacity || existingClass?.capacity || 0,
        textbookInfo: textbookInfo || existingClass?.textbookInfo || '',
        textbookIds: textbookIds.length > 0 ? textbookIds : existingClass?.textbookIds || [],
        period: period || existingClass?.period || '',
        startDate: startDate || existingClass?.startDate || '',
        endDate: endDate || existingClass?.endDate || '',
        studentIds: [...(existingClass?.studentIds || [])],
        waitlistIds: [...(existingClass?.waitlistIds || [])],
        lessons: existingClass?.lessons || []
      };
    }

    const studentName = asString(pickValue(row, ['이름', '학생명', 'name']));
    const uid = asString(pickValue(row, ['학생고유번호', '고유번호', 'uid']));

    if (!studentName && !uid) {
      return;
    }

    const studentKey = uid || studentName;
    const existingStudent =
      sessionStudents[studentKey] ||
      currentStudents.find(
        (student) => (uid && student.uid === uid) || (studentName && student.name === studentName)
      );

    if (!sessionStudents[studentKey]) {
      sessionStudents[studentKey] = {
        ...(existingStudent || {}),
        id: existingStudent?.id || createId(),
        name: studentName || existingStudent?.name || '',
        uid: uid || existingStudent?.uid || '',
        grade: asString(pickValue(row, ['학년', 'grade'])) || existingStudent?.grade || '',
        school: asString(pickValue(row, ['학교', 'school'])) || existingStudent?.school || '',
        contact:
          asString(pickValue(row, ['연락처', '전화번호', 'contact'])) || existingStudent?.contact || '',
        parentContact:
          asString(pickValue(row, ['보호자연락처', '부모연락처', 'parentcontact'])) ||
          existingStudent?.parentContact ||
          '',
        enrollDate:
          asString(pickValue(row, ['등록일', 'enrolldate'])) ||
          existingStudent?.enrollDate ||
          new Date().toISOString().split('T')[0],
        classIds: [...(existingStudent?.classIds || [])],
        waitlistClassIds: [...(existingStudent?.waitlistClassIds || [])]
      };
    }

    sessionStudents[studentKey]._targetClassKeys = sessionStudents[studentKey]._targetClassKeys || new Set();
    sessionStudents[studentKey]._targetClassKeys.add(sessionKey);

    sessionClasses[sessionKey]._targetStudentKeys = sessionClasses[sessionKey]._targetStudentKeys || new Set();
    sessionClasses[sessionKey]._targetStudentKeys.add(studentKey);
  });

  const studentPayloads = Object.values(sessionStudents);
  const finalStudents =
    studentPayloads.length > 0 ? await dataService.bulkUpsertStudents(studentPayloads) : [];

  finalStudents.forEach((student) => {
    const key = student.uid || student.name;
    if (sessionStudents[key]) {
      sessionStudents[key].id = student.id;
    }
  });

  const classPayloads = Object.values(sessionClasses).map((classItem) => {
    const sessionStudentIds = [...(classItem.studentIds || [])];
    classItem._targetStudentKeys?.forEach((studentKey) => {
      const studentId = sessionStudents[studentKey]?.id;
      if (studentId && !sessionStudentIds.includes(studentId)) {
        sessionStudentIds.push(studentId);
      }
    });

    return {
      ...classItem,
      studentIds: sessionStudentIds
    };
  });

  const finalClasses =
    classPayloads.length > 0 ? await dataService.bulkUpsertClasses(classPayloads) : [];

  if (finalStudents.length > 0 && finalClasses.length > 0) {
    const studentsToUpdate = finalStudents
      .map((student) => {
        const key = student.uid || student.name;
        const targetClassIds = [];
        sessionStudents[key]?._targetClassKeys?.forEach((sessionKey) => {
          const matchedClass = finalClasses.find((classItem) => {
            const candidateKey = [
              classItem.subject || '',
              classItem.grade || '',
              classItem.className || classItem.name || '',
              classItem.teacher || ''
            ].join('|');
            return candidateKey === sessionKey;
          });

          if (matchedClass?.id) {
            targetClassIds.push(matchedClass.id);
          }
        });

        const mergedClassIds = mergeUniqueIds(student.classIds || [], targetClassIds);
        if (JSON.stringify(mergedClassIds) === JSON.stringify(student.classIds || [])) {
          return null;
        }

        return {
          ...student,
          classIds: mergedClassIds
        };
      })
      .filter(Boolean);

    if (studentsToUpdate.length > 0) {
      await dataService.bulkUpsertStudents(studentsToUpdate);
    }
  }

  return {
    classCount: classPayloads.length,
    studentCount: studentPayloads.length,
    blankScheduleCount: classPayloads.filter((classItem) => !asString(classItem.schedule)).length
  };
}

export function useManagerActions({
  activeTab,
  data,
  filteredData,
  dataService,
  toast,
  confirm,
  selectedIds,
  clearSelection,
  classSubjectOptions
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [bulkUpdateModalOpen, setBulkUpdateModalOpen] = useState(false);
  const [bulkUpdateField, setBulkUpdateField] = useState('teacher');
  const [bulkUpdateValue, setBulkUpdateValue] = useState('');

  const bulkFieldOptions = useMemo(() => {
    if (activeTab === 'classes') {
      return [
        { value: 'teacher', label: '선생님' },
        { value: 'grade', label: '학년' },
        { value: 'status', label: '상태' },
        { value: 'classroom', label: '강의실' },
        { value: 'subject', label: '과목' },
        { value: 'period', label: '학기/운영 기간' }
      ];
    }

    return [
      { value: 'tags', label: '태그 추가' },
      { value: 'publisher', label: '출판사' }
    ];
  }, [activeTab]);

  const openBulkUpdate = () => {
    if (selectedIds.size === 0) {
      return;
    }

    setBulkUpdateField(activeTab === 'classes' ? 'teacher' : 'tags');
    setBulkUpdateValue('');
    setBulkUpdateModalOpen(true);
  };

  const closeBulkUpdate = () => {
    setBulkUpdateModalOpen(false);
    setBulkUpdateValue('');
  };

  const applyBulkUpdate = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      return;
    }

    setIsProcessing(true);
    try {
      if (activeTab === 'classes') {
        await dataService.bulkUpdateClasses(ids, { [bulkUpdateField]: bulkUpdateValue });
      } else if (activeTab === 'textbooks') {
        if (bulkUpdateField === 'tags') {
          await dataService.bulkUpdateTextbooks(ids, {
            addTags: parseListInput(bulkUpdateValue)
          });
        } else {
          await dataService.bulkUpdateTextbooks(ids, { [bulkUpdateField]: bulkUpdateValue });
        }
      }

      closeBulkUpdate();
      clearSelection();
      toast.success(`${ids.length}개 항목을 일괄 수정했습니다.`);
    } catch (error) {
      toast.error(`일괄 수정에 실패했습니다. ${getErrorMessage(error)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      return;
    }

    const shouldDelete = await confirm({
      title: '선택한 항목을 삭제할까요?',
      description: `${ids.length}개 항목이 영구적으로 삭제됩니다.`,
      confirmLabel: '삭제',
      cancelLabel: '취소',
      tone: 'danger'
    });

    if (!shouldDelete) {
      return;
    }

    setIsProcessing(true);
    try {
      if (activeTab === 'students') {
        await dataService.bulkDeleteStudents(ids);
      } else if (activeTab === 'classes') {
        await dataService.bulkDeleteClasses(ids);
      } else {
        await dataService.bulkDeleteTextbooks(ids);
      }

      clearSelection();
      toast.success(`${ids.length}개 항목을 삭제했습니다.`);
    } catch (error) {
      toast.error(`삭제에 실패했습니다. ${getErrorMessage(error)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteStudent = async (id) => {
    const shouldDelete = await confirm({
      title: '이 학생을 삭제할까요?',
      description: '연결된 수강 정보도 함께 정리됩니다.',
      confirmLabel: '삭제',
      cancelLabel: '취소',
      tone: 'danger'
    });

    if (!shouldDelete) {
      return;
    }

    setIsProcessing(true);
    try {
      await dataService.deleteStudent(id);
      toast.success('학생 정보를 삭제했습니다.');
    } catch (error) {
      toast.error(`학생 삭제에 실패했습니다. ${getErrorMessage(error)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteClass = async (id) => {
    const shouldDelete = await confirm({
      title: '이 수업을 삭제할까요?',
      description: '연결된 진도 기록도 함께 사라집니다.',
      confirmLabel: '삭제',
      cancelLabel: '취소',
      tone: 'danger'
    });

    if (!shouldDelete) {
      return;
    }

    setIsProcessing(true);
    try {
      await dataService.deleteClass(id);
      toast.success('수업을 삭제했습니다.');
    } catch (error) {
      toast.error(`수업 삭제에 실패했습니다. ${getErrorMessage(error)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteTextbook = async (id) => {
    const shouldDelete = await confirm({
      title: '이 교재를 삭제할까요?',
      description: '연결된 수업의 교재 표시도 함께 정리됩니다.',
      confirmLabel: '삭제',
      cancelLabel: '취소',
      tone: 'danger'
    });

    if (!shouldDelete) {
      return;
    }

    setIsProcessing(true);
    try {
      await dataService.deleteTextbook(id);
      toast.success('교재를 삭제했습니다.');
    } catch (error) {
      toast.error(`교재 삭제에 실패했습니다. ${getErrorMessage(error)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const saveStudent = async (student) => {
    setIsProcessing(true);
    try {
      if ((data.students || []).some((item) => item.id === student.id)) {
        await dataService.updateStudent(student.id, student);
        toast.success('학생 정보를 저장했습니다.');
      } else {
        await dataService.addStudent(student);
        toast.success('학생을 등록했습니다.');
      }
      return true;
    } catch (error) {
      toast.error(`학생 저장에 실패했습니다. ${getErrorMessage(error)}`);
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  const saveClass = async (classItem) => {
    setIsProcessing(true);
    try {
      if ((data.classes || []).some((item) => item.id === classItem.id)) {
        await dataService.updateClass(classItem.id, {
          ...classItem,
          classroom: normalizeClassroomValue(classItem.classroom),
          status: normalizeClassStatus(classItem.status) || computeClassStatus(classItem)
        });
        toast.success('수업 정보를 저장했습니다.');
      } else {
        await dataService.addClass({
          ...classItem,
          classroom: normalizeClassroomValue(classItem.classroom),
          status: normalizeClassStatus(classItem.status) || computeClassStatus(classItem)
        });
        toast.success('수업을 등록했습니다.');
      }
      return true;
    } catch (error) {
      toast.error(`수업 저장에 실패했습니다. ${getErrorMessage(error)}`);
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  const saveTextbook = async (textbook) => {
    setIsProcessing(true);
    try {
      if ((data.textbooks || []).some((item) => item.id === textbook.id)) {
        await dataService.updateTextbook(textbook.id, textbook);
        toast.success('교재 정보를 저장했습니다.');
      } else {
        await dataService.addTextbook(textbook);
        toast.success('교재를 등록했습니다.');
      }
      return true;
    } catch (error) {
      toast.error(`교재 저장에 실패했습니다. ${getErrorMessage(error)}`);
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  const handleInlineEdit = async (id, key, value, tabName) => {
    setIsProcessing(true);
    try {
      if (tabName === 'students') {
        const student = (data.students || []).find((item) => item.id === id);
        if (student) {
          await dataService.updateStudent(id, { ...student, [key]: value });
        }
      } else if (tabName === 'classes') {
        const classItem = (data.classes || []).find((item) => item.id === id);
        if (classItem) {
          const parsedValue = ['fee', 'capacity'].includes(key)
            ? asNumber(value)
            : key === 'status'
              ? normalizeClassStatus(value) || computeClassStatus(classItem)
              : key === 'classroom'
                ? normalizeClassroomValue(value)
                : value;
          await dataService.updateClass(id, { ...classItem, [key]: parsedValue });
        }
      } else {
        const textbook = (data.textbooks || []).find((item) => item.id === id);
        if (textbook) {
          const parsedValue = key === 'price' ? asNumber(value) : value;
          await dataService.updateTextbook(id, { ...textbook, [key]: parsedValue });
        }
      }

      toast.success('변경 사항을 저장했습니다.');
    } catch (error) {
      toast.error(`인라인 수정에 실패했습니다. ${getErrorMessage(error)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportData = async () => {
    if (!filteredData || filteredData.length === 0) {
      toast.info('내보낼 데이터가 없습니다.');
      return;
    }

    setIsProcessing(true);
    try {
      let filename = '';
      let rows = [];

      if (activeTab === 'students') {
        filename = 'TIPS-학생목록.xlsx';
        rows = filteredData.map((student) => ({
          이름: student.name || '',
          학년: student.grade || '',
          학교: student.school || '',
          연락처: student.contact || '',
          보호자연락처: student.parentContact || '',
          학생고유번호: student.uid || '',
          등록일: student.enrollDate || '',
          수강반: (student.classIds || [])
            .map((id) => getClassDisplayName((data.classes || []).find((item) => item.id === id)))
            .filter(Boolean)
            .join(', '),
          대기반: (student.waitlistClassIds || [])
            .map((id) => getClassDisplayName((data.classes || []).find((item) => item.id === id)))
            .filter(Boolean)
            .join(', ')
        }));
      } else if (activeTab === 'classes') {
        filename = 'TIPS-수업목록.xlsx';
        rows = filteredData.map((classItem) => ({
          수업명: getClassDisplayName(classItem),
          상태: normalizeClassStatus(classItem.status) || computeClassStatus(classItem),
          과목: classItem.subject || '',
          학년: classItem.grade || '',
          선생님: classItem.teacher || '',
          강의실: classItem.classroom || '',
          '요일/시간': classItem.schedule || '',
          수강인원: (classItem.studentIds || []).length,
          대기인원: (classItem.waitlistIds || []).length,
          정원: classItem.capacity || 0,
          수업료: classItem.fee || 0,
          교재: getClassTextbookLabel(classItem, data.textbooks || []),
          시작일: classItem.startDate || '',
          종료일: classItem.endDate || '',
          학기: classItem.period || ''
        }));
      } else {
        filename = 'TIPS-교재목록.xlsx';
        rows = filteredData.map((textbook) => ({
          교재명: textbook.title || '',
          출판사: textbook.publisher || '',
          판매금액: textbook.price || 0,
          태그: (textbook.tags || []).join(', '),
          목차: (textbook.lessons || []).map((lesson) => lesson.title).join(', ')
        }));
      }

      await downloadWorkbook(filename, rows);
      toast.success(`${filename} 파일을 저장했습니다.`);
    } catch (error) {
      toast.error(`파일 내보내기에 실패했습니다. ${getErrorMessage(error)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadSample = async () => {
    setIsProcessing(true);
    try {
      let filename = '';
      let rows = [];

      if (activeTab === 'students') {
        filename = 'TIPS-학생업로드-샘플.xlsx';
        rows = [
          {
            이름: '김하늘',
            학년: '중2',
            학교: '한빛중',
            연락처: '010-1111-2222',
            보호자연락처: '010-3333-4444',
            학생고유번호: 'S1001',
            등록일: '2026-03-01',
            수강반: '중등 영어 A',
            대기반: '중등 수학 B'
          }
        ];
      } else if (activeTab === 'classes') {
        filename = 'TIPS-수업업로드-샘플.xlsx';
        rows = [
          {
            상태: '수업 진행 중',
            과목: '영어',
            학년: '중2',
            수업명: '중등 영어 A',
            선생님: '김민지',
            강의실: 'A강의실',
            '요일/시간': '월수 17:30-19:00',
            수업료: 320000,
            정원: 12,
            교재: '중등 영어 독해 2',
            시작일: '2026-03-01',
            종료일: '2026-12-31',
            학기: '2026 봄학기',
            이름: '김하늘',
            학생고유번호: 'S1001',
            학교: '한빛중',
            연락처: '010-1111-2222',
            보호자연락처: '010-3333-4444'
          }
        ];
      } else {
        filename = 'TIPS-교재업로드-샘플.xlsx';
        rows = [
          {
            교재명: '중등 영어 독해 2',
            출판사: '예문사',
            판매금액: 18000,
            태그: '영어, 중등, 독해',
            목차: 'Unit 1, Unit 2, Unit 3'
          }
        ];
      }

      await downloadWorkbook(filename, rows);
      toast.info('샘플 파일 다운로드를 시작했습니다.');
    } catch (error) {
      toast.error(`샘플 파일 생성에 실패했습니다. ${getErrorMessage(error)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSpreadsheetUpload = async (file, mode = activeTab) => {
    if (!file) {
      return;
    }

    setIsProcessing(true);
    try {
      const rows = await readWorkbookRows(file);
      if (!rows || rows.length === 0) {
        toast.error('업로드할 데이터가 없습니다.');
        return;
      }

      if (mode === 'students') {
        const result = await importStudents(rows, data, dataService);
        toast.success(`${result.studentCount}명의 학생 데이터를 업로드했습니다.`);
      } else if (mode === 'classes') {
        const result = await importClasses(rows, data, dataService);
        if (result.blankScheduleCount > 0) {
          toast.info(`요일/시간이 비어 있는 수업 ${result.blankScheduleCount}개가 있습니다. 업로드 후 수업 정보를 한 번 확인해 주세요.`);
        }
        toast.success(`수업 ${result.classCount}개, 학생 ${result.studentCount}명의 연결 정보를 반영했습니다.`);
      } else {
        const result = await importTextbooks(rows, data, dataService);
        toast.success(`교재 ${result.textbookCount}개를 업로드했습니다.`);
      }
    } catch (error) {
      toast.error(`업로드에 실패했습니다. ${getErrorMessage(error)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    isProcessing,
    bulkUpdateModalOpen,
    bulkUpdateField,
    setBulkUpdateField,
    bulkUpdateValue,
    setBulkUpdateValue,
    bulkFieldOptions,
    classSubjectOptions,
    openBulkUpdate,
    closeBulkUpdate,
    applyBulkUpdate,
    handleDeleteSelected,
    deleteStudent,
    deleteClass,
    deleteTextbook,
    saveStudent,
    saveClass,
    saveTextbook,
    handleInlineEdit,
    handleExportData,
    handleDownloadSample,
    handleSpreadsheetUpload
  };
}
