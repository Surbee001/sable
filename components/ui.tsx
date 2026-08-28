'use client'

import type { Icon } from '@phosphor-icons/react'
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
  group,
}: {
  options: Array<{ value: T; label: string; title?: string; Icon?: Icon }>
  value: T
  onChange: (v: T) => void
  /** Anchor each option's tooltip to the row, so none of them can be clipped. */
  group?: boolean
}) {
  return (
    <div className={`seg${group ? ' tip-group' : ''}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-tip={group ? o.title : undefined}
          title={group ? undefined : o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`seg-item${value === o.value ? ' seg-item--on' : ''}`}
        >
          {o.Icon ? <o.Icon size={13} weight="bold" /> : null}
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
