import { useEffect, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';

export default function HelpTooltip({
  content,
  label = '도움말',
  maxWidth = 240,
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <span
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          width: 18,
          height: 18,
          padding: 0,
          borderRadius: 999,
          border: '1px solid rgba(33, 110, 78, 0.16)',
          background: 'rgba(33, 110, 78, 0.08)',
          color: 'var(--accent-color)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'help',
          flexShrink: 0,
        }}
      >
        <CircleHelp size={12} />
      </button>

      {open ? (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            zIndex: 30,
            width: `min(${maxWidth}px, calc(100vw - 48px))`,
            padding: '10px 12px',
            borderRadius: 14,
            border: '1px solid rgba(33, 110, 78, 0.12)',
            background: 'rgba(17, 24, 39, 0.94)',
            color: '#f8fafc',
            boxShadow: '0 18px 34px rgba(15, 23, 42, 0.24)',
            fontSize: 12,
            lineHeight: 1.55,
            fontWeight: 500,
            pointerEvents: 'none',
          }}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
