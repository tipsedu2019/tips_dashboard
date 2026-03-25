import { formatKoreanDate, getProgressTone } from "./classScheduleWorkspaceUtils.js";

export default function ClassScheduleTableView({
  items = [],
  selectedKey = "",
  onSelectRow,
  onPlanClick,
  onActualClick,
}) {
  if (!items.length) {
    return <div className="class-schedule-empty-state">표시할 표 데이터가 없습니다.</div>;
  }

  return (
    <div className="class-schedule-table">
      <table>
        <thead>
          <tr>
            {["반", "학기", "과목", "선생님", "일자", "교재", "계획", "실제", "계획 대비", "동기화"].map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const tone = getProgressTone(item.actualStatus);
            return (
              <tr
                key={item.key}
                data-testid={`class-schedule-table-row-${item.key}`}
                className={selectedKey === item.key ? "is-selected" : ""}
                onClick={() => onSelectRow(item)}
              >
                <td>
                  <div className="class-schedule-table__identity">
                    <strong>{item.className}</strong>
                    <span>{item.grade || "-"}</span>
                  </div>
                </td>
                <td>{item.termName || "-"}</td>
                <td>{item.subject || "-"}</td>
                <td>{item.teacher || "-"}</td>
                <td>{formatKoreanDate(item.date)}</td>
                <td>{item.textbookTitle || "-"}</td>
                <td>
                  <button
                    type="button"
                    className="class-schedule-table__action class-schedule-table__action--plan"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPlanClick(item.row);
                    }}
                  >
                    {item.plannedRange || "계획 없음"}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="class-schedule-table__action"
                    style={{
                      "--action-bg": tone.bg,
                      "--action-text": tone.text,
                      "--action-border": tone.border,
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onActualClick(item.row, item.session, item.entry);
                    }}
                  >
                    {item.actualRange || "실진도 입력"}
                  </button>
                </td>
                <td>{item.progressWarning?.message || "-"}</td>
                <td>{item.syncWarning?.message || "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
