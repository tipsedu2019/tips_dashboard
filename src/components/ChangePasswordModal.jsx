import { useState } from "react";
import { KeyRound } from "lucide-react";

import { useAuth } from "../contexts/AuthContext";

function validateNextPassword(password, confirmation) {
  if (!String(password || "").trim()) {
    return "새 비밀번호를 입력해 주세요.";
  }
  if (String(password).length < 8) {
    return "비밀번호는 8자 이상으로 입력해 주세요.";
  }
  if (password !== confirmation) {
    return "비밀번호 확인이 일치하지 않습니다.";
  }
  return "";
}

export default function ChangePasswordModal({ open = false }) {
  const { changePassword, user } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  if (!open) {
    return null;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();

    const validationMessage = validateNextPassword(password, confirmation);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      await changePassword(password);
      setPassword("");
      setConfirmation("");
    } catch (saveError) {
      setError(
        saveError?.message || "비밀번호 변경에 실패했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.58)",
        zIndex: 120,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 440, margin: 0 }}>
        <div className="card-header" style={{ paddingBottom: 16 }}>
          <h2
            style={{
              fontSize: 20,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <KeyRound size={22} className="text-accent" />
            초기 비밀번호 변경
          </h2>
        </div>

        <div className="card-body">
          <p
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              marginBottom: 20,
              lineHeight: 1.6,
            }}
          >
            {user?.name || user?.email || "계정"} 님은 처음 로그인한 상태입니다.
            계속 사용하려면 비밀번호를 먼저 변경해 주세요.
          </p>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  display: "block",
                  marginBottom: 8,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                새 비밀번호
              </label>
              <input
                type="password"
                className="styled-date-input"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError("");
                }}
                placeholder="새 비밀번호"
                autoFocus
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label
                style={{
                  display: "block",
                  marginBottom: 8,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                새 비밀번호 확인
              </label>
              <input
                type="password"
                className="styled-date-input"
                value={confirmation}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  setError("");
                }}
                placeholder="새 비밀번호 확인"
              />
              {error ? (
                <div
                  style={{
                    color: "#e11d48",
                    fontSize: 12,
                    marginTop: 6,
                    fontWeight: 500,
                  }}
                >
                  {error}
                </div>
              ) : null}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSaving || !password || !confirmation}
              style={{
                width: "100%",
                justifyContent: "center",
                opacity: isSaving || !password || !confirmation ? 0.6 : 1,
              }}
            >
              {isSaving ? "변경 중..." : "비밀번호 변경"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
