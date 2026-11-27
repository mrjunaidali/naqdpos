# Emails

The API sends three emails, each in English or Urdu, each with a plain-text part and an HTML part.
The wording lives in text files, so it can be changed without touching code.

## Where the templates are

`apps/api/emails/`:

| File | What it is |
| --- | --- |
| `<email>.<lang>.txt` | First line `Subject: …`, then an empty line, then the plain-text body |
| `<email>.<lang>.html` | The HTML body: a few `<p>` paragraphs with inline styles, ending with the "You received this because…" footer |
| `layout.<lang>.html` | The frame around every HTML body: the NaqdPOS name at the top, white card, page language and direction |

`<lang>` is `en` or `ur`. The files hold only text and placeholders, with no logic.

## The emails and their placeholders

| Email | When | Language | Placeholders |
| --- | --- | --- | --- |
| `sign-in-code` | Someone asks for a sign-in code (POS app or admin portal) | The app language sent with the request (`X-App-Language`); English if none | `{{code}}`, `{{expiresInMinutes}}` |
| `pin-reset-code` | An owner taps "Forgot PIN?" | The app language sent with the request; English if none | `{{code}}`, `{{expiresInMinutes}}` |
| `invite` | An admin creates a shop or a new owner invite | The language the admin picks in the portal ("Invite email language"), default English | `{{shopName}}`, `{{inviteLink}}`, `{{email}}` |

The layout has two placeholders: `{{subject}}` (the page title) and `{{content}}` (where the HTML body goes).

Rules, checked by the API when it starts (and by the tests):

- Every text body and every HTML body must contain **all** placeholders of its email. The subject may use some, all or none.
- Only the placeholders listed above are allowed; a misspelt one (`{{shopname}}`) is an error.
- English and Urdu must use the same placeholders in each part (subject, text, HTML).
- When an email is sent, every placeholder must get a value; an email is never sent with `{{code}}` in it.

A broken file stops the API from starting, with a message naming the file and the problem, so a mistake shows up in the tests and the deploy log, never in a customer's inbox.

Values are HTML-escaped in the HTML part (a shop called `Ali & Sons <Fruit>` shows as typed) and go in as typed in the text part.

## Writing HTML that works in email apps

- **Inline styles only** (`style="…"` on each tag). Gmail, Outlook and iPhone Mail strip `<style>` blocks and external CSS. No classes, scripts or images (the tests refuse `<style>`, `<link>`, `<script>`, `<img>` and `class=`).
- **Urdu**: the layout sets `lang="ur" dir="rtl"`, right alignment and an Urdu font stack. Give new Urdu paragraphs `dir="rtl"` and `text-align: right` like the existing ones.
- **Left-to-right inside Urdu**: wrap codes, email addresses, links and Rs amounts in `dir="ltr"`, e.g. `<strong dir="ltr">{{code}}</strong>`. Otherwise the digits and punctuation can be reordered.
- Colours come from `docs/design-theme.md` (zinc greys); keep to the ones already used.

## Previewing

```
pnpm email:preview <sign-in-code|pin-reset-code|invite> <en|ur>
```

The command renders the email with sample values into `.email-preview/` at the repo root (gitignored). It writes `<email>.<lang>.html` and `<email>.<lang>.txt`, the text file starting with the subject. It prints both paths and a `file://` link to open in the browser. A broken template fails here with the same message as at API start.

## Changing the wording

1. Edit the text in `apps/api/emails/`. Change English and Urdu together if the meaning changes.
2. `pnpm email:preview <email> <lang>` and look at it in the browser.
3. Run the tests: `pnpm --filter @naqdpos/api test`. `templates.test.ts` renders every email in every language. Its "wording" tests also compare each subject and text word for word, so when you change the wording on purpose, update those expected sentences in the test too.
4. Commit. The new wording goes out with the next API deploy (the Dockerfile copies `apps/api/emails`).

The invite's **WhatsApp text** in the admin portal is separate: it comes from `inviteMessage` in `packages/core/src/productImport.ts` (the portal runs in the browser and can't read API files). Change it there if the invite wording changes.
