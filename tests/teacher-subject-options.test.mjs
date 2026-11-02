import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
import { subjectCatalog } from './helpers/teacher-subject-fixtures.mjs';
const { teacherSubjectNames } = loadNotificationComponent('src/features/teacher-requests/teacher-subject-options.ts');

test('subject teacher union preserves multi-subject aliases and class-only teachers, removes unrelated/hidden catalog names', () => {
 const before=structuredClone(subjectCatalog);
 assert.deepEqual(teacherSubjectNames(subjectCatalog,' 수학 과목 ',['가상 수학 교사',' 가상 수학 교사 ','가상 카탈로그 외 교사']),['가상 복수 교사','가상 수학 교사','가상 카탈로그 외 교사']);
 assert.deepEqual(teacherSubjectNames(subjectCatalog,'과학',[]),['가상 과학 교사']);
 assert.deepEqual(teacherSubjectNames(subjectCatalog,'영어',[]),['가상 교사','가상 복수 교사']);
 assert.deepEqual(subjectCatalog,before);assert.deepEqual(teacherSubjectNames(subjectCatalog,'',[]),[]);
 assert.deepEqual(teacherSubjectNames({teachers:[{name:'가상 결합 교사',subjects:['영어/수학'],isVisible:true}]},'수학',[]),['가상 결합 교사']);
});
test('missing, malformed or oversized teacher metadata fails instead of reverting to global teacher names', () => {
 for(const value of [null,{}, {teachers:null},{teachers:[{name:'가상',subjects:'수학',isVisible:true}]},{teachers:[{name:'가상',subjects:['수학'],isVisible:null}]},{teachers:Array(201).fill(subjectCatalog.teachers[0])}]) assert.throws(()=>teacherSubjectNames(value,'수학',[]),/teacher_subject_catalog_invalid/);
});
