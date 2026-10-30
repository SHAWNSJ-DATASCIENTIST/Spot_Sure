import { useEffect, useState, type FormEvent } from "react";
import { ApiError, type User } from "../app/api";
import { useAuth } from "../app/auth";
import { Link, navigate, safeNext, useLocation } from "../app/router";
import { emailError, fullNameError, passwordError, PASSWORD_MIN } from "../app/validation";
import { AuthLayout } from "./AuthLayout";
import { Field, FormAlert, PasswordField, usePageTitle } from "./Field";

type Errors = Partial<Record<"fullName" | "email" | "password" | "passwordConfirmation", string>>;

const ROLES: { value: User["role"]; title: string; body: string }[] = [
  { value: "driver", title: "I need parking", body: "Find spaces and manage your own bookings." },
  { value: "parking_owner", title: "I have parking to list", body: "List and manage the spaces you own." },
];

export function Register() {
  usePageTitle("Create an account");
  const { state, register } = useAuth();
  const { search } = useLocation();
  const next = safeNext(search.get("next"));
  const [form, setForm] = useState({ fullName: "", email: "", password: "", passwordConfirmation: "" });
  // ?role=parking_owner preselects the owner option (owner onboarding links);
  // only a UI default, the server still allow-lists self-service roles.
  const [role, setRole] = useState<User["role"]>(search.get("role") === "parking_owner" ? "parking_owner" : "driver");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (state.status === "signed-in" && !submitting) navigate(next, { replace: true });
  }, [state.status, next, submitting]);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function validate(): Errors {
    return {
      fullName: fullNameError(form.fullName),
      email: emailError(form.email),
      password: passwordError(form.password, form.email),
      passwordConfirmation: !form.passwordConfirmation
        ? "Confirm your password"
        : form.passwordConfirmation !== form.password
          ? "Passwords do not match"
          : undefined,
    };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    setFormError(undefined);
    const firstInvalid = (Object.keys(found) as (keyof Errors)[]).find((k) => found[k]);
    if (firstInvalid) {
      document.getElementById(`register-${firstInvalid}`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await register({ ...form, role });
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.details.length) {
        // Server-side validation is authoritative; show its messages on the fields.
        const server: Errors = {};
        for (const d of err.details) if (d.path in form) server[d.path as keyof Errors] ??= d.message;
        setErrors(server);
        setFormError("Please fix the highlighted fields.");
      } else if (err instanceof ApiError && err.status === 429) {
        setFormError("Too many attempts. Wait a few minutes and try again.");
      } else {
        setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Create an account"
      title={
        <>
          Park with <span className="accent">certainty.</span>
        </>
      }
      lede="One account for finding parking or listing your own. Society administrator access is granted separately by the SpotSure team."
      footer={
        <>
          Already have an account? <Link href={`/sign-in${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link>
        </>
      }
    >
      <form className="auth__form" onSubmit={onSubmit} noValidate aria-busy={submitting}>
        {formError && <FormAlert>{formError}</FormAlert>}
        <fieldset className="roles">
          <legend className="field__label">Account type</legend>
          <div className="roles__grid">
            {ROLES.map((r) => (
              <label key={r.value} className={`roles__option ${role === r.value ? "is-selected" : ""}`}>
                <input
                  type="radio"
                  name="role"
                  value={r.value}
                  checked={role === r.value}
                  onChange={() => setRole(r.value)}
                />
                <span className="roles__title">{r.title}</span>
                <span className="roles__body">{r.body}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          id="register-fullName"
          label="Full name"
          name="name"
          autoComplete="name"
          value={form.fullName}
          onChange={set("fullName")}
          error={errors.fullName}
          required
        />
        <Field
          id="register-email"
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={form.email}
          onChange={set("email")}
          error={errors.email}
          required
        />
        <PasswordField
          id="register-password"
          label="Password"
          name="new-password"
          autoComplete="new-password"
          value={form.password}
          onChange={set("password")}
          error={errors.password}
          hint={`At least ${PASSWORD_MIN} characters. A few unrelated words works well.`}
          required
        />
        <PasswordField
          id="register-passwordConfirmation"
          label="Confirm password"
          name="confirm-password"
          autoComplete="new-password"
          value={form.passwordConfirmation}
          onChange={set("passwordConfirmation")}
          error={errors.passwordConfirmation}
          required
        />
        <button type="submit" className="auth__submit" disabled={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </button>
        <p className="fine auth__note">
          Email verification isn't available yet, so your address will show as unverified for now.
        </p>
      </form>
    </AuthLayout>
  );
}
