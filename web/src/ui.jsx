import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { short, statusClass, explorerUrl, overcreditInfo } from './util.js';

// Small accessible popover. Opens on hover or keyboard focus; click/tap pins it open.
// Escape, an outside click or moving focus away closes it. It is shifted horizontally
// so it always stays inside the viewport.
export function InfoTip({ label, trigger, triggerClassName = '', children }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [left, setLeft] = useState(0);
  const wrap = useRef(null);
  const pop = useRef(null);
  const id = useId();

  const close = () => {
    setOpen(false);
    setPinned(false);
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      if (!wrap.current || !pop.current) return;
      const margin = 12;
      const vw = document.documentElement.clientWidth;
      const width = pop.current.offsetWidth;
      const anchor = wrap.current.getBoundingClientRect();
      // Prefer right-aligning with the trigger, then clamp into the viewport.
      const x = Math.max(margin, Math.min(anchor.right - width, vw - margin - width));
      setLeft(x - anchor.left);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    const onDown = (e) => !wrap.current?.contains(e.target) && close();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <span className="tip" ref={wrap} onMouseEnter={() => setOpen(true)} onMouseLeave={() => !pinned && setOpen(false)}>
      <button
        type="button"
        className={`tip-trigger ${triggerClassName}`}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => {
          const next = !(open && pinned);
          setOpen(next);
          setPinned(next);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => !wrap.current?.contains(e.relatedTarget) && close()}
      >
        {trigger}
      </button>
      {open && (
        <span id={id} role="tooltip" className="tip-pop" ref={pop} style={{ left }}>
          {children}
        </span>
      )}
    </span>
  );
}

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="#123222" stroke="#2b5a40" />
      <path d="M16 5c5 4 7 8 7 12a7 7 0 0 1-14 0c0-4 2-8 7-12z" fill="#3ddc84" />
      <path d="M16 12v15" stroke="#123222" strokeWidth="2" />
    </svg>
  );
}

export function StatusChip({ status, small = false }) {
  return (
    <span className={`chip ${statusClass(status)}${small ? ' chip-sm' : ''}`}>
      <span className="chip-dot" aria-hidden="true" />
      {status || 'Unverified'}
    </span>
  );
}

const OVERCREDIT_CAVEAT = 'This is a warning for further investigation, not proof of fraud.';

// `interactive` renders an explanation popover; leave it off inside other buttons.
export function OvercreditedFlag({ small = false, project = null, interactive = false }) {
  const cls = `chip chip-flag${small ? ' chip-sm' : ''}`;
  const info = overcreditInfo(project);
  if (!interactive || !info) {
    const title = info
      ? `${info.text} ${OVERCREDIT_CAVEAT}`
      : 'Claimed threat looks overstated compared with the reference area. An indicator for review, not proof of fraud.';
    return <span className={cls} title={title}>⚑ Overcredited?</span>;
  }
  return (
    <InfoTip
      label="Overcredited? Why this project is flagged"
      triggerClassName={cls}
      trigger={<span aria-hidden="true">⚑ Overcredited?</span>}
    >
      <strong className="tip-title tip-title-flag">Possible overstated threat</strong>
      <span>Claimed deforestation threat: <b>{info.claimedText}</b>.</span>
      <span>Observed reference-area loss: <b>{info.observedText}</b>.</span>
      <span>This discrepancy flags a potentially overstated threat and requires further verification.</span>
      <span className="tip-foot">
        {OVERCREDIT_CAVEAT} The flag is raised when the claimed threat is more than twice the observed reference-area rate.
      </span>
    </InfoTip>
  );
}

export function Hash({ value, chainId, kind = 'tx', head = 8, tail = 6 }) {
  if (!value) return <span className="mono muted">—</span>;
  const url = explorerUrl(chainId, kind, value);
  const text = short(value, head, tail);
  return url ? (
    <a className="mono hash" href={url} target="_blank" rel="noreferrer" title={value}>{text}</a>
  ) : (
    <span className="mono hash" title={value}>{text}</span>
  );
}

export function Card({ title, kicker, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || kicker || actions) && (
        <header className="card-head">
          <div>
            {kicker && <div className="kicker">{kicker}</div>}
            {title && <h2>{title}</h2>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
