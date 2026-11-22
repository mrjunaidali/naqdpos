import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

/** Admin UI pieces (theme tokens only, 44px targets), like apps/pos/src/ui. */
export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-primary text-primary-fg',
    secondary: 'border border-border bg-surface text-text',
    danger: 'bg-danger text-surface',
  }[variant];
  return (
    <button
      type={type}
      className={`min-h-11 rounded-md px-4 font-semibold disabled:opacity-50 ${styles} ${className ?? ''}`}
      {...props}
    />
  );
}

export function Field({
  label,
  error,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | undefined }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        className={`min-h-11 w-full rounded-md border bg-surface px-3 ${error ? 'border-danger' : 'border-border'}`}
        {...input}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-danger bg-danger/10 px-3 py-2 text-danger">
      {children}
    </p>
  );
}
