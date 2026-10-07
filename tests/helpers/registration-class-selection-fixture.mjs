// Synthetic-only fixture transform for the local browser runner. No production identities.
export function withRegistrationClassSelectionFixture(state) {
  const template = state.optionData.classes.find((item) => item.subject === '영어');
  const ids = ['a', 'b', 'c', 'inactive', 'expired', 'future'];
  state.optionData.textbooks = ids.map(id => ({ id: `selection-book-${id}`, label: `합성 교재 ${id}`, subject: '영어', publisher: '합성', status: id === 'inactive' ? 'inactive' : 'active' }));
  const classes = [
    { id: '20000000-0000-4000-8000-000000000010', label: '영어 10반', grade: '중1' },
    { id: '20000000-0000-4000-8000-000000000012', label: '영어 2반', grade: '중1, 중2' },
    { id: '20000000-0000-4000-8000-000000000013', label: '고등 심화반', grade: '고3' },
    { id: '20000000-0000-4000-8000-000000000014', label: '학년 공통반', grade: '' },
  ].map(item => ({ ...template, ...item, textbookIds: ids.map(id => `selection-book-${id}`), textbookUsage: { 'selection-book-expired': { endDate: '2000-01-01' }, 'selection-book-future': { startDate: '2099-01-01' } } }));
  state.optionData.classes = classes;
  state.classDetails = Object.fromEntries(classes.map(item => [item.id, item]));
  const detail = state.caseDetails['fixture-task-enrollment-decided'];
  detail.tracks[0].enrollmentDetailRows = [];
  detail.enrollments = [];
  // Give the same real application both a blank observation form and enrollment form.
  const manager = Object.values(state.observation.managerDetails)[0];
  detail.task.id = manager.track.taskId;
  Object.assign(detail.tracks[0], { id: manager.track.trackId, taskId: manager.track.taskId, workflowRevision: manager.track.workflowRevision });
  detail.task.registrationTracks = detail.tracks;
  state.caseDetails[detail.task.id] = detail;
  state.workspaceData.tasks = [detail.task, ...state.workspaceData.tasks.filter(item => item.id !== 'fixture-task-enrollment-decided')];
  manager.track.workflowStatus = 'observation_requested';
  manager.currentObservation = null; manager.attempts = [];
  manager.classes = classes.map(item => ({ id: item.id, name: item.label, subject: '영어' }));
  state.observation.runtimeVersion = 1;
  state.observation.schemaReadiness.runtimeVersion = 1;
  state.observation.managerDetails = { [detail.tracks[0].id]: manager };
  detail.tracks[0].observationSummaryVisible = true;
  detail.tracks[0].workflowStatus = 'enrollment_requested';
  return state;
}
