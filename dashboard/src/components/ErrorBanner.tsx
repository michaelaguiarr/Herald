export default function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div style={{
      background: '#fee2e2', color: '#991b1b', padding: '12px 16px',
      borderRadius: 8, fontSize: 14, display: 'flex',
      justifyContent: 'space-between', alignItems: 'center',
    }}>
      <span>⚠ {message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{ background: '#fca5a5', color: '#7f1d1d', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 13 }}
        >
          Tentar novamente
        </button>
      )}
    </div>
  )
}
