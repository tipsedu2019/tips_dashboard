import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { Book, Users, ClipboardList, Plus, Trash2, Calendar, Pencil, School, FileSpreadsheet, Clock, Search, Filter, ArrowUpDown, LayoutGrid, List, CheckSquare, Square, BookOpen, Landmark } from 'lucide-react';
import * as XLSX from 'xlsx';
import { stripClassPrefix, parseClassPrefix, computeWeeklyMinutes, formatHours, parseSchedule } from '../data/sampleData';
import { useToast } from '../contexts/ToastContext';

export default function DataManager({ data, dataService }) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('students'); // 'students', 'classes', 'textbooks'
  
  // View states
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'table'
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('name'); // 'name', 'date', etc.
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' | 'desc'
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [filterTeacher, setFilterTeacher] = useState('전체');
  const [filterGrade, setFilterGrade] = useState('전체');
  const [filterSchool, setFilterSchool] = useState('전체');
  const [filterSubject, setFilterSubject] = useState('전체');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [viewingClassStudents, setViewingClassStudents] = useState(null);

  const [editingTextbook, setEditingTextbook] = useState(null);
  const [editingClass, setEditingClass] = useState(null);
  const [editingStudent, setEditingStudent] = useState(null);

  const [newClassTitle, setNewClassTitle] = useState('');
  const [newStudentName, setNewStudentName] = useState('');
  const [newTextbookTitle, setNewTextbookTitle] = useState('');
  
  // Refinements: Column Visibility & Bulk Update
  const [classColumns, setClassColumns] = useState({
    subject: true,
    grade: true,
    className: true,
    schedule: true,
    teacher: true,
    classroom: true,
    studentCount: true,
    textbook: true,
    weeklyHours: true,
    fee: true
  });
  const [showBulkUpdateModal, setShowBulkUpdateModal] = useState(false);
  const [bulkUpdateField, setBulkUpdateField] = useState('teacher');
  const [bulkUpdateValue, setBulkUpdateValue] = useState('');
  const [hoveredId, setHoveredId] = useState(null);
  
  // Drag selection states
  const [isDragging, setIsDragging] = useState(false);
  const [dragPivotId, setDragPivotId] = useState(null);
  const [dragAction, setDragAction] = useState('select'); // 'select' or 'deselect'

  // Selection helpers
  const toggleSelect = (id) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = (ids) => {
    if (selectedIds.size === ids.length && ids.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(ids));
    }
  };

  const handleDragStart = (id, currentlySelected) => {
    setIsDragging(true);
    setDragPivotId(id);
    const newAction = currentlySelected ? 'deselect' : 'select';
    setDragAction(newAction);
    
    // Initial toggle
    const newSelected = new Set(selectedIds);
    if (newAction === 'select') newSelected.add(id);
    else newSelected.delete(id);
    setSelectedIds(newSelected);
  };

  const handleDragEnter = (targetId, allVisibleIds) => {
    if (!isDragging || !dragPivotId) return;

    const pivotIdx = allVisibleIds.indexOf(dragPivotId);
    const targetIdx = allVisibleIds.indexOf(targetId);
    if (pivotIdx === -1 || targetIdx === -1) return;

    const start = Math.min(pivotIdx, targetIdx);
    const end = Math.max(pivotIdx, targetIdx);
    const rangeIds = allVisibleIds.slice(start, end + 1);

    const newSelected = new Set(selectedIds);
    rangeIds.forEach(id => {
      if (dragAction === 'select') newSelected.add(id);
      else newSelected.delete(id);
    });
    setSelectedIds(newSelected);
  };

  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
      setDragPivotId(null);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const handleBulkUpdate = () => {
    if (selectedIds.size === 0) return;
    if (activeTab === 'classes') {
      setBulkUpdateField('teacher');
    } else if (activeTab === 'textbooks') {
      setBulkUpdateField('tags');
    }
    setShowBulkUpdateModal(true);
  };

  const applyBulkUpdate = () => {
    const ids = Array.from(selectedIds);
    if (activeTab === 'classes') {
      dataService.bulkUpdateClasses(ids, { [bulkUpdateField]: bulkUpdateValue });
    } else if (activeTab === 'textbooks') {
      if (bulkUpdateField === 'tags') {
        // Handle tags as an array
        const tagsArray = bulkUpdateValue.split(',').map(s => s.trim()).filter(Boolean);
        dataService.bulkUpdateTextbooks(ids, { addTags: tagsArray });
      } else {
        dataService.bulkUpdateTextbooks(ids, { [bulkUpdateField]: bulkUpdateValue });
      }
    }
    setShowBulkUpdateModal(false);
    setBulkUpdateValue('');
    setSelectedIds(new Set());
    toast.success(`${ids.length}개의 항목이 일괄 수정되었습니다.`);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    if (window.confirm(`선택한 ${selectedIds.size}개의 항목을 삭제하시겠습니까?`)) {
      const ids = Array.from(selectedIds);
      if (activeTab === 'students') dataService.bulkDeleteStudents(ids);
      else if (activeTab === 'classes') dataService.bulkDeleteClasses(ids);
      else if (activeTab === 'textbooks') dataService.bulkDeleteTextbooks(ids);
      setSelectedIds(new Set());
      toast.success(`${ids.length}개의 항목이 성공적으로 삭제되었습니다.`);
    }
  };

  // Reset selection on tab change
  useEffect(() => {
    setSelectedIds(new Set());
    setSearchQuery('');
    setFilterTeacher('전체');
    setFilterGrade('전체');
    setFilterSchool('전체');
    setFilterSubject('전체');
  }, [activeTab]);

  // Filtered and Sorted Data
  const filteredData = useMemo(() => {
    let source = [];
    if (activeTab === 'students') source = data.students || [];
    else if (activeTab === 'classes') source = data.classes || [];
    else if (activeTab === 'textbooks') source = data.textbooks || [];

    let filtered = source.filter(item => {
      const searchStr = debouncedSearchQuery.toLowerCase();
      const name = (item.name || item.className || item.title || '').toLowerCase();
      const matchesSearch = name.includes(searchStr);
      
      let matchesFilters = true;
      if (activeTab === 'students') {
        const itemGrade = (item.grade || '').toLowerCase();
        const fGrade = filterGrade.toLowerCase();
        if (filterGrade !== '전체' && !itemGrade.includes(fGrade)) matchesFilters = false;
        
        if (filterSchool !== '전체' && item.school !== filterSchool) matchesFilters = false;
      } else if (activeTab === 'classes') {
        if (filterTeacher !== '전체' && item.teacher !== filterTeacher) matchesFilters = false;
        if (filterSubject !== '전체' && item.subject !== filterSubject) matchesFilters = false;
      } else if (activeTab === 'textbooks') {
        if (filterSubject !== '전체' && !(item.tags || []).includes(filterSubject)) matchesFilters = false;
      }

      return matchesSearch && matchesFilters;
    });

    // Sort
    return [...filtered].sort((a, b) => {
      const property = sortBy === 'name' ? (a.name ? 'name' : a.className ? 'className' : 'title') : sortBy;
      const valA = (a[property] || '').toString();
      const valB = (b[property] || '').toString();
      return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  }, [activeTab, data, debouncedSearchQuery, sortBy, sortOrder, filterGrade, filterSchool, filterTeacher, filterSubject]);

  const currentIds = useMemo(() => filteredData.map(i => i.id), [filteredData]);

  const handleAddStudent = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setEditingStudent({
      id: Date.now().toString(),
      name: '',
      grade: '',
      school: '',
      contact: '',
      parentContact: '',
      enrollDate: new Date().toISOString().split('T')[0],
      classIds: []
    });
  };

  const handleDeleteStudent = (id) => {
    if (window.confirm('이 학생 정보를 삭제하시겠습니까? 관련 데이터가 모두 삭제됩니다.')) {
      dataService.deleteStudent(id);
      toast.success('학생 정보가 삭제되었습니다.');
    }
  };

  const saveStudentDetails = (student) => {
    if (data.students?.some(s => s.id === student.id)) {
      dataService.updateStudent(student.id, student);
      toast.success('학생 정보가 수정되었습니다.');
    } else {
      dataService.addStudent({ ...student, id: Date.now().toString() });
      toast.success('학생 정보가 등록되었습니다.');
    }
    setEditingStudent(null);
  };

  const handleExcelUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const dataArr = new Uint8Array(event.target.result);
        const workbook = XLSX.read(dataArr, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (!jsonData || jsonData.length < 1) {
          toast.error('엑셀 파일에 데이터가 없습니다.');
          return;
        }

        // Clean headers: trim and remove empty/null headers
        const rawHeaders = jsonData[0] || [];
        const headers = rawHeaders.map(h => String(h || '').trim());
        
        console.log('Detected headers:', headers);

        // Detection logic for MakeEdu files
        const isStudentList = headers.includes('수업명') && headers.includes('이름');
        const isTextbookList = headers.includes('수납명') && headers.includes('판매금액');

        // Defensive checks for data structure
        const currentStudents = data?.students || [];
        const currentClasses = data?.classes || [];

        if (isStudentList) {
          const headerMap = {};
          headers.forEach((h, i) => headerMap[h] = i);

          const nameIdx = headers.findIndex(h => h === '이름');
          const uidIdx = headers.findIndex(h => h === '원생고유번호' || h === '고유번호' || h === '학생번호');
          const phoneIdx = headers.findIndex(h => h === '보호자연락처');
          const stdPhoneIdx = headers.findIndex(h => h === '연락처');
          const classIdx = headers.findIndex(h => h === '수업명');
          const teacherIdx = headers.findIndex(h => h === '담당강사' || h === '담임강사' || h === '강사');
          const roomIdx = headers.findIndex(h => h === '강의실');
          const startIdx = headers.findIndex(h => h === '시작일');
          const endIdx = headers.findIndex(h => h === '종료일');
          const gradeIdx = headers.findIndex(h => h === '학년');
          const schoolIdx = headers.findIndex(h => h === '학교');
          const subjectIdx = headers.findIndex(h => h === '과목');
          const scheduleIdx = headers.findIndex(h => h === '요일/시간');
          const capacityIdx = headers.findIndex(h => h === '정원');
          const periodIdx = headers.findIndex(h => h === '학기');
          const feeIdx = headers.findIndex(h => h === '수업료' || h === '수강료');

          const processedStudents = {}; 
          const processedClasses = {}; 

          for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || !row[nameIdx] || !row[classIdx]) continue;

            const studentName = String(row[nameIdx] || '').trim();
            const className = String(row[classIdx] || '').trim();
            const studentUid = uidIdx !== -1 ? String(row[uidIdx] || '').trim() : '';

            if (!studentName || !className) continue;

            // Add Student
            const studentKey = studentUid || studentName;
            if (!processedStudents[studentKey]) {
              let existingStd = studentUid 
                ? currentStudents.find(s => String(s.uid) === studentUid)
                : currentStudents.find(s => s.name === studentName);

              if (!existingStd) {
                existingStd = dataService.addStudent({
                  uid: studentUid,
                  name: studentName,
                  contact: stdPhoneIdx !== -1 ? String(row[stdPhoneIdx] || '').trim() : '',
                  parentContact: phoneIdx !== -1 ? String(row[phoneIdx] || '').trim() : '',
                  grade: gradeIdx !== -1 ? String(row[gradeIdx] || '').trim() : '',
                  school: schoolIdx !== -1 ? String(row[schoolIdx] || '').trim() : '',
                });
              } else if (studentUid) {
                 // Update name if UID matches but name changed (optional but good for syncing)
                 if (existingStd.name !== studentName) {
                    dataService.updateStudent(existingStd.id, { name: studentName });
                 }
              }
              processedStudents[studentKey] = existingStd;
            }

            // Add/Update Class
            if (!processedClasses[className]) {
              const meta = parseClassPrefix(className); // Extract: [중1수 허승주]
              
              let existingCls = currentClasses.find(c => c.className === className);
              
              // Priority: Row data > Meta data > Empty string
              const rowTeacher = teacherIdx !== -1 ? String(row[teacherIdx] || '').trim() : '';
              const rowGrade = gradeIdx !== -1 ? String(row[gradeIdx] || '').trim() : '';
              
              const classUpdates = {
                teacher: rowTeacher || (meta ? meta.teacher : ''),
                classroom: roomIdx !== -1 ? String(row[roomIdx] || '').trim() : '',
                startDate: startIdx !== -1 ? String(row[startIdx] || '').trim() : '',
                endDate: endIdx !== -1 ? String(row[endIdx] || '').trim() : '',
                grade: rowGrade || (meta ? meta.grade : ''),
                subject: subjectIdx !== -1 ? String(row[subjectIdx] || '').trim() : (meta ? meta.subject : ''),
                schedule: scheduleIdx !== -1 ? String(row[scheduleIdx] || '').trim() : '',
                capacity: capacityIdx !== -1 ? parseInt(row[capacityIdx]) || 0 : 0,
                period: periodIdx !== -1 ? String(row[periodIdx] || '').trim() : '미분류',
                fee: feeIdx !== -1 ? parseInt(row[feeIdx]) || 0 : 0,
              };

              if (!existingCls) {
                existingCls = {
                  id: 'class-' + Date.now() + i,
                  className: className,
                  ...classUpdates,
                  studentIds: []
                };
                dataService.addClass(existingCls);
              } else {
                dataService.updateClass(existingCls.id, classUpdates);
                existingCls = { ...existingCls, ...classUpdates };
              }
              processedClasses[className] = existingCls;
            }

            // Link Student to Class
            const student = processedStudents[studentKey];
            const cls = processedClasses[className];
            if (cls && student) {
              const currentIds = cls.studentIds || [];
              if (!currentIds.includes(student.id)) {
                dataService.updateClass(cls.id, {
                  studentIds: [...currentIds, student.id]
                });
                cls.studentIds = [...currentIds, student.id];
              }
            }
          }
          toast.success(`데이터 분석 완료: 학생 및 수업 정보(강사, 강의실, 기간 등)가 업데이트되었습니다.`);
        } else if (isTextbookList) {
          const nameIdx = headers.indexOf('수납명');
          const priceIdx = headers.indexOf('판매금액');
          const publisherIdx = headers.indexOf('제조사');

          let count = 0;
          for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (row && row[nameIdx]) {
              dataService.addTextbook({
                title: String(row[nameIdx]).trim(),
                price: row[priceIdx] || 0,
                publisher: publisherIdx !== -1 ? row[publisherIdx] : '',
                lessons: []
              });
              count++;
            }
          }
          toast.success(`${count}개의 교재 데이터가 성공적으로 업로드되었습니다.`);
        } else {
          toast.error('지원되지 않는 엑셀 형식입니다. 파일의 첫 번째 줄(헤더) 형식을 확인해주세요.');
        }
      } catch (error) {
        console.error('Excel upload error:', error);
        toast.error('파일 처리 중 오류가 발생했습니다: ' + error.message);
      } finally {
        setIsProcessing(false);
        e.target.value = '';
      }
    };

    reader.onerror = () => {
      toast.error('파일을 읽는 중 오류가 발생했습니다.');
      setIsProcessing(false);
    };

    // Use setTimeout so the isProcessing state triggers a render before reading
    setTimeout(() => {
      reader.readAsArrayBuffer(file);
    }, 500);
  };

  const handleDownloadSample = (type) => {
    let sampleData = [];
    let filename = '';

    if (type === 'students' || type === 'classes') {
      filename = 'TIPS_업로드양식_학생수업.xlsx';
      sampleData = [
        {
          '이름': '홍길동',
          '원생고유번호': 'S1001',
          '학년': '중2',
          '학교': '티팁스중학교',
          '연락처': '010-1234-5678',
          '보호자연락처': '010-5678-1234',
          '수업명': '[중2수 허승주]',
          '과목': '수학',
          '담당강사': '허승주',
          '요일/시간': '월수 17:30-19:30',
          '강의실': 'A강의실',
          '정원': 12,
          '수업료': 300000,
          '학기': '2026-1학기',
          '시작일': '2026-03-01',
          '종료일': '2026-12-31'
        }
      ];
    } else if (type === 'textbooks') {
      filename = 'TIPS_업로드양식_교재.xlsx';
      sampleData = [
        {
          '수납명': '중등 수학 기본서',
          '판매금액': 15000,
          '제조사': '에이치출판사',
          '태그': '수학, 기본, 중2'
        }
      ];
    }

    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'SampleData');
    
    setIsProcessing(true);
    setTimeout(() => {
      XLSX.writeFile(workbook, filename);
      setIsProcessing(false);
      toast.info('샘플 양식 다운로드가 시작되었습니다.');
    }, 500);
  };

  const handleCsvUpload = (e, type) => {
    // ... logic ...
  };

  const handleAddTextbook = (e) => {
    e.preventDefault();
    setEditingTextbook({
      id: Date.now().toString(),
      title: '',
      publisher: '',
      price: '',
      tags: [],
      lessons: [],
    });
  };

  const handleDeleteTextbook = (id) => {
    if (window.confirm('이 교재를 삭제하시겠습니까? 관련된 수업의 교재 정보도 초기화됩니다.')) {
      dataService.deleteTextbook(id);
      toast.success('교재가 삭제되었습니다.');
    }
  };

  const saveTextbookDetails = (tb) => {
    if (data.textbooks?.some(t => t.id === tb.id)) {
      dataService.updateTextbook(tb.id, tb);
      toast.success('교재 정보가 수정되었습니다.');
    } else {
      dataService.addTextbook({ ...tb, id: Date.now().toString() });
      toast.success('교재가 등록되었습니다.');
    }
    setEditingTextbook(null);
  };

  const handleAddClass = (e) => {
    e.preventDefault();
    setEditingClass({
      id: Date.now().toString(),
      className: '',
      subject: '',
      teacher: '',
      classroom: '',
      schedule: '',
      studentIds: [],
      lessons: [],
      capacity: 0,
    });
  };

  const handleDeleteClass = (id) => {
    if (window.confirm('이 수업을 삭제하시겠습니까? 관련된 진도 데이터가 모두 손실됩니다.')) {
      dataService.deleteClass(id);
      toast.success('수업이 삭제되었습니다.');
    }
  };

  const saveClassDetails = (cls) => {
    if (data.classes?.some(c => c.id === cls.id)) {
      dataService.updateClass(cls.id, cls);
      toast.success('수업 정보가 수정되었습니다.');
    } else {
      dataService.addClass({ ...cls, id: Date.now().toString() });
      toast.success('수업이 등록되었습니다.');
    }
    setEditingClass(null);
  };


  if (editingStudent) {
    return (
      <StudentEditor
        student={editingStudent}
        classes={data.classes}
        onSave={saveStudentDetails}
        onCancel={() => setEditingStudent(null)}
      />
    );
  }

  if (editingClass) {
    return (
      <ClassEditor
        cls={editingClass}
        textbooks={data.textbooks}
        students={data.students}
        onSave={saveClassDetails}
        onCancel={() => setEditingClass(null)}
      />
    );
  }

  if (editingTextbook) {
    return (
      <TextbookEditor
        textbook={editingTextbook}
        onSave={saveTextbookDetails}
        onCancel={() => setEditingTextbook(null)}
      />
    );
  }

  const handleInlineEdit = (id, key, value, tabName) => {
    if (tabName === 'students') {
       const obj = data.students?.find(s=>s.id === id);
       if(obj) dataService.updateStudent(id, { ...obj, [key]: value });
    } else if (tabName === 'classes') {
       const obj = data.classes?.find(c=>c.id === id);
       if(obj) dataService.updateClass(id, { ...obj, [key]: value });
    } else if (tabName === 'textbooks') {
       const obj = data.textbooks?.find(t=>t.id === id);
       if(obj) dataService.updateTextbook(id, { ...obj, [key]: value });
    }
  };

  const handleExportData = (type) => {
    try {
      if (!filteredData || filteredData.length === 0) {
        toast.info('내보낼 데이터가 없습니다.');
        return;
      }
      
      let exportData = [];
      let filename = '';
      
      if (type === 'students') {
        filename = 'TIPS_학생목록.xlsx';
        exportData = filteredData.map(s => ({
          '이름': s.name || '',
          '학년': s.grade || '',
          '학교': s.school || '',
          '연락처': s.contact || '',
          '보호자연락처': s.parentContact || '',
          '원생고유번호': s.uid || '',
          '상태': s.status || '',
          '등록일': s.enrollDate || ''
        }));
      } else if (type === 'classes') {
        filename = 'TIPS_수업목록.xlsx';
        exportData = filteredData.map(c => {
          const classMeta = parseClassPrefix(c.className);
          return {
            '수업명': stripClassPrefix(c.className) || '',
            '과목': c.subject || classMeta.subject || '',
            '학년': c.grade || classMeta.grade || '',
            '담임강사': c.teacher || classMeta.teacher || '',
            '요일/시간': (c.schedule || '').replace(/\n/g, ' '),
            '강의실': c.classroom || '',
            '수강인원': (c.studentIds || []).length,
            '정원': c.capacity || 0,
            '대기인원': (c.waitlistIds || []).length
          };
        });
      } else if (type === 'textbooks') {
        filename = 'TIPS_교재목록.xlsx';
        exportData = filteredData.map(t => ({
          '수납명': t.title || '',
          '판매금액': t.price || 0,
          '제조사': t.publisher || '',
          '태그': (t.tags || []).join(', ')
        }));
      }

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
      
      setIsProcessing(true);
      setTimeout(() => {
        XLSX.writeFile(workbook, filename);
        setIsProcessing(false);
        toast.success(`${filename} 파일 다운로드가 완료되었습니다.`);
      }, 500);
    } catch (error) {
      console.error('Export Error:', error);
      toast.error('파일 내보내기 중 오류가 발생했습니다.');
      setIsProcessing(false);
    }
  };

  return (
    <div className="view-container">
      {/* ⚠️ 임시 데이터 동기화 도구 (로컬 -> 클라우드) */}
      <div style={{ margin: '20px 24px', padding: '16px 20px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '16px', border: '1px solid rgba(59, 130, 246, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ background: '#3b82f6', color: 'white', width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Landmark size={20} />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>데이터 클라우드 동기화</h4>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>로컬(내 컴퓨터) 데이터를 온라인 서버(Supabase)로 전송합니다. 배포 후 데이터가 안 보일 때 한 번만 실행하세요.</p>
          </div>
        </div>
        <button 
          onClick={async () => {
            if (window.confirm('현재 로컬 컴퓨터의 데이터를 클라우드로 전송하시겠습니까?')) {
              const res = await dataService.syncLocalStorageData();
              if (res.success) alert(`${res.count}개의 데이터가 성공적으로 전송되었습니다! 이제 배포된 사이트에서 로그인을 다시 시도해 보세요.`);
              else alert('실패: ' + res.error);
            }
          }}
          className="btn-primary" 
          style={{ height: 40, padding: '0 20px', fontSize: 13, background: '#3b82f6' }}
        >
          지금 동기화하기
        </button>
      </div>

      {viewingClassStudents && (
        <StudentManifestModal 
          cls={viewingClassStudents} 
          onClose={() => setViewingClassStudents(null)} 
          data={data}
          onManage={() => {
            setEditingClass(viewingClassStudents);
            setViewingClassStudents(null);
          }}
        />
      )}
      <div className="view-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="view-header-icon" style={{ background: 'rgba(33, 110, 78, 0.1)', color: 'var(--accent-color)' }}>
            <ClipboardList size={22} />
          </div>
          <div>
            <h2 className="view-title">통합 데이터 관리</h2>
            <p className="view-subtitle">학생, 교재, 수업 계획표 데이터를 관리합니다.</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, padding: '0 24px' }}>
        <button 
          className={`h-segment-btn ${activeTab === 'students' ? 'active' : ''}`}
          onClick={() => setActiveTab('students')}
          style={{ flex: 1, padding: '12px', fontSize: 14 }}
        >
          <Users size={18} style={{ marginRight: 8 }} />
          학생 관리
        </button>
        <button 
          className={`h-segment-btn ${activeTab === 'classes' ? 'active' : ''}`}
          onClick={() => setActiveTab('classes')}
          style={{ flex: 1, padding: '12px', fontSize: 14 }}
        >
          <Calendar size={18} style={{ marginRight: 8 }} />
          수업 관리
        </button>
        <button 
          className={`h-segment-btn ${activeTab === 'textbooks' ? 'active' : ''}`}
          onClick={() => setActiveTab('textbooks')}
          style={{ flex: 1, padding: '12px', fontSize: 14 }}
        >
          <Book size={18} style={{ marginRight: 8 }} />
          교재 관리
        </button>
      </div>

      {showBulkUpdateModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, backdropFilter: 'blur(4px)' }}>
          <div style={{ background: 'var(--bg-surface)', width: '90%', maxWidth: 400, borderRadius: 20, padding: 32, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, marginBottom: 20 }}>선택한 {selectedIds.size}개 수업 속성 일괄 변경</h3>
            
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>변경할 항목</label>
              <select className="styled-input" style={{ width: '100%' }} value={bulkUpdateField} onChange={e => setBulkUpdateField(e.target.value)}>
                {activeTab === 'classes' ? (
                  <>
                    <option value="teacher">담당 강사</option>
                    <option value="grade">학년</option>
                    <option value="classroom">강의실</option>
                    <option value="subject">과목 (영어/수학)</option>
                    <option value="period">학기/시즌</option>
                  </>
                ) : (
                  <>
                    <option value="tags">태그 추가 (쉼표로 구분)</option>
                    <option value="publisher">출판사</option>
                  </>
                )}
              </select>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>새로운 값 입력</label>
              {bulkUpdateField === 'tags' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 12px', background: 'var(--bg-surface-hover)', borderRadius: 12, border: '1px solid var(--border-color)' }}>
                  <input 
                    type="text" 
                    className="styled-input" 
                    style={{ width: '100%', border: 'none', padding: 0, background: 'transparent' }}
                    placeholder="태그를 쉼표(,)로 구분하여 입력하세요..."
                    value={bulkUpdateValue}
                    onChange={e => setBulkUpdateValue(e.target.value)}
                  />
                  <div style={{ width: '100%', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                    입력한 태그가 선택된 {selectedIds.size}개 교재에 추가됩니다.
                  </div>
                </div>
              ) : bulkUpdateField === 'subject' ? (
                <select 
                  className="styled-input" 
                  style={{ width: '100%' }}
                  value={bulkUpdateValue}
                  onChange={e => setBulkUpdateValue(e.target.value)}
                >
                  <option value="">적용할 과목 선택...</option>
                  <option value="영어">영어</option>
                  <option value="수학">수학</option>
                </select>
              ) : (
                <input 
                  type="text" 
                  className="styled-input" 
                  style={{ width: '100%' }}
                  placeholder="새로운 값을 입력하세요..."
                  value={bulkUpdateValue}
                  onChange={e => setBulkUpdateValue(e.target.value)}
                />
              )}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn-secondary" style={{ flex: 1, height: 44 }} onClick={() => setShowBulkUpdateModal(false)}>취소</button>
              <button className="btn-primary" style={{ flex: 1, height: 44 }} onClick={applyBulkUpdate}>변경 사항 적용</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: '0 24px 24px' }}>
        {activeTab === 'students' && (
          <>
            <ManagementHeader 
              title="👥 학생 관리" 
              data={data}
              activeTab={activeTab}
              viewMode={viewMode}
              setViewMode={setViewMode}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              filterGrade={filterGrade}
              setFilterGrade={setFilterGrade}
              filterSchool={filterSchool}
              setFilterSchool={setFilterSchool}
              filteredDataCount={filteredData.length}
              selectedIds={selectedIds}
              currentIds={currentIds}
              toggleSelectAll={toggleSelectAll}
              handleDeleteSelected={handleDeleteSelected}
              onExportClick={() => handleExportData('students')}
              onDownloadSample={() => handleDownloadSample('students')}
              onUploadClick={(e) => handleCsvUpload(e, 'students')} 
              uploadIcon={<ClipboardList size={16} />} 
              uploadText="일괄 등록 (CSV)" 
            />
            
            <div style={{ display: 'flex', gap: 10, marginBottom: 24, padding: '0 4px' }}>
              <button className="btn-primary" onClick={handleAddStudent} style={{ padding: '0 24px', height: 44, borderRadius: 10 }}>
                <Plus size={20} /> 새 학생 등록
              </button>
            </div>

            <DataListView 
              activeTab="students"
              onInlineEdit={handleInlineEdit}
              columns={[
                { key: 'name', label: '이름', canInlineEdit: true, render: (item) => <div style={{ fontWeight: 600 }}>{item.name}</div> },
                { key: 'grade', label: '학년' },
                { key: 'school', label: '학교' },
                { key: 'contact', label: '연락처' },
                { key: 'parentContact', label: '보호자연락처' }
              ]}
              listData={filteredData}
              onEdit={setEditingStudent}
              onDelete={handleDeleteStudent}
              selectedIds={selectedIds}
              currentIds={currentIds}
              toggleSelect={toggleSelect}
              toggleSelectAll={toggleSelectAll}
              hoveredId={hoveredId}
              setHoveredId={setHoveredId}
              onDragStart={handleDragStart}
              onDragEnter={handleDragEnter}
              isDragging={isDragging}
            />
          </>
        )}

        {activeTab === 'textbooks' && (
          <>
            <ManagementHeader 
              title="📚 교재 관리" 
              data={data}
              activeTab={activeTab}
              viewMode={viewMode}
              setViewMode={setViewMode}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              filterSubject={filterSubject}
              setFilterSubject={setFilterSubject}
              filteredDataCount={filteredData.length}
              selectedIds={selectedIds}
              currentIds={currentIds}
              toggleSelectAll={toggleSelectAll}
              handleDeleteSelected={handleDeleteSelected}
              handleBulkUpdate={handleBulkUpdate}
              sortOrder={sortOrder}
              setSortOrder={setSortOrder}
              onExportClick={() => handleExportData('textbooks')}
              onDownloadSample={() => handleDownloadSample('textbooks')}
              onUploadClick={(e) => handleExcelUpload(e)} 
              uploadIcon={<FileSpreadsheet size={16} />} 
              uploadText="메이크에듀 엑셀 업로드" 
            />
            
            <form onSubmit={handleAddTextbook} style={{ display: 'flex', gap: 10, marginBottom: 24, background: 'var(--bg-surface-hover)', padding: 16, borderRadius: 12 }}>
              <input 
                type="text" 
                value={newTextbookTitle} 
                onChange={e => setNewTextbookTitle(e.target.value)}
                placeholder="새로운 교재 제목 입력..." 
                className="styled-input"
                style={{ flex: 1, height: 44 }}
              />
              <button type="submit" className="btn-primary" style={{ padding: '0 24px', height: 44, borderRadius: 10 }}>
                <Plus size={18} /> 교재 추가
              </button>
            </form>

            <DataListView 
              columns={[
                { key: 'title', label: '교재명', render: (item) => <div style={{ fontWeight: 600 }}>{item.title}</div> },
                { key: 'publisher', label: '출판사' },
                { key: 'price', label: '가격' },
                { key: 'tags', label: '태그', render: (item) => (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(item.tags || []).map(tag => (
                      <span key={tag} style={{ background: 'var(--accent-light)', color: 'var(--accent-color)', fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{tag}</span>
                    ))}
                  </div>
                )}
              ]}
              listData={filteredData}
              onEdit={setEditingTextbook}
              onDelete={handleDeleteTextbook}
              selectedIds={selectedIds}
              currentIds={currentIds}
              toggleSelect={toggleSelect}
              toggleSelectAll={toggleSelectAll}
              hoveredId={hoveredId}
              setHoveredId={setHoveredId}
              onDragStart={handleDragStart}
              onDragEnter={handleDragEnter}
              isDragging={isDragging}
            />
          </>
        )}

        {activeTab === 'classes' && (
          <>
            <ManagementHeader 
              title="📅 수업 관리" 
              data={data}
              activeTab={activeTab}
              viewMode={viewMode}
              setViewMode={setViewMode}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              filterTeacher={filterTeacher}
              setFilterTeacher={setFilterTeacher}
              filterSubject={filterSubject}
              setFilterSubject={setFilterSubject}
              filteredDataCount={filteredData.length}
              selectedIds={selectedIds}
              currentIds={currentIds}
              toggleSelectAll={toggleSelectAll}
              handleDeleteSelected={handleDeleteSelected}
              handleBulkUpdate={handleBulkUpdate}
              classColumns={classColumns}
              setClassColumns={setClassColumns}
              sortOrder={sortOrder}
              setSortOrder={setSortOrder}
              onExportClick={() => handleExportData('classes')}
              onDownloadSample={() => handleDownloadSample('classes')}
              onUploadClick={(e) => handleExcelUpload(e)} 
              uploadIcon={<FileSpreadsheet size={16} />} 
              uploadText="수업/학생 일괄 업로드 (Excel)" 
            />
            
            <form onSubmit={handleAddClass} style={{ display: 'flex', gap: 10, marginBottom: 24, padding: '0 4px' }}>
              <button type="submit" className="btn-primary" style={{ padding: '0 24px', height: 44, borderRadius: 10 }}>
                <Plus size={18} /> 수업(Class) 개설
              </button>
            </form>

            <DataListView 
              activeTab="classes"
              onInlineEdit={handleInlineEdit}
              columns={[
                ...(classColumns.subject ? [{ key: 'subject', label: '과목' }] : []),
                ...(classColumns.grade ? [{ key: 'grade', label: '학년' }] : []),
                { key: 'className', label: '수업명', canInlineEdit: true, render: (item) => <div style={{ fontWeight: 600, color: 'var(--accent-color)' }}>{stripClassPrefix(item.className)}</div> },
                ...(classColumns.schedule ? [{ key: 'schedule', label: '요일/시간', canInlineEdit: true, render: (item) => (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-line' }}>
                    {parseSchedule(item.schedule).map(s => `${s.day} ${s.start}-${s.end}`).join('\n')}
                  </div>
                )}] : []),
                ...(classColumns.teacher ? [{ key: 'teacher', label: '선생님' }] : []),
                ...(classColumns.classroom ? [{ key: 'classroom', label: '강의실' }] : []),
                ...(classColumns.studentCount ? [
                  { 
                    key: 'studentCount', 
                    label: '👥 인원 (현/정/잔/대)', 
                    render: (item) => {
                      const current = (item.studentIds || []).length;
                      const cap = item.capacity || 0;
                      const remain = cap - current;
                      const wait = (item.waitlistIds || []).length;
                      
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', alignItems: 'center' }}>
                            <span style={{ background: 'var(--accent-light)', color: 'var(--accent-color)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                               {current} / {cap}
                            </span>
                            {remain > 0 && remain <= 3 && (
                              <span style={{ fontSize: 10, background: '#3b82f6', color: 'white', padding: '0 4px', borderRadius: 4 }}>마지막 {remain}석</span>
                            )}
                            {remain <= 0 && cap > 0 && (
                              <span style={{ fontSize: 10, background: '#f59e0b', color: 'white', padding: '0 4px', borderRadius: 4 }}>마감</span>
                            )}
                          </div>
                          {wait > 0 && (
                            <div style={{ background: '#fef3c7', color: '#d97706', borderRadius: 6, padding: '1px 8px', fontSize: 10, fontWeight: 700, border: '1px solid #fcd34d', width: 'fit-content' }}>
                              대기 {wait}명
                            </div>
                          )}
                        </div>
                      );
                    }
                  }
                ] : []),
                ...(classColumns.textbook ? [{ key: 'textbook', label: '교재' }] : []),
                ...(classColumns.weeklyHours ? [{ 
                  key: 'weeklyHours', 
                  label: '주간시간', 
                  render: (item) => {
                    const minutes = computeWeeklyMinutes(item.schedule);
                    return minutes > 0 ? (
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                        {Math.floor(minutes/60)}h{minutes%60 > 0 ? ` ${minutes%60}m` : ''}/주
                      </span>
                    ) : '-';
                  }
                }] : []),
                ...(classColumns.fee ? [{
                  key: 'fee',
                  label: '수업료',
                  render: (item) => (
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {item.fee ? `${item.fee.toLocaleString()}원` : '-'}
                    </div>
                  )
                }] : []),
              ]}
              listData={filteredData}
              onEdit={setEditingClass}
              onDelete={handleDeleteClass}
              selectedIds={selectedIds}
              currentIds={currentIds}
              toggleSelect={toggleSelect}
              toggleSelectAll={toggleSelectAll}
              hoveredId={hoveredId}
              setHoveredId={setHoveredId}
              onDragStart={handleDragStart}
              onDragEnter={handleDragEnter}
              isDragging={isDragging}
            />
          </>
        )}
      </div>
    </div>
  );
}

function TextbookEditor({ textbook, onSave, onCancel }) {
  const [edited, setEdited] = useState({ ...textbook, lessons: textbook.lessons || [] });
  const [newLessonTitle, setNewLessonTitle] = useState('');
  
  const [frequentTags, setFrequentTags] = useState(() => {
    const saved = localStorage.getItem('tips_frequent_tags');
    return saved ? JSON.parse(saved) : ['영어', '수학', '국어', '문법', '독해', '단어', '듣기', '내신', '수능', '초등', '중등', '고등'];
  });
  const [newTag, setNewTag] = useState('');

  const handleAddFrequentTag = (e) => {
    e.preventDefault();
    if (!newTag.trim() || frequentTags.includes(newTag.trim())) return;
    const nextTags = [...frequentTags, newTag.trim()];
    setFrequentTags(nextTags);
    localStorage.setItem('tips_frequent_tags', JSON.stringify(nextTags));
    setNewTag('');
  };

  const handleRemoveFrequentTag = (e, tagToRemove) => {
    e.stopPropagation();
    const nextTags = frequentTags.filter(t => t !== tagToRemove);
    setFrequentTags(nextTags);
    localStorage.setItem('tips_frequent_tags', JSON.stringify(nextTags));
  };

  const handleAddLesson = (e) => {
    e.preventDefault();
    if (!newLessonTitle.trim()) return;
    const newLesson = { id: Date.now().toString(), title: newLessonTitle };
    setEdited(prev => ({ ...prev, lessons: [...prev.lessons, newLesson], totalChapters: prev.lessons.length + 1 }));
    setNewLessonTitle('');
  };

  const handleRemoveLesson = (id) => {
    setEdited(prev => {
      const filtered = prev.lessons.filter(l => l.id !== id);
      return { ...prev, lessons: filtered, totalChapters: filtered.length };
    });
  };

  const [errors, setErrors] = useState({});

  const handleSave = () => {
    const newErrors = {};
    if (!edited.title?.trim()) newErrors.title = '교재명을 입력해주세요.';
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    
    onSave(edited);
  };

  return (
    <div className="view-container" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>교재 및 목차 편집</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn-secondary" onClick={onCancel} style={{ padding: '10px 24px', borderRadius: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>취소</button>
          <button className="btn-primary" onClick={handleSave} style={{ padding: '10px 28px', borderRadius: 12, fontWeight: 600, boxShadow: '0 4px 12px rgba(33, 110, 78, 0.2)' }}>
            <Plus size={18} /> 정보 저장
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 2fr', gap: 24 }}>
        <div className="card-custom p-6">
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>교재 기본 정보</h3>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              교재명 <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input 
              type="text" 
              className={`styled-input ${errors.title ? 'error' : ''}`}
              style={{ borderColor: errors.title ? '#ef4444' : undefined }}
              value={edited.title} 
              onChange={e => {
                setEdited({ ...edited, title: e.target.value });
                if (errors.title) setErrors({...errors, title: null});
              }} 
            />
            {errors.title && <div style={{ color: '#ef4444', fontSize: 11, marginTop: 4 }}>{errors.title}</div>}
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>출판사</label>
            <input 
              type="text" 
              className="styled-input" 
              value={edited.publisher || ''} 
              onChange={e => setEdited({ ...edited, publisher: e.target.value })} 
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>태그 (선택)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {(edited.tags || []).map(tag => (
                <span key={tag} style={{ 
                  background: 'var(--accent-color)', color: 'white', 
                  fontSize: 11, padding: '4px 10px', borderRadius: 20, 
                  display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600
                }}>
                  {tag}
                  <Plus size={12} style={{ transform: 'rotate(45deg)', cursor: 'pointer' }} onClick={() => {
                    const nextTags = edited.tags.filter(t => t !== tag);
                    setEdited({ ...edited, tags: nextTags });
                  }} />
                </span>
              ))}
            </div>
            
            <div style={{ background: 'var(--bg-surface-hover)', padding: 12, borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>자주 사용하는 태그</div>
                <form onSubmit={handleAddFrequentTag} style={{ display: 'flex', gap: 4 }}>
                  <input type="text" className="styled-input" style={{ width: 80, height: 24, fontSize: 10, padding: '0 6px', margin: 0, minHeight: 0 }} placeholder="새 태그..." value={newTag} onChange={e => setNewTag(e.target.value)} />
                  <button type="submit" className="btn-secondary" style={{ padding: '0 6px', height: 24, fontSize: 10 }}>추가</button>
                </form>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {frequentTags.map(tag => {
                  const isSelected = (edited.tags || []).includes(tag);
                  return (
                    <div key={tag} style={{ display: 'flex', alignItems: 'stretch' }}>
                      <button 
                        onClick={() => {
                          const currentTags = edited.tags || [];
                          if (isSelected) {
                            setEdited({ ...edited, tags: currentTags.filter(t => t !== tag) });
                          } else {
                            setEdited({ ...edited, tags: [...currentTags, tag] });
                          }
                        }}
                        style={{ 
                          border: 'none', background: isSelected ? 'var(--accent-light)' : 'var(--bg-surface)',
                          color: isSelected ? 'var(--accent-color)' : 'var(--text-secondary)',
                          fontSize: 11, padding: '4px 8px', borderRadius: '6px 0 0 6px', cursor: 'pointer',
                          fontWeight: isSelected ? 700 : 500, transition: 'all 0.2s',
                          borderRight: `1px solid ${isSelected ? 'rgba(57,158,116,0.2)' : 'var(--border-color)'}`
                        }}
                      >
                        {isSelected ? '✓ ' : '+ '}{tag}
                      </button>
                      <button 
                        onClick={(e) => handleRemoveFrequentTag(e, tag)}
                        style={{
                          border: 'none', background: isSelected ? 'var(--accent-light)' : 'var(--bg-surface)',
                          color: 'var(--text-muted)', fontSize: 10, padding: '0 6px', borderRadius: '0 6px 6px 0', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}
                        title="이 태그 삭제"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="card-custom p-6">
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>교재 단원/목차</h3>
          
          <form onSubmit={handleAddLesson} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <input 
              type="text" 
              className="styled-input" 
              placeholder="단원 또는 회차별 진도 입력..." 
              value={newLessonTitle}
              onChange={e => setNewLessonTitle(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn-secondary" type="submit" style={{ whiteSpace: 'nowrap', padding: '0 16px' }}>
              <Plus size={16} /> 추가
            </button>
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {edited.lessons.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-surface-hover)', borderRadius: 8 }}>
                아직 등록된 수업 계획이 없습니다.<br/>
                <span style={{ fontSize: 12 }}>위 입력창에서 추가해주세요.</span>
              </div>
            ) : (
              edited.lessons.map((lesson, index) => (
                <div key={lesson.id} style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  padding: '12px 16px', 
                  background: 'var(--bg-surface)', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: 8 
                }}>
                  <div style={{ width: 24, height: 24, borderRadius: 12, background: 'var(--accent-light)', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, marginRight: 12 }}>
                    {index + 1}
                  </div>
                  <div style={{ flex: 1, fontWeight: 500, color: 'var(--text-primary)' }}>{lesson.title}</div>
                  <button onClick={() => handleRemoveLesson(lesson.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ClassEditor({ cls, textbooks, students, onSave, onCancel }) {
  const [edited, setEdited] = useState({ 
    ...cls, 
    studentIds: cls.studentIds || [], 
    waitlistIds: cls.waitlistIds || [],
    lessons: cls.lessons || [] 
  });
  const [studentSearch, setStudentSearch] = useState('');
  const [newLessonTitle, setNewLessonTitle] = useState('');

  const handleAddLesson = (e) => {
    e.preventDefault();
    if (!newLessonTitle.trim()) return;
    const newLesson = { id: Date.now().toString(), title: newLessonTitle };
    setEdited(prev => ({ ...prev, lessons: [...(prev.lessons || []), newLesson] }));
    setNewLessonTitle('');
  };

  const handleRemoveLesson = (id) => {
    setEdited(prev => ({
      ...prev,
      lessons: (prev.lessons || []).filter(l => l.id !== id)
    }));
  };

  const availableTextbooks = textbooks || [];
  const allStudents = students || [];

  // Enrolled students
  const enrolledStudents = useMemo(() => {
    return (edited.studentIds || []).map(id => allStudents.find(s => s.id === id)).filter(Boolean);
  }, [edited.studentIds, allStudents]);

  // Waitlisted students
  const waitlistedStudents = useMemo(() => {
    return (edited.waitlistIds || []).map(id => allStudents.find(s => s.id === id)).filter(Boolean);
  }, [edited.waitlistIds, allStudents]);

  // Search results for adding
  const searchResults = useMemo(() => {
    if (!studentSearch.trim()) return [];
    const searchStr = studentSearch.toLowerCase();
    const existingIds = [...(edited.studentIds || []), ...(edited.waitlistIds || [])];
    return allStudents
      .filter(s => !existingIds.includes(s.id))
      .filter(s => 
        s.name.toLowerCase().includes(searchStr) || 
        (s.school && s.school.toLowerCase().includes(searchStr)) ||
        (s.grade && s.grade.toLowerCase().includes(searchStr))
      )
      .slice(0, 5);
  }, [studentSearch, edited.studentIds, edited.waitlistIds, allStudents]);

  const handleAddStudent = (studentId, toWaitlist = false) => {
    if (toWaitlist) {
      if (!(edited.waitlistIds || []).includes(studentId)) {
        setEdited(prev => ({ ...prev, waitlistIds: [...(prev.waitlistIds || []), studentId] }));
      }
    } else {
      if (!(edited.studentIds || []).includes(studentId)) {
        setEdited(prev => ({ ...prev, studentIds: [...(prev.studentIds || []), studentId] }));
      }
    }
    setStudentSearch('');
  };

  const handleRemoveStudent = (studentId, fromWaitlist = false) => {
    if (fromWaitlist) {
      setEdited(prev => ({ ...prev, waitlistIds: (prev.waitlistIds || []).filter(id => id !== studentId) }));
    } else {
      setEdited(prev => ({ ...prev, studentIds: (prev.studentIds || []).filter(id => id !== studentId) }));
    }
  };

  const moveStudent = (studentId, toWaitlist = false) => {
    if (toWaitlist) {
      // Move from enrolled to waitlist
      setEdited(prev => ({
        ...prev,
        studentIds: (prev.studentIds || []).filter(id => id !== studentId),
        waitlistIds: [...(prev.waitlistIds || []), studentId]
      }));
    } else {
      // Move from waitlist to enrolled
      setEdited(prev => ({
        ...prev,
        waitlistIds: (prev.waitlistIds || []).filter(id => id !== studentId),
        studentIds: [...(prev.studentIds || []), studentId]
      }));
    }
  };

  const [errors, setErrors] = useState({});

  const handleSave = () => {
    const newErrors = {};
    if (!edited.className?.trim()) newErrors.className = '수업명을 입력해주세요.';
    if (!edited.subject?.trim()) newErrors.subject = '과목을 입력해주세요.';
    if (!edited.teacher?.trim()) newErrors.teacher = '담당 강사를 입력해주세요.';
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // Scroll to top to see error if needed, but the fields are likely visible
      return;
    }
    
    onSave(edited);
  };

  return (
    <div className="view-container" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>수업 정보 편집</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn-secondary" onClick={onCancel} style={{ padding: '10px 24px', borderRadius: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>취소</button>
          <button className="btn-primary" onClick={handleSave} style={{ padding: '10px 28px', borderRadius: 12, fontWeight: 600, boxShadow: '0 4px 12px rgba(33, 110, 78, 0.2)' }}>
            <Plus size={18} /> 설정 저장
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.2fr) minmax(300px, 1fr) minmax(300px, 1fr)', gap: 24 }}>
        <div className="card-custom p-6">
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>기본 정보</h3>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              수업명 (예: 중2A 영어) <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input 
              type="text" 
              className={`styled-input ${errors.className ? 'error' : ''}`} 
              style={{ borderColor: errors.className ? '#ef4444' : undefined }}
              value={edited.className || ''} 
              onChange={e => {
                setEdited({ ...edited, className: e.target.value });
                if (errors.className) setErrors({...errors, className: null});
              }} 
            />
            {errors.className && <div style={{ color: '#ef4444', fontSize: 11, marginTop: 4 }}>{errors.className}</div>}
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                해당 과목 <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <select 
                className={`styled-input ${errors.subject ? 'error' : ''}`} 
                style={{ borderColor: errors.subject ? '#ef4444' : undefined }}
                value={edited.subject || ''} 
                onChange={e => {
                  setEdited({ ...edited, subject: e.target.value });
                  if (errors.subject) setErrors({...errors, subject: null});
                }}
              >
                <option value="">과목 선택...</option>
                <option value="영어">영어</option>
                <option value="수학">수학</option>
              </select>
              {errors.subject && <div style={{ color: '#ef4444', fontSize: 11, marginTop: 4 }}>{errors.subject}</div>}
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                담당 강사 <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input 
                type="text" 
                className={`styled-input ${errors.teacher ? 'error' : ''}`} 
                style={{ borderColor: errors.teacher ? '#ef4444' : undefined }}
                value={edited.teacher || ''} 
                onChange={e => {
                  setEdited({ ...edited, teacher: e.target.value });
                  if (errors.teacher) setErrors({...errors, teacher: null});
                }} 
              />
              {errors.teacher && <div style={{ color: '#ef4444', fontSize: 11, marginTop: 4 }}>{errors.teacher}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>강의실</label>
              <input type="text" className="styled-input" value={edited.classroom || ''} onChange={e => setEdited({ ...edited, classroom: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>정원 (명)</label>
              <input type="number" className="styled-input" value={edited.capacity || 0} onChange={e => setEdited({ ...edited, capacity: parseInt(e.target.value) || 0 })} />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>학기/시즌 구분 (예: 2026년 1학기)</label>
            <input type="text" className="styled-input" value={edited.period || ''} onChange={e => setEdited({ ...edited, period: e.target.value })} />
          </div>

          <div style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>스케줄 & 교재 설정</h3>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>스케줄 입력 (예: 월수 17:30-19:30)</label>
              <textarea 
                className="styled-input" 
                style={{ minHeight: 80, resize: 'vertical', width: '100%' }}
                value={edited.schedule || ''} 
                onChange={e => setEdited({ ...edited, schedule: e.target.value })}
                placeholder={'월수 17:00-19:00\n[3/1~4/30] 토 13:00-15:00'}
              />
            </div>
            
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>수업료 (원)</label>
                <input type="number" className="styled-input" value={edited.fee || 0} onChange={e => setEdited({ ...edited, fee: parseInt(e.target.value) || 0 })} />
              </div>
              <div style={{ flex: 1 }}>
                {/* Reserved for future field */}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>개강일</label>
                <input type="date" className="styled-input" value={edited.startDate || ''} onChange={e => setEdited({ ...edited, startDate: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>종강일</label>
                <input type="date" className="styled-input" value={edited.endDate || ''} onChange={e => setEdited({ ...edited, endDate: e.target.value })} />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>사용 교재 연결</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select 
                  className="styled-input" 
                  value={(edited.textbookIds && edited.textbookIds[0]) || ''}
                  onChange={e => {
                    const val = e.target.value;
                    setEdited({ ...edited, textbookIds: val ? [val] : [], textbook: val ? availableTextbooks.find(t=>t.id===val)?.title : '' });
                  }}
                  style={{ cursor: 'pointer', flex: 1 }}
                >
                  <option value="">교재 선택 안함</option>
                  {availableTextbooks.map(tb => (
                    <option key={tb.id} value={tb.id}>{tb.title}</option>
                  ))}
                </select>
                {(edited.textbookIds && edited.textbookIds[0]) && (
                  <button 
                    className="btn-secondary"
                    onClick={(e) => {
                      e.preventDefault();
                      const tb = availableTextbooks.find(t => t.id === edited.textbookIds[0]);
                      if (tb && tb.lessons && tb.lessons.length > 0) {
                        const confirmLoad = window.confirm('교재의 목차를 수업 계획표로 불러오시겠습니까? 기존 계획은 유지되며 뒤에 추가됩니다.');
                        if (confirmLoad) {
                          const newLessons = tb.lessons.map(l => ({ ...l, id: Date.now().toString() + Math.random().toString(36).substring(7) }));
                          setEdited(prev => ({ ...prev, lessons: [...(prev.lessons || []), ...newLessons] }));
                        }
                      } else {
                        alert('연결된 교재에 목차가 없습니다.');
                      }
                    }}
                    style={{ whiteSpace: 'nowrap', fontSize: 12, padding: '0 12px' }}
                  >
                    목차 불러오기
                  </button>
                )}
              </div>
            </div>

            <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px dashed var(--border-color)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>수업 계획표 설계</h3>
              
              <form onSubmit={handleAddLesson} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input 
                  type="text" 
                  className="styled-input" 
                  placeholder="단원명 또는 회차별 진도 입력..." 
                  value={newLessonTitle}
                  onChange={e => setNewLessonTitle(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="btn-secondary" type="submit" style={{ whiteSpace: 'nowrap', padding: '0 16px' }}>
                  <Plus size={16} /> 추가
                </button>
              </form>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(edited.lessons || []).length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-surface-hover)', borderRadius: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>아직 등록된 수업 계획이 없습니다.</div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>회차별 진도 목표를 추가해보세요.</div>
                  </div>
                ) : (
                  (edited.lessons || []).map((lesson, index) => (
                    <div key={lesson.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                      <div style={{ width: 22, height: 22, borderRadius: 11, background: 'var(--accent-light)', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, marginRight: 10 }}>
                        {index + 1}
                      </div>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{lesson.title}</div>
                      <button onClick={(e) => { e.preventDefault(); handleRemoveLesson(lesson.id); }} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="card-custom p-6" style={{ gridColumn: 'span 2' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* Enrollment Management */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>👥 수강생 관리 ({enrolledStudents.length}명)</h3>
                <div style={{ position: 'relative', width: 140 }}>
                   <div style={{ position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                    <input 
                      type="text" 
                      className="styled-input" 
                      style={{ paddingLeft: 30, width: '100%', height: 32, fontSize: 12 }}
                      placeholder="학생 검색..."
                      value={studentSearch}
                      onChange={e => setStudentSearch(e.target.value)}
                    />
                  </div>
                  {searchResults.length > 0 && (
                    <div className="card-custom animate-in" style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 8, zIndex: 10, padding: 6, width: 220, boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
                      {searchResults.map(s => (
                        <div key={s.id} style={{ display: 'flex', gap: 4 }}>
                          <button 
                            onClick={() => handleAddStudent(s.id, false)}
                            className="list-item-hover"
                            style={{ 
                              flex: 1, border: 'none', background: 'transparent', textAlign: 'left', 
                              padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                            }}
                          >
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.grade}</div>
                          </button>
                          <button 
                            onClick={() => handleAddStudent(s.id, true)}
                            title="대기로 추가"
                            style={{ border: 'none', background: 'var(--bg-surface-hover)', borderRadius: 8, padding: '0 8px', cursor: 'pointer', color: 'var(--text-muted)' }}
                          >
                             대기
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto', paddingRight: 4 }}>
                {enrolledStudents.length > 0 ? (
                  enrolledStudents.map(s => (
                    <div key={s.id} style={{ 
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                      padding: '10px 14px', background: 'var(--bg-surface-hover)', borderRadius: 10,
                      border: '1px solid var(--border-color)'
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name} <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>({s.uid || '고유번호 없음'})</span></div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.school} {s.grade}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button 
                          onClick={() => moveStudent(s.id, true)}
                          className="btn-icon"
                          style={{ fontSize: 10, padding: '4px 8px', height: 'auto' }}
                          title="대기로 이동"
                        >
                          대기전환
                        </button>
                        <button 
                          onClick={() => handleRemoveStudent(s.id, false)}
                          className="btn-icon" 
                          style={{ color: '#ef4444' }}
                          title="수강 제외"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-surface-hover)', borderRadius: 12 }}>
                    <Users size={32} style={{ opacity: 0.3, margin: '0 auto 8px', display: 'block' }} />
                    <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>수강 중인 학생이 없습니다.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Waitlist Management */}
            <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#f59e0b' }}>⏳ 대기생 관리 ({waitlistedStudents.length}명)</h3>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto', paddingRight: 4 }}>
                {waitlistedStudents.length > 0 ? (
                  waitlistedStudents.map(s => (
                    <div key={s.id} style={{ 
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                      padding: '10px 14px', background: 'rgba(245, 158, 11, 0.05)', borderRadius: 10,
                      border: '1px solid rgba(245, 158, 11, 0.2)'
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name} <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>({s.uid || '고유번호 없음'})</span></div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.school} {s.grade}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button 
                          onClick={() => moveStudent(s.id, false)}
                          className="btn-primary"
                          style={{ fontSize: 10, padding: '4px 8px', height: 'auto' }}
                        >
                          등록
                        </button>
                        <button 
                          onClick={() => handleRemoveStudent(s.id, true)}
                          className="btn-icon" 
                          style={{ color: '#ef4444' }}
                          data-tooltip="대기 제외"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-surface-hover)', borderRadius: 12 }}>
                    <Users size={32} style={{ opacity: 0.3, margin: '0 auto 8px', display: 'block' }} />
                    <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>대기 중인 학생이 없습니다.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StudentEditor({ student, classes, onSave, onCancel }) {
  const [edited, setEdited] = useState({ 
    ...student, 
    classIds: student.classIds || [],
    waitlistClassIds: student.waitlistClassIds || []
  });
  const [classSearch, setClassSearch] = useState('');

  const allClasses = classes || [];

  // Enrolled classes
  const enrolledClasses = useMemo(() => {
    return (edited.classIds || []).map(id => allClasses.find(c => c.id === id)).filter(Boolean);
  }, [edited.classIds, allClasses]);

  // Waitlisted classes
  const waitlistedClasses = useMemo(() => {
    return (edited.waitlistClassIds || []).map(id => allClasses.find(c => c.id === id)).filter(Boolean);
  }, [edited.waitlistClassIds, allClasses]);

  // Class search results
  const searchResults = useMemo(() => {
    if (!classSearch.trim()) return [];
    const searchStr = classSearch.toLowerCase();
    const existingIds = [...(edited.classIds || []), ...(edited.waitlistClassIds || [])];
    return allClasses
      .filter(c => !existingIds.includes(c.id))
      .filter(c => 
        c.className.toLowerCase().includes(searchStr) || 
        (c.subject && c.subject.toLowerCase().includes(searchStr)) ||
        (c.teacher && c.teacher.toLowerCase().includes(searchStr))
      )
      .slice(0, 5);
  }, [classSearch, edited.classIds, edited.waitlistClassIds, allClasses]);

  const handleAddClass = (classId, toWaitlist = false) => {
    if (toWaitlist) {
      if (!(edited.waitlistClassIds || []).includes(classId)) {
        setEdited(prev => ({ ...prev, waitlistClassIds: [...(prev.waitlistClassIds || []), classId] }));
      }
    } else {
      if (!(edited.classIds || []).includes(classId)) {
        setEdited(prev => ({ ...prev, classIds: [...(prev.classIds || []), classId] }));
      }
    }
    setClassSearch('');
  };

  const handleRemoveClass = (classId, fromWaitlist = false) => {
    if (fromWaitlist) {
      setEdited(prev => ({ ...prev, waitlistClassIds: (prev.waitlistClassIds || []).filter(id => id !== classId) }));
    } else {
      setEdited(prev => ({ ...prev, classIds: (prev.classIds || []).filter(id => id !== classId) }));
    }
  };

  const moveClass = (classId, toWaitlist = false) => {
    if (toWaitlist) {
      setEdited(prev => ({
        ...prev,
        classIds: (prev.classIds || []).filter(id => id !== classId),
        waitlistClassIds: [...(prev.waitlistClassIds || []), classId]
      }));
    } else {
      setEdited(prev => ({
        ...prev,
        waitlistClassIds: (prev.waitlistClassIds || []).filter(id => id !== classId),
        classIds: [...(prev.classIds || []), classId]
      }));
    }
  };

  const [errors, setErrors] = useState({});

  const handleSave = () => {
    const newErrors = {};
    if (!edited.name?.trim()) newErrors.name = '이름을 입력해주세요.';
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    
    onSave(edited);
  };

  return (
    <div className="view-container animate-in" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>학생 상세 정보 편집</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>{edited.name || '새 학생'} 학생의 인적사항 및 수강 수업을 관리합니다.</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn-secondary" onClick={onCancel} style={{ padding: '10px 24px', borderRadius: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>취소</button>
          <button className="btn-primary" onClick={handleSave} style={{ padding: '10px 28px', borderRadius: 12, fontWeight: 600, boxShadow: '0 4px 12px rgba(33, 110, 78, 0.2)' }}>
            <Plus size={18} /> 설정 저장
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 24 }}>
        <div className="card-custom p-8">
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={18} className="text-accent" /> 기본 인적 사항
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                이름 <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input 
                type="text" 
                className={`styled-input ${errors.name ? 'error' : ''}`} 
                style={{ borderColor: errors.name ? '#ef4444' : undefined }}
                value={edited.name || ''} 
                onChange={e => {
                  setEdited({ ...edited, name: e.target.value });
                  if (errors.name) setErrors({...errors, name: null});
                }} 
              />
              {errors.name && <div style={{ color: '#ef4444', fontSize: 11, marginTop: 4 }}>{errors.name}</div>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>학년</label>
              <input type="text" className="styled-input" placeholder="예: 중2" value={edited.grade || ''} onChange={e => setEdited({ ...edited, grade: e.target.value })} />
            </div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>학교</label>
            <input type="text" className="styled-input" placeholder="학교명 입력" value={edited.school || ''} onChange={e => setEdited({ ...edited, school: e.target.value })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>학생 연락처</label>
              <input type="text" className="styled-input" placeholder="010-0000-0000" value={edited.contact || ''} onChange={e => setEdited({ ...edited, contact: e.target.value })} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>학부모 연락처</label>
              <input type="text" className="styled-input" placeholder="010-0000-0000" value={edited.parentContact || ''} onChange={e => setEdited({ ...edited, parentContact: e.target.value })} />
            </div>
          </div>
        </div>

        <div className="card-custom p-8">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* Class Enrollment */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>📋 수강 중인 수업 ({enrolledClasses.length}개)</h3>
                <div style={{ position: 'relative', width: 140 }}>
                   <div style={{ position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                    <input 
                      type="text" 
                      className="styled-input" 
                      style={{ paddingLeft: 30, width: '100%', height: 32, fontSize: 12 }}
                      placeholder="수업 검색..."
                      value={classSearch}
                      onChange={e => setClassSearch(e.target.value)}
                    />
                  </div>
                  {searchResults.length > 0 && (
                    <div className="card-custom animate-in" style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 8, zIndex: 10, padding: 6, width: 220, boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
                      {searchResults.map(c => (
                        <div key={c.id} style={{ display: 'flex', gap: 4 }}>
                          <button 
                            onClick={() => handleAddClass(c.id, false)}
                            className="list-item-hover"
                            style={{ 
                              flex: 1, border: 'none', background: 'transparent', textAlign: 'left', 
                              padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                            }}
                          >
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{stripClassPrefix(c.className)}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{c.teacher} · {c.subject}</div>
                          </button>
                          <button 
                            onClick={() => handleAddClass(c.id, true)}
                            title="대기로 추가"
                            style={{ border: 'none', background: 'var(--bg-surface-hover)', borderRadius: 8, padding: '0 8px', cursor: 'pointer', color: 'var(--text-muted)' }}
                          >
                             대기
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto', paddingRight: 4 }}>
                {enrolledClasses.length > 0 ? (
                  enrolledClasses.map(c => (
                    <div key={c.id} style={{ 
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                      padding: '10px 14px', background: 'var(--bg-surface-hover)', borderRadius: 10,
                      border: '1px solid var(--border-color)'
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{stripClassPrefix(c.className)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.teacher} · {c.subject}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => moveClass(c.id, true)} className="btn-icon" style={{ fontSize: 10, padding: '4px 8px', height: 'auto' }}>대기</button>
                        <button onClick={() => handleRemoveClass(c.id, false)} className="btn-icon" style={{ color: '#ef4444' }}><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-surface-hover)', borderRadius: 12 }}>
                    <BookOpen size={32} style={{ opacity: 0.3, margin: '0 auto 8px', display: 'block' }} />
                    <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>수강 중인 수업이 없습니다.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Waitlist Enrollment */}
            <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#f59e0b' }}>⏳ 대기 중인 수업 ({waitlistedClasses.length}개)</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto', paddingRight: 4 }}>
                {waitlistedClasses.length > 0 ? (
                  waitlistedClasses.map(c => (
                    <div key={c.id} style={{ 
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                      padding: '10px 14px', background: 'rgba(245, 158, 11, 0.05)', borderRadius: 10,
                      border: '1px solid rgba(245, 158, 11, 0.2)'
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{stripClassPrefix(c.className)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.teacher} · {c.subject}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => moveClass(c.id, false)} className="btn-primary" style={{ fontSize: 10, padding: '4px 8px', height: 'auto' }}>등록</button>
                        <button onClick={() => handleRemoveClass(c.id, true)} className="btn-icon" style={{ color: '#ef4444' }}><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-surface-hover)', borderRadius: 12 }}>
                    <BookOpen size={32} style={{ opacity: 0.3, margin: '0 auto 8px', display: 'block' }} />
                    <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>대기 중인 수업이 없습니다.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ManagementHeader = ({ 
  title, showFilters = true, onUploadClick, uploadIcon, uploadText, onExportClick,
  onDownloadSample,
  data, activeTab, viewMode, setViewMode, searchQuery, setSearchQuery,
  filterGrade, setFilterGrade, filterTeacher, setFilterTeacher, filterSubject, setFilterSubject, filterSchool, setFilterSchool,
  filteredDataCount, selectedIds, currentIds, toggleSelectAll, handleDeleteSelected,
  handleBulkUpdate, classColumns, setClassColumns, sortOrder, setSortOrder
}) => {
  return (
    <div className="card-custom p-6" style={{ marginBottom: 20 }}>
      {/* (Copy of the logic with prop references) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{title} <span style={{fontSize: 14, color: 'var(--text-muted)', fontWeight: 500}}>({filteredDataCount})</span></h3>
        <div style={{ display: 'flex', gap: 10 }}>
          {onExportClick && (
            <button className="btn-secondary" onClick={onExportClick} style={{ padding: '8px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, height: 38, background: 'var(--bg-surface)' }}>
              <FileSpreadsheet size={16} /> 엑셀 내보내기
            </button>
          )}
          {onDownloadSample && (
            <button className="btn-secondary" onClick={onDownloadSample} style={{ padding: '8px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, height: 38, background: 'var(--bg-surface)' }}>
              <Clock size={16} /> 샘플 양식 다운로드
            </button>
          )}
          {onUploadClick && (
            <label className="btn-primary" style={{ cursor: 'pointer', padding: '8px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, height: 38, border: 'none' }}>
              {uploadIcon} {uploadText}
              <input type="file" accept=".xlsx, .xls, .csv" style={{ display: 'none' }} onChange={onUploadClick} />
            </label>
          )}
          <div style={{ borderLeft: '1px solid var(--border-color)', margin: '0 5px' }}></div>
          {activeTab === 'classes' && (
            <div style={{ position: 'relative' }}>
              <button 
                className="btn-icon" 
                onClick={() => document.getElementById('column-selector').classList.toggle('show')}
                style={{ padding: 8, background: 'var(--bg-surface-hover)' }}
                data-tooltip="표시 항목 선택"
              >
                <Filter size={18} />
              </button>
              <div id="column-selector" className="card-custom" style={{ 
                position: 'absolute', top: '100%', right: 0, zIndex: 100, width: 200, padding: 16, 
                marginTop: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', display: 'none' 
              }}>
                <style>{`#column-selector.show { display: block !important; }`}</style>
                <h4 style={{ fontSize: 12, fontWeight: 700, marginBottom: 12, color: 'var(--text-muted)' }}>수업 목록 컬럼 설정</h4>
                {Object.keys(classColumns).map(col => (
                  <label key={col} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input 
                      type="checkbox" 
                      checked={classColumns[col]} 
                      onChange={() => setClassColumns(prev => ({ ...prev, [col]: !prev[col] }))} 
                    />
                    {col === 'subject' ? '과목' : 
                     col === 'grade' ? '학년' : 
                     col === 'className' ? '수업명' :
                     col === 'schedule' ? '요일/시간' :
                     col === 'teacher' ? '선생님' : 
                     col === 'classroom' ? '강의실' : 
                     col === 'studentCount' ? '인원현황' : 
                     col === 'textbook' ? '교재' : 
                     col === 'weeklyHours' ? '주간시간' : col}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 2, minWidth: 200 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
          <input 
            type="text" 
            placeholder="검색어 입력..." 
            className="styled-input" 
            style={{ paddingLeft: 40, width: '100%' }}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        
        {showFilters && activeTab === 'students' && (
          <>
            <select className="styled-input" style={{ flex: 1 }} value={filterSchool} onChange={e => setFilterSchool(e.target.value)}>
              <option value="전체">모든 학교</option>
              {[...new Set(data.students?.map(s => s.school).filter(Boolean))].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="styled-input" style={{ flex: 1 }} value={filterGrade} onChange={e => setFilterGrade(e.target.value)}>
              <option value="전체">모든 학년</option>
              {[...new Set(data.students?.map(s => s.grade).filter(Boolean))].map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </>
        )}

        {showFilters && activeTab === 'classes' && (
          <>
            <select className="styled-input" style={{ flex: 1 }} value={filterTeacher} onChange={e => setFilterTeacher(e.target.value)}>
              <option value="전체">모든 강사</option>
              {[...new Set(data.classes?.map(c => c.teacher).filter(Boolean))].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="styled-input" style={{ flex: 1 }} value={filterSubject} onChange={e => setFilterSubject(e.target.value)}>
              <option value="전체">모든 과목</option>
              <option value="영어">영어</option>
              <option value="수학">수학</option>
            </select>
          </>
        )}

        {showFilters && activeTab === 'textbooks' && (
          <select className="styled-input" style={{ flex: 1 }} value={filterSubject} onChange={e => setFilterSubject(e.target.value)}>
            <option value="전체">모든 태그</option>
            {[...new Set(data.textbooks?.flatMap(t => t.tags || []).filter(Boolean))].map(tag => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        )}

        <button 
          className="btn-secondary" 
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px' }}
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
        >
          <ArrowUpDown size={16} />
          {sortOrder === 'asc' ? '오름차순' : '내림차순'}
        </button>
      </div>

      {selectedIds.size > 0 && (
        <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(57, 158, 116, 0.05)', border: '1px solid rgba(57, 158, 116, 0.2)', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 700, color: 'var(--accent-color)' }}>{selectedIds.size}개 항목 선택됨</span>
            <button className="btn-secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => toggleSelectAll(currentIds)}>
              {selectedIds.size === currentIds.length ? '선택 해제' : '전체 선택'}
            </button>
            {(activeTab === 'classes' || activeTab === 'textbooks') && (
              <button className="btn-secondary" style={{ padding: '4px 12px', fontSize: 12, background: 'var(--accent-light)', color: 'var(--accent-color)', border: 'none' }} onClick={handleBulkUpdate}>
                {activeTab === 'classes' ? '속성 일괄 변경' : '태그 일괄 변경'}
              </button>
            )}
          </div>
          <button className="btn-secondary" style={{ background: '#fee2e2', color: '#ef4444', border: 'none', padding: '8px 16px', fontWeight: 600 }} onClick={handleDeleteSelected}>
            <Trash2 size={16} style={{ marginRight: 8 }} />
            일괄 삭제
          </button>
        </div>
      )}
    </div>
  );
};

const DataListView = ({ 
  columns, listData, onEdit, onDelete, selectedIds, currentIds, 
  toggleSelect, toggleSelectAll, hoveredId, setHoveredId,
  isDragging, onDragStart, onDragEnter,
  activeTab, onInlineEdit
}) => {
  const [editingCell, setEditingCell] = useState(null); // { id, key }
  const [editValue, setEditValue] = useState('');

  const submitInlineEdit = useCallback(() => {
    if (editingCell) {
      onInlineEdit(editingCell.id, editingCell.key, editValue, activeTab);
      setEditingCell(null);
    }
  }, [editingCell, editValue, activeTab, onInlineEdit]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      submitInlineEdit();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  }, [submitInlineEdit]);

  const handleRowDoubleClick = useCallback((itemId, key, val) => {
    if (key === null) { 
      setEditingCell(null);
    } else {
      setEditingCell({ id: itemId, key });
      setEditValue(val);
    }
  }, []);

  const handleRowMouseDown = useCallback((itemId, isSelected, e) => {
    e.preventDefault();
    onDragStart(itemId, isSelected);
  }, [onDragStart]);

  const handleRowMouseEnter = useCallback((itemId, currentIds) => {
    setHoveredId(itemId);
    if (onDragEnter) onDragEnter(itemId, currentIds);
  }, [setHoveredId, onDragEnter]);

  const handleRowMouseLeave = useCallback(() => {
    setHoveredId(null);
  }, [setHoveredId]);

  const handleRowEdit = useCallback((item) => {
    onEdit(item);
  }, [onEdit]);

  const handleRowDelete = useCallback((itemId) => {
    onDelete(itemId);
  }, [onDelete]);

  return (
    <div className="card-custom" style={{ overflow: 'hidden', padding: 0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--bg-surface-hover)', borderBottom: '1px solid var(--border-color)' }}>
            <th style={{ padding: '12px 16px', textAlign: 'left', width: 40 }}>
              <button 
                onClick={() => toggleSelectAll(currentIds)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
              >
                {selectedIds.size === currentIds.length && currentIds.length > 0 ? <CheckSquare size={18} color="var(--accent-color)" /> : <Square size={18} color="var(--text-muted)" />}
              </button>
            </th>
            {columns.map(col => (
              <th key={col.key} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{col.label}</th>
            ))}
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>작업</th>
          </tr>
        </thead>
        <tbody>
          {listData.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 2} style={{ padding: '80px 0', textAlign: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, opacity: 0.6 }}>
                  <ClipboardList size={48} strokeWidth={1.5} />
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginTop: 8 }}>
                    {activeTab === 'students' ? '등록된 학생 데이터가 없습니다' : 
                     activeTab === 'classes' ? '개설된 수업 데이터가 없습니다' : 
                     '등록된 교재 데이터가 없습니다'}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    상단의 '등록' 또는 '업로드' 옵션을 통해 데이터를 추가해보세요.
                  </div>
                </div>
              </td>
            </tr>
          ) : (
            listData.map(item => (
              <DataRow 
                key={item.id}
                item={item}
                columns={columns}
                currentIds={currentIds}
                isSelected={selectedIds.has(item.id)}
                isHovered={hoveredId === item.id}
                onRowMouseEnter={handleRowMouseEnter}
                onRowMouseLeave={handleRowMouseLeave}
                onRowMouseDown={handleRowMouseDown}
                onRowDoubleClick={handleRowDoubleClick}
                editingCell={editingCell?.id === item.id ? editingCell : null}
                editValue={editValue}
                setEditValue={setEditValue}
                submitInlineEdit={submitInlineEdit}
                handleKeyDown={handleKeyDown}
                onRowEdit={handleRowEdit}
                onRowDelete={handleRowDelete}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

const DataRow = memo(({ 
  item, columns, currentIds, isSelected, isHovered, 
  onRowMouseEnter, onRowMouseLeave, onRowMouseDown, 
  onRowDoubleClick, onRowEdit, onRowDelete,
  editingCell, editValue, setEditValue, submitInlineEdit, handleKeyDown
}) => {
  return (
    <tr 
      onMouseEnter={() => onRowMouseEnter(item.id, currentIds)}
      onMouseLeave={onRowMouseLeave}
      style={{ 
        borderBottom: '1px solid var(--border-color)', 
        background: isSelected ? 'rgba(57, 158, 116, 0.03)' : 'transparent', 
        transition: 'background 0.2s',
        userSelect: 'none'
      }}
    >
      <td 
        style={{ padding: '12px 16px', cursor: 'pointer' }}
        onMouseDown={(e) => onRowMouseDown(item.id, isSelected, e)}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {isSelected ? <CheckSquare size={18} color="var(--accent-color)" /> : <Square size={18} color="var(--text-muted)" />}
        </div>
      </td>
      {columns.map(col => {
        const isEditing = editingCell?.key === col.key;
        return (
          <td 
            key={col.key} 
            style={{ padding: '12px 16px', fontSize: 14 }}
            onDoubleClick={() => {
              if (!col.render || col.canInlineEdit) {
                onRowDoubleClick(item.id, col.key, item[col.key] || '');
              }
            }}
          >
            {isEditing ? (
              col.key === 'schedule' ? (
                <textarea
                  autoFocus
                  className="styled-input"
                  style={{ 
                    padding: '8px', fontSize: 13, minHeight: 60, width: '100%', 
                    margin: 0, resize: 'vertical', fontFamily: 'inherit' 
                  }}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={submitInlineEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submitInlineEdit();
                    } else if (e.key === 'Escape') {
                      onRowDoubleClick(null, null, ''); // Close
                    }
                  }}
                />
              ) : (
                <input
                  autoFocus
                  type="text"
                  className="styled-input"
                  style={{ padding: '4px 8px', fontSize: 13, height: 28, margin: 0, width: '100%' }}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={submitInlineEdit}
                  onKeyDown={handleKeyDown}
                />
              )
            ) : (
              col.render ? col.render(item) : (item[col.key] || '-')
            )}
          </td>
        );
      })}
      <td style={{ padding: '12px 16px', textAlign: 'right', minWidth: 80 }}>
        <div style={{ 
          display: 'flex', gap: 4, justifyContent: 'flex-end',
          opacity: (isHovered || isSelected) ? 1 : 0,
          transition: 'opacity 0.15s ease'
        }}>
          <button 
            onClick={() => onRowEdit(item)} 
            className="btn-icon" 
            style={{ padding: 6, background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            data-tooltip="편집"
          >
            <Pencil size={16} />
          </button>
          <button 
            onClick={() => onRowDelete(item.id)} 
            className="btn-icon" 
            style={{ padding: 6, color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer' }}
            data-tooltip="삭제"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
});

const StudentManifestModal = ({ cls, onClose, onManage, data }) => {
  const classStudents = useMemo(() => {
    const ids = cls.studentIds || [];
    return ids.map(id => data.students?.find(s => s.id === id)).filter(Boolean);
  }, [cls.studentIds, data.students]);

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div style={{ background: 'var(--bg-surface)', width: '90%', maxWidth: 500, borderRadius: 20, padding: 32, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{cls.className} 수강생 명단</h3>
          <button className="btn-icon" onClick={onClose}><Plus size={20} style={{ transform: 'rotate(45deg)' }} /></button>
        </div>
        
        <div style={{ maxHeight: 400, overflowY: 'auto', marginBottom: 24, paddingRight: 8 }}>
          {classStudents.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {classStudents.map(s => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-surface-hover)', borderRadius: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.school || '학교 미기재'} {s.grade || '학년 미기재'}</div>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{s.contact || '연락처 없음'}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              <Users size={48} style={{ opacity: 0.1, marginBottom: 16 }} />
              <p>수강 중인 학생이 없습니다.</p>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn-secondary" style={{ flex: 1, height: 48 }} onClick={onClose}>닫기</button>
          <button 
            className="btn-primary" 
            style={{ flex: 1, height: 48 }} 
            onClick={onManage}
          >수강생 관리 (편집)</button>
        </div>
      </div>
    </div>
  );
};
