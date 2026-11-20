import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'link';

const STYLES: Record<Variant, string> = {
  primary: 'w-full bg-primary text-primary-fg font-semibold hover:opacity-90 disabled:opacity-50',
  secondary:
    'w-full border border-border bg-surface text-text font-semibold hover:bg-bg disabled:opacity-50',
  link: 'px-2 text-text underline',
};

/** Touch target at least 44px (CLAUDE.md UI rule). */
export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`min-h-12 min-w-11 rounded-md px-4 ${STYLES[variant]} ${className ?? ''}`}
      {...props}
    />
  );
}

/** Errors and notices, read out by screen readers when they appear. */
export function Alert({ children, tone = 'error' }: { children: string; tone?: 'error' | 'info' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-md px-3 py-2 ${
        tone === 'error' ? 'bg-danger-soft text-danger-fg' : 'bg-warning-soft text-warning-fg'
      }`}
    >
      {children}
    </p>
  );
}
