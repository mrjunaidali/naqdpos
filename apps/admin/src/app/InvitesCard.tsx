import { OWNER_JOINED_MESSAGE, type AdminCatalogue } from '@naqdpos/core';
import { useState } from 'react';
import { api } from '../api/index.ts';
import { useFailure, when } from './adminContext.ts';
import { InviteMessage } from './InviteMessage.tsx';
import { Alert, Button, Card, Field } from './ui.tsx';

const STATUS_STYLE = {
  pending: 'bg-warning-soft text-warning-fg',
  accepted: 'bg-bg text-text',
  expired: 'bg-bg text-muted',
  revoked: 'bg-bg text-muted',
} as const;

/** US012: the owner invites of a shop: status, resend the WhatsApp text, revoke, invite again. */
export function InvitesCard({
  shopId,
  shopName,
  catalogue,
  reload,
}: {
  shopId: string;
  shopName: string;
  catalogue: AdminCatalogue;
  reload: () => void;
}) {
  const fail = useFailure();
  const [showing, setShowing] = useState<string>();
  const [email, setEmail] = useState(catalogue.invites[0]?.email ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  /** The invite just created, and whether the API emailed it. */
  const [created, setCreated] = useState<{ id: string; emailed: boolean | undefined }>();
  const owner = catalogue.staff.find((s) => s.role === 'owner');
  const pending = catalogue.invites.some((i) => i.status === 'pending');

  async function run(action: () => Promise<unknown>, fallback: string) {
    // owner_joined: the owner already linked; a second owner is not supported yet.
    setBusy(true);
    setError(undefined);
    try {
      await action();
      reload();
    } catch (e) {
      setError(fail(e, fallback, { owner_joined: OWNER_JOINED_MESSAGE }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Owner invites">
      {error && <Alert>{error}</Alert>}
      {catalogue.invites.length === 0 && <p className="text-sm text-muted">No invites.</p>}
      <ul className="divide-y divide-border text-sm">
        {catalogue.invites.map((i) => (
          <li key={i.id} className="space-y-2 py-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex-1">{i.email}</span>
              <span className={`rounded-full px-2 ${STATUS_STYLE[i.status]}`}>{i.status}</span>
              <span className="text-muted">
                {i.status === 'accepted'
                  ? `accepted ${when(i.accepted_at)}`
                  : `expires ${when(i.expires_at)}`}
              </span>
              {i.status === 'pending' && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setShowing(showing === i.id ? undefined : i.id)}
                  >
                    Resend message
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void run(() => api.adminRevokeInvite(i.id), 'Could not revoke.')}
                  >
                    Revoke
                  </Button>
                </>
              )}
            </div>
            {showing === i.id && (
              <InviteMessage
                shopName={shopName}
                email={i.email}
                mobile={owner?.phone ?? null}
                emailed={created?.id === i.id ? created.emailed : undefined}
              />
            )}
          </li>
        ))}
      </ul>
      {!pending && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = email.trim().toLowerCase();
            if (!value) return;
            void run(async () => {
              const r = await api.adminCreateInvite(shopId, value);
              setCreated({ id: r.id, emailed: r.emailed });
              setShowing(r.id);
            }, 'Could not create the invite.');
          }}
        >
          <div className="flex-1">
            <Field
              label="Invite owner email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy || !email.trim()}>
            New invite
          </Button>
        </form>
      )}
    </Card>
  );
}
