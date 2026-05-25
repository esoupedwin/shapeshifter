import { useEffect, useRef, useState, ReactNode } from 'react';

interface Props {
  label: string;
  disabled?: boolean;
  children: ReactNode;
}

export default function Dropdown({ label, disabled, children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="dropdown" ref={ref}>
      <button className="btn" disabled={disabled} onClick={() => setOpen((v) => !v)}>
        {label} ▾
      </button>
      {open && (
        <div className="dropdown-menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
