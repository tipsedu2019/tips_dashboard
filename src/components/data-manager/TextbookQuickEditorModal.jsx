import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { TextField } from '../ui/tds';
import { createId } from './utils';

const DEFAULT_TAG_SUGGESTIONS = ['영어', '수학', '국어', '중등', '고등', '내신', '독해'];

function normalizeLesson(lesson, index) {
  if (lesson && typeof lesson === 'object') {
    return {
      id: lesson.id || `lesson-${index + 1}`,
      title: String(lesson.title || '').trim(),
    };
  }

  return {
    id: `lesson-${index + 1}`,
    title: String(lesson || '').trim(),
  };
}

function normalizeTextbook(textbook = {}) {
  const source = textbook || {};
  return {
    ...source,
    id: source.id || createId(),
    title: source.title || '',
    publisher: source.publisher || '',
    price: Number(source.price || 0),
    tags: Array.isArray(source.tags) ? source.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [],
    lessons: Array.isArray(source.lessons) ? source.lessons.map((lesson, index) => normalizeLesson(lesson, index)) : [],
  };
}

export default function TextbookQuickEditorModal({
  open,
  textbook,
  onSave,
  onClose,
  isSaving = false,
}) {
  const [edited, setEdited] = useState(() => normalizeTextbook(textbook));
  const [newTag, setNewTag] = useState('');
  const [lessonTitle, setLessonTitle] = useState('');
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setEdited(normalizeTextbook(textbook));
    setNewTag('');
    setLessonTitle('');
    setErrors({});
    setIsSubmitting(false);
  }, [open, textbook]);

  const isEditMode = useMemo(() => Boolean(textbook?.title || textbook?.publisher || textbook?.tags?.length || textbook?.lessons?.length), [textbook]);

  if (!open) {
    return null;
  }

  const addTag = (tagValue) => {
    const tag = String(tagValue || '').trim();
    if (!tag) {
      return;
    }

    setEdited((current) => ({
      ...current,
      tags: current.tags.includes(tag) ? current.tags : [...current.tags, tag],
    }));
    setNewTag('');
  };

  const addLesson = () => {
    const title = String(lessonTitle || '').trim();
    if (!title) {
      return;
    }

    setEdited((current) => ({
      ...current,
      lessons: [...current.lessons, { id: createId(), title }],
    }));
    setLessonTitle('');
  };

  const handleSave = async () => {
    const nextErrors = {};
    if (!edited.title.trim()) {
      nextErrors.title = '교재명을 입력해 주세요.';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await onSave?.({
        ...edited,
        title: edited.title.trim(),
        publisher: edited.publisher.trim(),
        tags: edited.tags,
        lessons: edited.lessons.filter((lesson) => String(lesson.title || '').trim()),
      });

      if (result?.ok) {
        onClose?.(result);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={() => onClose?.()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1705,
        background: 'rgba(15, 23, 42, 0.48)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        className="workspace-surface"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(1040px, 100%)',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: 24,
          display: 'grid',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="view-header-eyebrow">교재 연결</div>
            <h3 style={{ margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: '-0.04em' }}>
              {isEditMode ? '교재 수정' : '새 교재 등록'}
            </h3>
            <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              수업 계획 흐름을 끊지 않고 바로 교재를 만들거나 수정할 수 있습니다. 저장하면 현재 수업에도
              즉시 연결할 수 있습니다.
            </p>
          </div>

          <button type="button" className="action-chip" onClick={() => onClose?.()}>
            <X size={16} />
            닫기
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 0.95fr) minmax(320px, 1.05fr)', gap: 20 }}>
          <div className="card-custom" style={{ padding: 20, display: 'grid', gap: 16 }}>
            <h4 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>기본 정보</h4>

            <TextField
              label="교재명"
              value={edited.title}
              placeholder="예: 중3 내신 집중 수학"
              onChangeText={(value) => setEdited((current) => ({ ...current, title: value }))}
              hasError={Boolean(errors.title)}
              help={errors.title || null}
            />

            <TextField
              label="출판사"
              value={edited.publisher}
              placeholder="출판사 입력"
              onChangeText={(value) => setEdited((current) => ({ ...current, publisher: value }))}
            />

            <TextField
              label="판매 금액"
              value={String(edited.price || 0)}
              inputMode="numeric"
              placeholder="0"
              onChangeText={(value) =>
                setEdited((current) => ({
                  ...current,
                  price: Number(String(value || '').replace(/[^0-9.-]/g, '')) || 0,
                }))
              }
            />

            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>태그</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(edited.tags || []).map((tag) => (
                  <span
                    key={tag}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 12px',
                      borderRadius: 999,
                      background: 'rgba(37, 99, 235, 0.1)',
                      color: '#1d4ed8',
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() =>
                        setEdited((current) => ({
                          ...current,
                          tags: current.tags.filter((item) => item !== tag),
                        }))
                      }
                      style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <TextField
                  label="새 태그"
                  value={newTag}
                  placeholder="예: 중등"
                  onChangeText={setNewTag}
                />
                <button type="button" className="action-chip" onClick={() => addTag(newTag)} style={{ alignSelf: 'end' }}>
                  <Plus size={14} />
                  추가
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {DEFAULT_TAG_SUGGESTIONS.map((tag) => (
                  <button key={tag} type="button" className="action-chip" onClick={() => addTag(tag)}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="card-custom" style={{ padding: 20, display: 'grid', gap: 16 }}>
            <div>
              <h4 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>차시 계획</h4>
              <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                교재 목차를 미리 입력해 두면 수업 계획과 수업진도 입력에서 바로 선택 기준으로 활용할 수 있습니다.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <TextField
                label="차시 또는 목차 제목"
                value={lessonTitle}
                placeholder="예: 1단원 함수의 기본"
                onChangeText={setLessonTitle}
              />
              <button type="button" className="action-chip" onClick={addLesson} style={{ alignSelf: 'end' }}>
                <Plus size={14} />
                추가
              </button>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              {(edited.lessons || []).length > 0 ? (
                edited.lessons.map((lesson, index) => (
                  <div
                    key={lesson.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '44px minmax(0, 1fr) 44px',
                      gap: 12,
                      alignItems: 'center',
                      padding: '14px 16px',
                      borderRadius: 18,
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-surface)',
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'var(--bg-surface-hover)',
                        color: 'var(--text-secondary)',
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      {index + 1}
                    </div>
                    <TextField
                      label=""
                      value={lesson.title}
                      placeholder="차시 제목"
                      onChangeText={(value) =>
                        setEdited((current) => ({
                          ...current,
                          lessons: current.lessons.map((item) =>
                            item.id === lesson.id ? { ...item, title: value } : item
                          ),
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label="차시 삭제"
                      onClick={() =>
                        setEdited((current) => ({
                          ...current,
                          lessons: current.lessons.filter((item) => item.id !== lesson.id),
                        }))
                      }
                      style={{ color: '#ef4444', justifySelf: 'end' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              ) : (
                <div
                  style={{
                    padding: 18,
                    borderRadius: 18,
                    background: 'var(--bg-surface-hover)',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.7,
                  }}
                >
                  아직 등록된 차시가 없습니다. 필요할 때만 간단히 넣어도 됩니다.
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="action-chip" onClick={() => onClose?.()} disabled={isSaving || isSubmitting}>
            취소
          </button>
          <button type="button" className="action-pill" onClick={handleSave} disabled={isSaving || isSubmitting}>
            {isSaving || isSubmitting ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
