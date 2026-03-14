import { useState } from 'react';
import { Lock, LogIn, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function LoginModal({ onClose }) {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleLogin = async (event) => {
    event.preventDefault();
    setError('');

    try {
      const normalizedId = userId.includes('@') ? userId : `${userId}@tips.com`;
      await login(normalizedId, password);
      onClose();
    } catch (loginError) {
      console.error('Login error:', loginError);
      setError(loginError.message || '아이디 또는 비밀번호가 올바르지 않습니다.');
      setPassword('');
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        className="card"
        onClick={(event) => event.stopPropagation()}
        style={{ width: '100%', maxWidth: 400, margin: 0 }}
      >
        <div className="card-header" style={{ paddingBottom: 16 }}>
          <h2 style={{ fontSize: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lock size={22} className="text-accent" /> 직원 로그인
          </h2>
          <button className="theme-toggle" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="card-body">
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
              marginBottom: 24,
              lineHeight: 1.5,
            }}
          >
            부원장, 선생님, 관리자 계정으로 로그인해 주세요.
          </p>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>
                아이디
              </label>
              <input
                type="text"
                className="styled-date-input"
                placeholder="아이디 또는 이메일"
                value={userId}
                onChange={(event) => {
                  setUserId(event.target.value);
                  setError('');
                }}
                autoFocus
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>
                비밀번호
              </label>
              <input
                type="password"
                className="styled-date-input"
                placeholder="비밀번호"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError('');
                }}
              />
              {error && (
                <div style={{ color: '#e11d48', fontSize: 12, marginTop: 6, fontWeight: 500 }}>
                  {error}
                </div>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={!userId || !password}
              style={{
                width: '100%',
                justifyContent: 'center',
                opacity: !userId || !password ? 0.6 : 1,
              }}
            >
              <LogIn size={18} /> 로그인
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
