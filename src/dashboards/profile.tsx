import { useState, type FormEvent } from "react";
import { api, ApiError, type User } from "../app/api";
import { useAuth } from "../app/auth";
import { Field, FormAlert, usePageTitle } from "../pages/Field";
import { PageHeader, Section } from "../ui/ui";

const ROLE_LABEL: Record<User["role"], string> = { driver: "Driver", parking_owner: "Parking owner" };

export function Profile({ user }: { user: User }) {
  usePageTitle("Profile and settings");
  const { refresh } = useAuth();
  const [fullName, setFullName] = useState(user.fullName);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [errors, setErrors] = useState<{ fullName?: string; phone?: string }>({});
  const [formError, setFormError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = {
      fullName: fullName.trim().length < 2 ? "Enter your full name" : undefined,
      phone: phone.trim() && !/^\+?[0-9 ()-]{7,20}$/.test(phone.trim()) ? "Enter a valid phone number" : undefined,
    };
    setErrors(found);
    setFormError(undefined);
    setSaved(false);
    if (found.fullName || found.phone) return;
    setBusy(true);
    try {
      await api("/users/me", { method: "PATCH", body: { fullName: fullName.trim(), phone: phone.trim() || null } });
      await refresh();
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.details.length) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      } else {
        setFormError(err instanceof ApiError ? err.message : "Couldn't save your profile.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Profile and settings" eyebrow="Account" />
      <div className="two-col">
        <Section title="Profile">
          <form onSubmit={submit} noValidate aria-busy={busy} className="form-grid">
            {formError && (
              <div className="span-all">
                <FormAlert>{formError}</FormAlert>
              </div>
            )}
            <div className="span-all">
              <Field label="Full name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} error={errors.fullName} />
            </div>
            <div className="span-all">
              <Field
                label="Phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                error={errors.phone}
                hint="Optional."
              />
            </div>
            <div className="span-all form-actions">
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Saving…" : "Save profile"}
              </button>
              {saved && (
                <span className="form-success" role="status">
                  Saved.
                </span>
              )}
            </div>
          </form>
        </Section>
        <Section title="Account">
          <dl className="facts">
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Verification</dt>
            <dd>
              {user.emailVerified ? (
                "Verified"
              ) : (
                <span className="muted-text">Not verified. Email delivery isn't set up yet, so verification isn't available.</span>
              )}
            </dd>
            <dt>Account type</dt>
            <dd>{ROLE_LABEL[user.role]}</dd>
            <dt>Society admin</dt>
            <dd>
              {user.administeredSocietyIds.length
                ? `${user.administeredSocietyIds.length} ${user.administeredSocietyIds.length === 1 ? "society" : "societies"}`
                : "None"}
            </dd>
            <dt>Member since</dt>
            <dd>{new Date(user.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}</dd>
          </dl>
          <p className="muted-text">
            Changing your email or password, and account type changes, aren't available yet.
          </p>
        </Section>
      </div>
    </>
  );
}
