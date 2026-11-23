import { inviteMessage, whatsAppLink } from '@naqdpos/core';
import { useState } from 'react';
import { posUrl } from './labels.ts';
import { Button } from './ui.tsx';

/**
 * The owner invite to send by WhatsApp (no email provider yet, US012): copyable text and a
 * wa.me button for the owner's mobile. The owner signs in with this email; no link or token.
 */
export function InviteMessage({
  shopName,
  email,
  mobile,
}: {
  shopName: string;
  email: string;
  mobile: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const url = posUrl();
  const text = inviteMessage(shopName, url || '<shop app address>', email);
  return (
    <div className="space-y-2 rounded-xl border border-border bg-bg p-3">
      {!url && (
        <p role="alert" className="text-sm text-danger">
          VITE_POS_URL is not set, so the message has no app address. Set it in the admin build
          settings.
        </p>
      )}
      <p className="text-sm text-muted">Send this to the owner:</p>
      <p data-testid="invite-text" className="whitespace-pre-wrap">
        {text}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(text)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? 'Copied' : 'Copy message'}
        </Button>
        {mobile && (
          <a
            href={whatsAppLink(mobile, text)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-semibold text-primary-fg"
          >
            Open WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}
