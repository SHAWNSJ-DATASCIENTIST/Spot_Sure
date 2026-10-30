import { useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../app/api";
import { useAuth } from "../app/auth";
import { Link, navigate, safeNext, useLocation } from "../app/router";
import { emailError } from "../app/validation";
import { AuthLayout } from "./AuthLayout";
import { Field, FormAlert, PasswordField, usePageTitle } from "./Field";

// Why the user landed here, from ?reason=. Shown as a polite status, not an error.
const NOTICES: Record<string, string> = {
  required: "Sign in to continue.",
  expired: "Your session has ended. Sign in again to continue.",
  "signed-out": "You've been signed out.",
};

export function SignIn() {
  usePageTitle("Sign in");
  const { state, signIn } = useAuth();
  const { search } = useLocation();
  const next = safeNext(search.get("next"));
  const notice = NOTICES[search.get("reason") ?? ""];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (state.status === "signed-in") navigate(next, { replace: true });
  }, [state.status, next]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = { email: emailError(email), password: password ? undefined : "Enter your password" };
    setErrors(found);
    setFormError(undefined);
    if (found.email || found.password) {
      document.getElementById(found.email ? "signin-email" : "signin-password")?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await signIn(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setPassword("");
      setFormError(
        err instanceof ApiError
          ? err.status === 429
            ? "Too many attempts. Wait a few minutes and try again."
            : err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Sign in"
      title={
        <>
          Welcome <span className="accent">back.</span>
        </>
      }
      lede="Sign in to manage your bookings, your parking spaces or the societies you look after."
      footer={
        <>
          New to SpotSure? <Link href={`/register${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>
        </>
      }
    >
      <form className="auth__form" onSubmit={onSubmit} noValidate aria-busy={submitting}>
        {formError ? (
          <FormAlert>{formError}</FormAlert>
        ) : (
          notice && (
            <p className="form-notice" role="status">
              {notice}
            </p>
          )
        )}
        <Field
          id="signin-email"
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          required
        />
        <PasswordField
          id="signin-password"
          label="Password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          required
        />
        <button type="submit" className="auth__submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthLayout>
  );
}
