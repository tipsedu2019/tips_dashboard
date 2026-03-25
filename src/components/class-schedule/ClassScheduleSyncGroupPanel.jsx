function GroupCard({ group, active = false, onSelect }) {
  return (
    <button
      type="button"
      className={`class-schedule-sync-panel__group${active ? " is-active" : ""}`}
      onClick={() => onSelect(group.id)}
    >
      <div className="class-schedule-sync-panel__group-top">
        <div className="class-schedule-sync-panel__group-copy">
          <strong>{group.name}</strong>
          <span>
            {group.subject || "과목 미지정"} / {group.memberCount}개 반
          </span>
        </div>
        <div className="class-schedule-sync-panel__group-right">
          <span className="class-schedule-sync-panel__group-count">{group.memberCount}</span>
        </div>
      </div>

      <div className="class-schedule-sync-panel__group-tags">
        {(group.members || []).slice(0, 3).map((member) => (
          <span key={member.classId} className="class-schedule-sync-panel__class-pill">
            {member.className}
          </span>
        ))}
        {group.color ? (
          <span className="class-schedule-sync-panel__color-pill">{group.color}</span>
        ) : null}
      </div>

      {group.warningText ? (
        <div className="class-schedule-sync-panel__warning">
          {group.warningText}
        </div>
      ) : null}
    </button>
  );
}

function MemberItem({ item, checked, onToggle, onMoveUp, onMoveDown, disabled }) {
  return (
    <div className={`class-schedule-sync-panel__member${checked ? " is-selected" : ""}`}>
      <label className="class-schedule-sync-panel__member-main">
        <input type="checkbox" checked={checked} onChange={() => onToggle(item.classId)} />
        <div className="class-schedule-sync-panel__member-copy">
          <strong>{item.className}</strong>
          <span>
            {item.subject} / {item.teacher || "교사 미지정"}
          </span>
        </div>
      </label>
      <div className="class-schedule-sync-panel__member-actions">
        <button
          type="button"
          className="class-schedule-sync-panel__move-button"
          disabled={disabled}
          onClick={() => onMoveUp(item.classId)}
          aria-label={`${item.className} 위로 이동`}
        >
          위로
        </button>
        <button
          type="button"
          className="class-schedule-sync-panel__move-button"
          disabled={disabled}
          onClick={() => onMoveDown(item.classId)}
          aria-label={`${item.className} 아래로 이동`}
        >
          아래로
        </button>
      </div>
    </div>
  );
}

export default function ClassScheduleSyncGroupPanel({
  groups = [],
  selectedGroupId = "",
  onSelectGroup,
  configOpen = false,
  onCloseConfig,
  formState,
  classCandidates = [],
  onChangeForm,
  onToggleMember,
  onMoveMemberUp,
  onMoveMemberDown,
  onSave,
  onDelete,
  onCreate,
}) {
  return (
    <div className="class-schedule-sync-panel">
      <div className="class-schedule-sync-panel__header">
        <div className="class-schedule-sync-panel__header-copy">
          <strong>진도 동기화 그룹</strong>
          <span>같은 진도로 운영할 반을 묶고, 반별 불일치 경고를 한 곳에서 관리합니다.</span>
        </div>
        <button
          type="button"
          className="class-schedule-sync-panel__create-button"
          onClick={onCreate}
        >
          새 그룹
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="class-schedule-sync-panel__empty">
          <div className="class-schedule-sync-panel__empty-copy">
            <strong>아직 설정된 동기화 그룹이 없습니다.</strong>
            <span>같은 과목 반을 묶어 두면 회차 차이가 나는 순간 바로 경고를 볼 수 있습니다.</span>
          </div>
          <button
            type="button"
            className="class-schedule-sync-panel__empty-action"
            onClick={onCreate}
          >
            첫 그룹 만들기
          </button>
        </div>
      ) : (
        <div className="class-schedule-sync-panel__list">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              active={selectedGroupId === group.id}
              onSelect={onSelectGroup}
            />
          ))}
        </div>
      )}

      {configOpen ? (
        <div className="class-schedule-sync-panel__editor">
          <div className="class-schedule-sync-panel__editor-head">
            <div className="class-schedule-sync-panel__editor-copy">
              <strong>그룹 설정</strong>
              <span>같은 과목 반만 묶을 수 있으며, 순서는 경고 비교 기준으로 사용됩니다.</span>
            </div>
            <button
              type="button"
              className="class-schedule-sync-panel__ghost-button"
              onClick={onCloseConfig}
            >
              닫기
            </button>
          </div>

          <div className="class-schedule-sync-panel__editor-grid">
            <label className="class-schedule-sync-panel__field">
              <span>그룹명</span>
              <input
                value={formState.name}
                onChange={(event) => onChangeForm({ name: event.target.value })}
              />
            </label>
            <label className="class-schedule-sync-panel__field">
              <span>과목</span>
              <input
                value={formState.subject}
                onChange={(event) => onChangeForm({ subject: event.target.value })}
              />
            </label>
            <label className="class-schedule-sync-panel__field">
              <span>포인트 컬러</span>
              <input
                type="color"
                className="class-schedule-sync-panel__color-input"
                value={formState.color}
                onChange={(event) => onChangeForm({ color: event.target.value })}
              />
            </label>
          </div>

          <label className="class-schedule-sync-panel__field">
            <span>메모</span>
            <textarea
              rows={3}
              value={formState.note}
              onChange={(event) => onChangeForm({ note: event.target.value })}
            />
          </label>

          <div className="class-schedule-sync-panel__member-list">
            {classCandidates.map((item) => (
              <MemberItem
                key={item.classId}
                item={item}
                checked={formState.memberIds.includes(item.classId)}
                onToggle={onToggleMember}
                onMoveUp={onMoveMemberUp}
                onMoveDown={onMoveMemberDown}
                disabled={!formState.memberIds.includes(item.classId)}
              />
            ))}
          </div>

          <div className="class-schedule-sync-panel__footer">
            {formState.id ? (
              <button
                type="button"
                className="class-schedule-sync-panel__danger-button"
                onClick={() => onDelete(formState.id)}
              >
                삭제
              </button>
            ) : null}
            <button
              type="button"
              className="class-schedule-sync-panel__primary-button"
              onClick={onSave}
            >
              저장
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
