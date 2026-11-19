import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'link';

const STYLES: Record<Variant, string> = {
  primary: 'w-full bg-green-700 text-white font-semibold hover:bg-green-800 disabled:bg-gray-400',
  secondary: 'w-full border border-gray-300 bg-white font-semibold hover:bg-gray-50',
  link: 'px-2 text-green-800 underline',
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
        tone === 'error' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'
      }`}
    >
      {children}
    </p>
  );
}
