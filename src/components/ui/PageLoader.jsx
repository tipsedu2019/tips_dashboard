export default function PageLoader({ title = '대시보드를 불러오는 중입니다', message = '최신 데이터를 준비하고 있습니다.' }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'linear-gradient(180deg, var(--bg-base), var(--bg-surface))'
      }}
    >
      <div
        className="card-custom"
        style={{
          width: '100%',
          maxWidth: 420,
          padding: 32,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          textAlign: 'center'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
          <span className="loader-dot" />
          <span className="loader-dot" />
          <span className="loader-dot" />
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
            {message}
          </div>
        </div>
      </div>
    </div>
  );
}
