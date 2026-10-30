import { useState, type FormEvent } from "react";
import { api, ApiError } from "../app/api";
import { formatPlace } from "../app/format";
import { Link } from "../app/router";
import type { Society, SocietySpaceSummary } from "../app/types";
import { useApi } from "../app/useApi";
import { Field, FormAlert, usePageTitle } from "../pages/Field";
import { AccessDenied, Async, EmptyState, PageHeader, RecordList, Section, StatusBadge, SummaryCard } from "../ui/ui";

// Everything here is scoped to the societies this account is explicitly
// assigned to; the API returns 403 for any other society.

export function SocietyHome() {
  usePageTitle("Societies");
  const societies = useApi<Society[]>("/me/societies");
  return (
    <>
      <PageHeader eyebrow="Society administration" title="Your societies." />
      <Async remote={societies}>
        {(list) =>
          list.length ? (
            <>
              <div className="summary-grid">
                <SummaryCard label="Assigned societies" value={list.length} />
              </div>
              <Section title="Assigned to you">
                <RecordList
                  rows={list}
                  caption="Societies you administer"
                  columns={[
                    { header: "Society", primary: true, cell: (s) => <Link href={`/app/society/${s.id}`}>{s.name}</Link> },
                    { header: "Location", cell: (s) => formatPlace(s.address) },
                    { header: "Access rules", cell: (s) => (Object.keys(s.accessRules).length ? "Configured" : "Not set") },
                  ]}
                />
              </Section>
            </>
          ) : (
            <Section title="Assigned to you">
              <EmptyState
                title="No societies assigned"
                body="Society administrator access is assigned by the SpotSure team for a specific society."
              />
            </Section>
          )
        }
      </Async>
    </>
  );
}

function AccessRulesForm({ society, onSaved }: { society: Society; onSaved: () => void }) {
  const r = society.accessRules;
  const [visitorHours, setVisitorHours] = useState(r.visitorHours ?? "");
  const [guard, setGuard] = useState(Boolean(r.requiresGuardApproval));
  const [residentsOnly, setResidentsOnly] = useState(Boolean(r.residentsOnly));
  const [notes, setNotes] = useState(r.notes ?? "");
  const [error, setError] = useState<string>();
  const [fieldError, setFieldError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setFieldError(undefined);
    setSaved(false);
    if (visitorHours && !/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(visitorHours)) {
      setFieldError("Use HH:MM-HH:MM, e.g. 08:00-22:00");
      return;
    }
    const accessRules: Society["accessRules"] = { requiresGuardApproval: guard, residentsOnly };
    if (visitorHours) accessRules.visitorHours = visitorHours;
    if (notes.trim()) accessRules.notes = notes.trim();
    setBusy(true);
    try {
      await api(`/societies/${society.id}`, { method: "PATCH", body: { accessRules } });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save access rules.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-busy={busy} className="form-grid">
      {error && (
        <div className="span-all">
          <FormAlert>{error}</FormAlert>
        </div>
      )}
      <Field
        label="Visitor hours"
        value={visitorHours}
        onChange={(e) => {
          setSaved(false);
          setVisitorHours(e.target.value);
        }}
        placeholder="08:00-22:00"
        hint="Leave blank for no restriction."
        error={fieldError}
      />
      <div className="span-all">
        <label className="check">
          <input type="checkbox" checked={guard} onChange={(e) => setGuard(e.target.checked)} />
          Visitors need guard approval
        </label>
        <label className="check">
          <input type="checkbox" checked={residentsOnly} onChange={(e) => setResidentsOnly(e.target.checked)} />
          Residents only
        </label>
      </div>
      <div className="span-all field">
        <label className="field__label" htmlFor="society-notes">
          Notes for drivers
        </label>
        <textarea id="society-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      </div>
      <div className="span-all form-actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save access rules"}
        </button>
        {saved && (
          <span className="form-success" role="status">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}

export function SocietyDetail({ id, homeHref }: { id: string; homeHref: string }) {
  usePageTitle("Society");
  const society = useApi<Society>(`/societies/${id}`);
  const spaces = useApi<SocietySpaceSummary[]>(society.status === "ready" ? `/societies/${id}/parking-spaces` : null);
  const crumbs = [{ href: "/app/society", label: "Societies" }];

  if (society.status === "error" && society.error.status === 403) {
    return (
      <>
        <PageHeader title="Access denied" breadcrumbs={crumbs} />
        <AccessDenied message="You're not an administrator of this society." homeHref={homeHref} />
      </>
    );
  }
  if (society.status === "error" && society.error.status === 404) {
    return (
      <>
        <PageHeader title="Society not found" breadcrumbs={crumbs} />
        <EmptyState title="We couldn't find this society" body="It may have been removed." />
      </>
    );
  }

  return (
    <>
      <PageHeader title={society.status === "ready" ? society.data.name : "Society"} breadcrumbs={crumbs} />
      <Async remote={society}>
        {(s) => (
          <>
            <div className="two-col">
              <Section title="About">
                <dl className="facts">
                  <dt>Name</dt>
                  <dd>{s.name}</dd>
                  <dt>Location</dt>
                  <dd>{formatPlace(s.address)}</dd>
                </dl>
              </Section>
              <Section title="Parking in this society">
                <Async remote={spaces}>
                  {(rows) =>
                    rows.length ? (
                      <RecordList
                        rows={rows}
                        caption="Parking listings in this society"
                        columns={[
                          { header: "Listing", primary: true, cell: (r) => r.name },
                          { header: "Bays", cell: (r) => r.bayCount },
                          { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
                        ]}
                      />
                    ) : (
                      <EmptyState title="No listings linked" body="No parking listings are linked to this society yet." />
                    )
                  }
                </Async>
              </Section>
            </div>
            <Section title="Access rules">
              <AccessRulesForm society={s} onSaved={society.reload} />
            </Section>
          </>
        )}
      </Async>
    </>
  );
}
