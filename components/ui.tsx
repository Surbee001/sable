'use client'

import type { ReactNode } from 'react'

export function Section({
  title,
  action,
  children,
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="section">
      {title || action ? (
        <header className="section-head">
          {title ? <h2 className="label">{title}</h2> : <span />}
          {action}
        </header>
      ) : null}
      {children}
    </section>
  )
}

export function Slider({
  label,
  value,
  onChange,
  hint,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  hint?: string
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label>
      <span className="field-head">
        <span className="field-name">{label}</span>
        <span className="field-value">{value.toFixed(2)}</span>
      </span>
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {hint ? <span className="note">{hint}</span> : null}
    </label>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; title?: string }>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`seg-item${value === o.value ? ' seg-item--on' : ''}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Button({
  children,
  onClick,
  disabled,
  title,
  solid,
  icon,
  ariaLabel,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  solid?: boolean
  icon?: boolean
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={`btn${solid ? ' btn--solid' : ''}${icon ? ' btn--icon' : ''}`}
    >
      {children}
    </button>
  )
}
