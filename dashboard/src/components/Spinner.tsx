export default function Spinner({ size = 32 }: { size?: number }) {
  return (
    <div
      style={{
        width: size, height: size,
        border: `3px solid #e5e7eb`,
        borderTop: `3px solid #1d4ed8`,
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
        margin: '0 auto',
      }}
    />
  )
}
