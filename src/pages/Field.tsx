import { useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
// Field styles live with the auth pages; reused by in-app forms.
import "./auth.css";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
}

/** Labelled input with an error message wired up through aria-describedby. */
export function Field({ label, error, hint, id, ...input }: FieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={`field ${error ? "field--invalid" : ""}`}>
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        {...input}
      />
      {hint && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field__error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Password input with an accessible show/hide toggle. */
export function PasswordField({ label, error, hint, id, ...input }: FieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={`field ${error ? "field--invalid" : ""}`}>
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="field__control">
        <input
          id={inputId}
          className="field__input"
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          spellCheck={false}
          autoCapitalize="off"
          {...input}
        />
        <button
          type="button"
          className="field__toggle"
          aria-controls={inputId}
          aria-pressed={visible}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {hint && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field__error">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div className="form-alert" role="alert">
      {children}
    </div>
  );
}

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · SpotSure`;
  }, [title]);
}
