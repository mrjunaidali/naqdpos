// WhatsApp / share for a receipt (US036): to the customer's own WhatsApp when one is attached;
// otherwise the system share sheet; otherwise copy to the clipboard.
import { waLink } from '@naqdpos/core';

export type ShareOutcome = 'whatsapp' | 'shared' | 'copied' | 'failed';

export interface ShareEnv {
  open: (url: string) => void;
  share?: ((data: { text: string }) => Promise<void>) | undefined;
  copy?: ((text: string) => Promise<void>) | undefined;
}

export function browserShareEnv(): ShareEnv {
  return {
    open: (url) => {
      window.open(url, '_blank', 'noopener');
    },
    share: typeof navigator.share === 'function' ? (data) => navigator.share(data) : undefined,
    copy: navigator.clipboard?.writeText
      ? (text) => navigator.clipboard.writeText(text)
      : undefined,
  };
}

export async function shareReceipt(
  text: string,
  customerMobile: string | null,
  env: ShareEnv = browserShareEnv(),
): Promise<ShareOutcome> {
  if (customerMobile) {
    env.open(waLink(customerMobile, text));
    return 'whatsapp';
  }
  if (env.share) {
    try {
      await env.share({ text });
      return 'shared';
    } catch (error) {
      // The person closed the share sheet: nothing else to do.
      if (error instanceof DOMException && error.name === 'AbortError') return 'shared';
    }
  }
  if (env.copy) {
    try {
      await env.copy(text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  return 'failed';
}
