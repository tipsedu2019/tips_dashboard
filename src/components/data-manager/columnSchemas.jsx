import { computeWeeklyMinutes, formatHours } from '../../data/sampleData';
import { CLASS_STATUS_OPTIONS } from '../../lib/classStatus';
import { buildSchoolMaster } from '../../lib/schoolConfig';
import {
  formatCurrency,
  getClassDisplayName,
  getClassTextbookLabel,
  getNormalizedClassStatus,
  getScheduleSummary,
} from './utils';

function getStudentCount(classItem) {
  return (classItem.studentIds || []).length;
}

function getWaitlistCount(classItem) {
  return (classItem.waitlistIds || []).length;
}

function getRecruitmentStatus(classItem) {
  const current = getStudentCount(classItem);
  const capacity = Number(classItem.capacity || 0);

  if (!capacity) {
    return '정원 미설정';
  }

  const remain = capacity - current;
  if (remain <= 0) {
    return '마감';
  }
  if (remain <= 3) {
    return '마감 임박';
  }
  return '수강 가능';
}

function getWeeklyHours(classItem) {
  return computeWeeklyMinutes(classItem.schedule || '', classItem);
}

export function buildClassColumns({
  data,
  onOpenManifest,
  onOpenClassDetail,
  editable = true,
  includeRecruitment = false,
  subjectOptions = [],
  teacherOptions = [],
  classroomOptions = [],
}) {
  const columns = [
    {
      key: 'status',
      label: '운영 상태',
      visibleByDefault: true,
      canInlineEdit: editable,
      editKind: 'select',
      editOptions: CLASS_STATUS_OPTIONS,
      filterKind: 'single-select',
      filterOptions: CLASS_STATUS_OPTIONS,
      getValue: (classItem) => getNormalizedClassStatus(classItem),
      sortAccessor: (classItem) => getNormalizedClassStatus(classItem),
      render: (classItem) => getNormalizedClassStatus(classItem),
    },
    {
      key: 'subject',
      label: '과목',
      visibleByDefault: true,
      canInlineEdit: editable,
      editKind: 'select',
      editOptions: subjectOptions,
      filterKind: 'multi-select',
      filterOptions: subjectOptions,
      getValue: (classItem) => classItem.subject || '',
    },
    {
      key: 'grade',
      label: '학년',
      visibleByDefault: true,
      canInlineEdit: editable,
      filterKind: 'multi-select',
      getValue: (classItem) => classItem.grade || '',
    },
    {
      key: 'className',
      label: '수업명',
      visibleByDefault: true,
      canInlineEdit: editable,
      filterKind: 'text',
      getValue: (classItem) => classItem.className || '',
      sortAccessor: (classItem) => getClassDisplayName(classItem),
      render: (classItem) => (
        onOpenClassDetail ? (
          <button
            type="button"
            onClick={() => onOpenClassDetail(classItem)}
            style={{
              border: 'none',
              background: 'transparent',
              padding: 0,
              fontWeight: 700,
              color: 'var(--accent-color)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            {getClassDisplayName(classItem)}
          </button>
        ) : (
          <div style={{ fontWeight: 700, color: 'var(--accent-color)' }}>
            {getClassDisplayName(classItem)}
          </div>
        )
      ),
    },
    {
      key: 'schedule',
      label: '요일/시간',
      visibleByDefault: true,
      canInlineEdit: editable,
      multiline: true,
      editKind: 'textarea',
      filterKind: 'text',
      getValue: (classItem) => classItem.schedule || '',
      render: (classItem) => (
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            whiteSpace: 'pre-line',
          }}
        >
          {getScheduleSummary(classItem.schedule)}
        </div>
      ),
    },
    {
      key: 'teacher',
      label: '선생님',
      visibleByDefault: true,
      canInlineEdit: editable,
      editKind: 'select',
      editOptions: teacherOptions,
      filterKind: 'multi-select',
      filterOptions: teacherOptions,
      getValue: (classItem) => classItem.teacher || '',
    },
    {
      key: 'classroom',
      label: '강의실',
      visibleByDefault: true,
      canInlineEdit: editable,
      editKind: 'select',
      editOptions: classroomOptions,
      filterKind: 'multi-select',
      filterOptions: classroomOptions,
      getValue: (classItem) => classItem.classroom || '',
    },
  ];

  if (includeRecruitment) {
    columns.push({
      key: 'recruitmentStatus',
      label: '모집 상태',
      visibleByDefault: true,
      filterKind: 'single-select',
      filterOptions: ['정원 미설정', '수강 가능', '마감 임박', '마감'],
      getValue: (classItem) => getRecruitmentStatus(classItem),
      sortAccessor: (classItem) => getRecruitmentStatus(classItem),
      render: (classItem) => getRecruitmentStatus(classItem),
    });
  }

  columns.push(
    {
      key: 'studentCount',
      label: '수강 현황',
      visibleByDefault: true,
      filterKind: 'number-range',
      sortAccessor: (classItem) => getStudentCount(classItem),
      getValue: (classItem) => getStudentCount(classItem),
      render: (classItem) => {
        const current = getStudentCount(classItem);
        const wait = getWaitlistCount(classItem);
        const capacity = Number(classItem.capacity || 0);
        const remaining = capacity - current;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <button
                type="button"
                className="btn-secondary"
                style={{
                  padding: '3px 8px',
                  fontSize: 11,
                  border: 'none',
                  background: 'var(--accent-light)',
                  color: 'var(--accent-color)',
                }}
                onClick={() => onOpenManifest?.(classItem)}
                disabled={!onOpenManifest}
              >
                등록 {current}
              </button>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: 999,
                  background: 'rgba(245, 158, 11, 0.12)',
                  color: '#d97706',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                대기 {wait}
              </span>
              {capacity > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  정원 {current}/{capacity}
                </span>
              )}
            </div>
            {remaining > 0 && remaining <= 3 && (
              <span style={{ fontSize: 11, color: '#2563eb', fontWeight: 700 }}>
                마감 임박 {remaining}자리
              </span>
            )}
            {capacity > 0 && remaining <= 0 && (
              <span style={{ fontSize: 11, color: '#d97706', fontWeight: 700 }}>
                정원이 가득 찼습니다
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'capacity',
      label: '정원',
      visibleByDefault: true,
      canInlineEdit: editable,
      inputType: 'number',
      filterKind: 'number-range',
      getValue: (classItem) => Number(classItem.capacity || 0),
    },
    {
      key: 'textbook',
      label: '교재',
      visibleByDefault: true,
      filterKind: 'text',
      getValue: (classItem) => getClassTextbookLabel(classItem, data.textbooks || []),
      render: (classItem) => getClassTextbookLabel(classItem, data.textbooks || []),
    },
    {
      key: 'weeklyHours',
      label: '주간 수업시간',
      visibleByDefault: true,
      filterKind: 'number-range',
      getValue: (classItem) => getWeeklyHours(classItem),
      sortAccessor: (classItem) => getWeeklyHours(classItem),
      render: (classItem) => {
        const minutes = getWeeklyHours(classItem);
        return minutes ? formatHours(minutes) : '-';
      },
    },
    {
      key: 'fee',
      label: '수업료',
      visibleByDefault: true,
      canInlineEdit: editable,
      inputType: 'number',
      filterKind: 'number-range',
      getValue: (classItem) => Number(classItem.fee || 0),
      render: (classItem) => formatCurrency(classItem.fee),
    },
    {
      key: 'startDate',
      label: '시작일',
      visibleByDefault: true,
      canInlineEdit: editable,
      editKind: 'date',
      filterKind: 'date-range',
      getValue: (classItem) => classItem.startDate || '',
    },
    {
      key: 'endDate',
      label: '종료일',
      visibleByDefault: true,
      canInlineEdit: editable,
      editKind: 'date',
      filterKind: 'date-range',
      getValue: (classItem) => classItem.endDate || '',
    },
    {
      key: 'period',
      label: '학기',
      visibleByDefault: true,
      canInlineEdit: editable,
      filterKind: 'single-select',
      getValue: (classItem) => classItem.period || '',
    }
  );

  return columns;
}

export function buildStudentColumns({ data } = {}) {
  const schoolOptions = buildSchoolMaster(data?.academicSchools || [], data?.students || []).map((item) => item.name);
  return [
    {
      key: 'name',
      label: '이름',
      visibleByDefault: true,
      canInlineEdit: true,
      filterKind: 'text',
      getValue: (student) => student.name || '',
      render: (student) => <div style={{ fontWeight: 700 }}>{student.name}</div>,
    },
    {
      key: 'grade',
      label: '학년',
      visibleByDefault: true,
      canInlineEdit: true,
      filterKind: 'single-select',
      getValue: (student) => student.grade || '',
    },
    {
      key: 'school',
      label: '학교',
      visibleByDefault: true,
      canInlineEdit: true,
      filterKind: 'single-select',
      filterOptions: schoolOptions,
      getValue: (student) => student.school || '',
    },
    {
      key: 'contact',
      label: '연락처',
      visibleByDefault: true,
      canInlineEdit: true,
      filterKind: 'text',
      getValue: (student) => student.contact || '',
    },
    {
      key: 'parentContact',
      label: '보호자 연락처',
      visibleByDefault: true,
      canInlineEdit: true,
      filterKind: 'text',
      getValue: (student) => student.parentContact || '',
    },
    {
      key: 'uid',
      label: '학생 고유번호',
      visibleByDefault: true,
      canInlineEdit: true,
      filterKind: 'text',
      getValue: (student) => student.uid || '',
    },
    {
      key: 'enrollDate',
      label: '등록일',
      visibleByDefault: true,
      canInlineEdit: true,
      editKind: 'date',
      filterKind: 'date-range',
      getValue: (student) => student.enrollDate || '',
    },
    {
      key: 'classCount',
      label: '등록 수업 수',
      visibleByDefault: true,
      filterKind: 'number-range',
      getValue: (student) => (student.classIds || []).length,
      sortAccessor: (student) => (student.classIds || []).length,
      render: (student) => (student.classIds || []).length,
    },
    {
      key: 'waitlistClassCount',
      label: '대기 수업 수',
      visibleByDefault: true,
      filterKind: 'number-range',
      getValue: (student) => (student.waitlistClassIds || []).length,
      sortAccessor: (student) => (student.waitlistClassIds || []).length,
      render: (student) => (student.waitlistClassIds || []).length,
    },
  ];
}

export function buildTextbookColumns() {
  return [
    {
      key: 'title',
      label: '교재명',
      visibleByDefault: true,
      canInlineEdit: true,
      filterKind: 'text',
      getValue: (textbook) => textbook.title || '',
      render: (textbook) => <div style={{ fontWeight: 700 }}>{textbook.title}</div>,
    },
    {
      key: 'publisher',
      label: '출판사',
      visibleByDefault: true,
      canInlineEdit: true,
      filterKind: 'single-select',
      getValue: (textbook) => textbook.publisher || '',
    },
    {
      key: 'price',
      label: '판매 금액',
      visibleByDefault: true,
      canInlineEdit: true,
      inputType: 'number',
      filterKind: 'number-range',
      getValue: (textbook) => Number(textbook.price || 0),
      render: (textbook) =>
        textbook.price ? `${Number(textbook.price).toLocaleString('ko-KR')}원` : '-',
    },
    {
      key: 'tags',
      label: '태그',
      visibleByDefault: true,
      filterKind: 'multi-select',
      getValue: (textbook) => textbook.tags || [],
      render: (textbook) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(textbook.tags || []).map((tag) => (
            <span
              key={tag}
              style={{
                padding: '3px 8px',
                borderRadius: 999,
                background: 'var(--accent-light)',
                color: 'var(--accent-color)',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'lessonCount',
      label: '차시 수',
      visibleByDefault: true,
      filterKind: 'number-range',
      getValue: (textbook) => (textbook.lessons || []).length,
      sortAccessor: (textbook) => (textbook.lessons || []).length,
      render: (textbook) => `${(textbook.lessons || []).length}개`,
    },
  ];
}

export function getDefaultClassSearchText(classItem) {
  return [
    getClassDisplayName(classItem),
    getNormalizedClassStatus(classItem),
    getRecruitmentStatus(classItem),
    classItem.subject,
    classItem.grade,
    classItem.teacher,
    classItem.classroom,
    classItem.schedule,
    classItem.period,
    getClassTextbookLabel(classItem, []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
