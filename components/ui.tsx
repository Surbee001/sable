'use client'

import type { ReactNode } from 'react'

export function Section({
  title,
  action,
  children,
  className = '',
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      <header className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="label">{title}</h2>
        {action}
      </header>
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
  format = (v: number) => v.toFixed(2),
}: {
  label: string
  value: number
  onChange: (v: number) => void
  hint?: string
  min?: number
  max?: number
  step?: number
  format?: (v: number) => string
}) {
  return (
    <label className="block select-none">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-ink-200">{label}</span>
        <span className="font-mono text-[10px] tabular-nums text-ink-400">
          {format(value)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="sable-range w-full"
      />
      {hint ? <span className="mt-1 block text-[10px] leading-tight text-ink-500">{hint}</span> : null}
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
    <div className="flex gap-0.5 rounded-[5px] bg-ink-900 p-0.5 ring-1 ring-ink-800">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-[3px] px-2 py-1 text-[11px] font-medium transition-colors ${
            value === o.value
              ? 'bg-ink-700 text-ink-50'
              : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
          }`}
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
  tone = 'default',
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  tone?: 'default' | 'ghost'
  className?: string
}) {
  const tones = {
    default:
      'bg-ink-800 text-ink-100 ring-1 ring-ink-700 hover:bg-ink-700 hover:text-ink-50',
    ghost: 'text-ink-400 hover:bg-ink-800 hover:text-ink-100',
  }
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-[4px] px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  )
}
