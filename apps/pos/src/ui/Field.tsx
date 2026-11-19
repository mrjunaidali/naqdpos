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
        className={`min-h-12 w-full rounded-md border px-3 text-lg ${
          error ? 'border-red-600' : 'border-gray-300'
        } ${className ?? ''}`}
        {...input}
      />
      {error ? (
        <p id={messageId} className="text-sm text-red-700">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-sm text-gray-600">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
