import { CLASS_STATUS_OPTIONS } from '../../lib/classStatus';

export default function BulkUpdateModal({
  open,
  selectedCount,
  activeTab,
  fieldOptions,
  field,
  value,
  onFieldChange,
  onValueChange,
  onClose,
  onApply,
  isProcessing,
  subjectOptions = [],
}) {
  if (!open) {
    return null;
  }

  const title = activeTab === 'classes' ? '수업 일괄 수정' : '교재 일괄 수정';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1500,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backdropFilter: 'blur(10px)',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="card-custom"
        style={{ width: '100%', maxWidth: 420, padding: 28 }}
      >
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{title}</h3>
        <p
          style={{
            margin: '8px 0 24px',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}
        >
          선택한 {selectedCount}개 항목에 같은 값을 적용합니다.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-muted)',
                marginBottom: 8,
              }}
            >
              수정할 항목
            </label>
            <select
              className="styled-input"
              value={field}
              onChange={(event) => onFieldChange(event.target.value)}
            >
              {fieldOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-muted)',
                marginBottom: 8,
              }}
            >
              적용할 값
            </label>

            {field === 'tags' ? (
              <>
                <input
                  type="text"
                  className="styled-input"
                  value={value}
                  onChange={(event) => onValueChange(event.target.value)}
                  placeholder="쉼표로 구분해 태그를 입력하세요"
                />
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                  예: 영어, 중등, 내신
                </div>
              </>
            ) : field === 'subject' ? (
              <select
                className="styled-input"
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
              >
                <option value="">과목을 선택하세요</option>
                {subjectOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field === 'status' ? (
              <select
                className="styled-input"
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
              >
                <option value="">상태를 선택하세요</option>
                {CLASS_STATUS_OPTIONS.map((statusOption) => (
                  <option key={statusOption} value={statusOption}>
                    {statusOption}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="styled-input"
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                placeholder="새 값을 입력하세요"
              />
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={isProcessing}
          >
            취소
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onApply}
            disabled={isProcessing}
          >
            일괄 적용
          </button>
        </div>
      </div>
    </div>
  );
}
