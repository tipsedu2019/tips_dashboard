import BottomSheet from '../BottomSheet';

export default function DashboardFilterSheet({
  title,
  subtitle = '',
  open,
  onClose,
  onReset = null,
  onApply = null,
  children,
  maxWidth = 640,
  testId = '',
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      maxWidth={maxWidth}
      testId={testId}
      actions={
        onReset || onApply ? (
          <div className="dashboard-filter-sheet__actions">
            {onReset ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={onReset}
              >
                초기화
              </button>
            ) : null}
            {onApply ? (
              <button
                type="button"
                className="btn-primary"
                onClick={onApply}
              >
                적용
              </button>
            ) : null}
          </div>
        ) : null
      }
    >
      <div className="dashboard-filter-sheet__body">{children}</div>
    </BottomSheet>
  );
}
