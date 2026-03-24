import { useState } from 'react';
import ClassSchedulePlanModal from './ClassSchedulePlanModal';
import { buildSchedulePlanForSave } from '../lib/classSchedulePlanner';

export default function ProgressEntryModal({ cls, data, dataService, onClose }) {
  const [draftPlan, setDraftPlan] = useState(cls.schedulePlan || cls.schedule_plan || null);

  return (
    <ClassSchedulePlanModal
      open={true}
      editable
      mode="checklist"
      classItem={{
        ...cls,
        className: cls.className || cls.name || '',
        subject: cls.subject || '',
        teacher: cls.teacher || '',
        classroom: cls.classroom || cls.room || '',
        schedule: cls.schedule || '',
        capacity: cls.capacity || 0,
      }}
      plan={draftPlan}
      textbooksCatalog={data?.textbooks || []}
      onSaveDraft={async ({ classPatch, schedulePlan }) => {
        const mergedClass = {
          ...cls,
          subject: classPatch.subject,
          className: classPatch.className,
          textbookIds: classPatch.textbookIds,
        };
        const savedPlan = buildSchedulePlanForSave(schedulePlan, mergedClass);
        setDraftPlan(savedPlan);
        if (dataService?.updateClass) {
          await dataService.updateClass(cls.id, {
            ...mergedClass,
            schedulePlan: savedPlan,
          });
        }
      }}
      onClose={onClose}
    />
  );
}
