import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Shown under the input and announced; marks the input invalid. */
  error?: string | undefined;
  hint?: ReactNode;
}

/** Labelled input, 44px+ tall, with its error tied to it for screen readers. */
export function Field({ label, error, hint, className, ...input }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        className={`min-h-12 w-full rounded-md border bg-surface px-3 text-lg ${
          error ? 'border-danger' : 'border-border'
        } ${className ?? ''}`}
        {...input}
      />
      {error ? (
        <p id={messageId} className="text-sm text-danger-fg">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
