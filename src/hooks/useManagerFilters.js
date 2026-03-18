import { useEffect, useMemo, useState } from 'react';
import {
  ALL_OPTION,
  getClassSearchText,
  getClassSubjectOptions,
  getStudentSearchText,
  getTextbookSearchText,
  getTextbookTagOptions,
  uniqueSorted
} from '../components/data-manager/utils';
import { buildSchoolMaster, getAllManagedGrades } from '../lib/schoolConfig';

function getSortValue(activeTab, item) {
  if (activeTab === 'students') {
    return item.name || '';
  }

  if (activeTab === 'classes') {
    return item.className || item.name || '';
  }

  return item.title || '';
}

export function useManagerFilters(activeTab, data) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState('asc');
  const [filterTeacher, setFilterTeacher] = useState(ALL_OPTION);
  const [filterGrade, setFilterGrade] = useState(ALL_OPTION);
  const [filterSchool, setFilterSchool] = useState(ALL_OPTION);
  const [filterSubject, setFilterSubject] = useState(ALL_OPTION);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setSearchQuery('');
    setDebouncedSearchQuery('');
    setSortOrder('asc');
    setFilterTeacher(ALL_OPTION);
    setFilterGrade(ALL_OPTION);
    setFilterSchool(ALL_OPTION);
    setFilterSubject(ALL_OPTION);
  }, [activeTab]);

  const teacherOptions = useMemo(
    () => uniqueSorted((data.classes || []).map((item) => item.teacher)),
    [data.classes]
  );

  const schoolMaster = useMemo(
    () => buildSchoolMaster(data.academicSchools || [], data.students || []),
    [data.academicSchools, data.students]
  );

  const gradeOptions = useMemo(
    () => getAllManagedGrades(),
    []
  );

  const schoolOptions = useMemo(
    () => schoolMaster.map((item) => item.name),
    [schoolMaster]
  );

  const classSubjectOptions = useMemo(
    () => getClassSubjectOptions(data.classes || []),
    [data.classes]
  );

  const textbookTagOptions = useMemo(
    () => getTextbookTagOptions(data.textbooks || []),
    [data.textbooks]
  );

  const filteredData = useMemo(() => {
    const source =
      activeTab === 'students'
        ? data.students || []
        : activeTab === 'classes'
          ? data.classes || []
          : data.textbooks || [];

    const searchValue = debouncedSearchQuery.trim().toLowerCase();

    const nextItems = source.filter((item) => {
      const matchesSearch =
        !searchValue ||
        (activeTab === 'students'
          ? getStudentSearchText(item)
          : activeTab === 'classes'
            ? getClassSearchText(item)
            : getTextbookSearchText(item)
        ).includes(searchValue);

      if (!matchesSearch) {
        return false;
      }

      if (activeTab === 'students') {
        const matchesGrade = filterGrade === ALL_OPTION || item.grade === filterGrade;
        const matchesSchool = filterSchool === ALL_OPTION || item.school === filterSchool;
        return matchesGrade && matchesSchool;
      }

      if (activeTab === 'classes') {
        const matchesTeacher = filterTeacher === ALL_OPTION || item.teacher === filterTeacher;
        const matchesSubject = filterSubject === ALL_OPTION || item.subject === filterSubject;
        return matchesTeacher && matchesSubject;
      }

      if (activeTab === 'textbooks') {
        return filterSubject === ALL_OPTION || (item.tags || []).includes(filterSubject);
      }

      return true;
    });

    return [...nextItems].sort((left, right) => {
      const leftValue = getSortValue(activeTab, left);
      const rightValue = getSortValue(activeTab, right);

      return sortOrder === 'asc'
        ? String(leftValue).localeCompare(String(rightValue), 'ko')
        : String(rightValue).localeCompare(String(leftValue), 'ko');
    });
  }, [
    activeTab,
    data.classes,
    data.students,
    data.textbooks,
    debouncedSearchQuery,
    filterGrade,
    filterSchool,
    filterSubject,
    filterTeacher,
    sortOrder
  ]);

  const currentIds = useMemo(() => filteredData.map((item) => item.id), [filteredData]);

  return {
    searchQuery,
    setSearchQuery,
    sortOrder,
    setSortOrder,
    filterTeacher,
    setFilterTeacher,
    filterGrade,
    setFilterGrade,
    filterSchool,
    setFilterSchool,
    filterSubject,
    setFilterSubject,
    teacherOptions,
    gradeOptions,
    schoolOptions,
    classSubjectOptions,
    textbookTagOptions,
    filteredData,
    currentIds
  };
}
