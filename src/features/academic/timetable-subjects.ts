import type { ResourceOption } from './timetable-plan-contract';

export const TIMETABLE_SUBJECTS = ['영어', '수학'] as const;
const aliases: Record<string, string> = { english: '영어', eng: '영어', math: '수학' };
/** Catalog teams and class subjects use different labels for the same subject. */
export function timetableTeacherMatchesSubject(teacher: Pick<ResourceOption, 'subjects'>, subject = '') {
    const subjects = teacher.subjects.map(value => {
        const token = value.trim().toLowerCase().replace(/\s+/g, '').replace(/(과목|팀)$/, '');
        return aliases[token] || token;
    });
    return (subject ? [subject] : TIMETABLE_SUBJECTS).some(value => subjects.includes(value));
}
export function timetableTeachers(teachers: ResourceOption[], subject = '') {
    return teachers.filter(teacher => teacher.isVisible && !teacher.isMissing && timetableTeacherMatchesSubject(teacher, subject));
}

export function newTimetableSubject(teachers: ResourceOption[], selectedSubject: string, teacherId?: string) {
    if (selectedSubject) return selectedSubject;
    const teacher = teachers.find(row => row.id === teacherId);
    return teacher && timetableTeacherMatchesSubject(teacher, '수학') && !timetableTeacherMatchesSubject(teacher, '영어') ? '수학' : '영어';
}
