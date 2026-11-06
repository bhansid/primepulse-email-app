# PrimePulse Patient Email Panel

Netlify app: staff log in, pick a nurse, pick patients (live from CharmHealth),
write a message, attach files, and send. Emails go out from the Google Workspace
account via the Gmail API (they also appear in that mailbox's Sent folder).

## Environment variables (Netlify → Site configuration → Environment variables)

| Variable | Example / notes |
|---|---|
| `PANEL_PASSWORD` | Staff login password |
| `SESSION_SECRET` | Any long random string (40+ characters) |
| `NURSES` | `Priya Sharma \| priya@primepulse.com ; Anjali Verma \| anjali@primepulse.com` |
| `CHARM_BASE` | `https://ehr2.charmtracker.com/api/ehr/v1` (your account's API base) |
| `CHARM_API_KEY` | CharmHealth practice api_key |
| `CHARM_CLIENT_ID` | CharmHealth/Zoho OAuth client ID |
| `CHARM_CLIENT_SECRET` | CharmHealth/Zoho OAuth client secret |
| `CHARM_REFRESH_TOKEN` | CharmHealth/Zoho refresh token |
| `CHARM_TOKEN_URL` | optional, default `https://accounts.charmtracker.com/oauth/v2/token` |
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Refresh token for admin@primepulse.com with scope `https://www.googleapis.com/auth/gmail.send` |
| `SENDER_EMAIL` | `admin@primepulse.com` |
| `SENDER_NAME` | `PrimePulse Care Team` |

After changing variables, redeploy (Deploys → Trigger deploy).

## Health check
Log in, then open `/api/me?health` — both `charm` and `google` should say `"ok"`.

## Logs
Netlify → Logs → Functions → `send` shows each sent/failed email (nurse + patient ID).

## Patient search
Uses CharmHealth filters `first_name_startswith` / `last_name_startswith`
(`netlify/lib/core.mjs`, `SEARCH_FILTERS`). If search returns nothing while the
health check is OK, adjust those names to your account's API.

## Limits
- Attachments: 4 MB total per email (Netlify function request limit).
- One function call per patient, so large selections don't time out.
