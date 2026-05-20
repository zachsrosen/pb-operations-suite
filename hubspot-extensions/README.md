# PB Tech Ops — HubSpot UI Extensions

Native HubSpot CRM cards that surface PB Tech Ops Suite data directly inside HubSpot records.

## Current extensions

### Tesla PowerHub card

Renders on **Deal**, **Ticket**, and **Property** records. Shows:
- Live battery SoC + instant power flows (solar / battery / grid / load)
- Battery mode (Self-Powered / Backup / etc.)
- Hardware serials (gateway, Powerwall, inverter, meter)
- Active alerts ranked by severity + age
- One-click buttons: **Open in PB Tech Ops**, **Open Tesla Portal**

Data source: `POST https://pbtechops.com/api/hubspot-card/powerhub`
Auth: HubSpot signs requests with HMAC-SHA256; backend validates `X-HubSpot-Signature-V3` against `HUBSPOT_APP_SECRET`.

## First-time setup (run once per portal)

These are the manual steps you do to deploy the extension to HubSpot. Code is already written — these are HubSpot account/CLI bootstrap.

### 1. Install HubSpot CLI

```bash
npx --yes @hubspot/cli@latest --version
```

Confirms CLI version. (`npx` avoids the global install.)

### 2. Authenticate against the PB portal

From `hubspot-extensions/`:

```bash
cd hubspot-extensions
npx hs init
```

- Pick **"personal access key"** when prompted
- Opens browser → log into HubSpot, copy the access key
- Paste back into the terminal
- Confirm portal name + accountId — you'll see `21710069`

This writes `hubspot.config.yml` in this directory (gitignored — never commit).

### 3. Upload the project

```bash
npx hs project upload
```

First run creates the developer project in your portal + uploads the card. Wait ~30-60 sec for build.

### 4. Install the app on the portal

After upload, HubSpot shows a URL to install the project's private app into the portal. Click it, accept scopes, confirm.

### 5. Add the `HUBSPOT_APP_SECRET` env var to Vercel

The card backend (`/api/hubspot-card/powerhub`) needs the app's client secret to verify signed requests.

In HubSpot: Settings → Account Setup → Private Apps → PB Tech Ops → Auth tab. Copy the **Client Secret**.

```bash
vercel env add HUBSPOT_APP_SECRET production
# paste the secret, no trailing newline
```

For local dev, append to `.env`:
```
HUBSPOT_APP_SECRET="..."
# Optional: bypass signature verify in local dev
# HUBSPOT_CARD_SKIP_SIG_VERIFY=true
```

### 6. Verify

Open any HubSpot deal record that's linked to a Property with a Tesla PowerHub site (e.g. Brotherton PROJ-4776 = deal `13307792040`). The Tesla PowerHub card should appear in the sidebar.

If it shows "No Tesla PowerHub site linked", that's the card's "empty state" — the record has no linked PowerHub data, which is expected for non-Tesla customers.

## Project structure

```
hubspot-extensions/
├── hsproject.json              # Project manifest (platformVersion, srcDir)
├── README.md                    # This file
├── .gitignore                   # Excludes hubspot.config.yml + node_modules
└── src/app/
    ├── app-hsmeta.json         # Private app definition (scopes, extensions list)
    └── extensions/
        └── powerhub-card/
            ├── powerhub-card-hsmeta.json  # Card manifest (which records to show on)
            ├── package.json               # @hubspot/ui-extensions + React
            └── PowerhubCard.tsx           # The React component
```

## Iterating

Edit `PowerhubCard.tsx` or any other file, then:
```bash
npx hs project upload
```
Re-deploys + HubSpot picks up the change on next record load (no manual install step needed for subsequent uploads).

For live local dev with auto-reload:
```bash
npx hs project dev
```
Opens a local dev server; changes apply instantly when you reload the HubSpot record.

## Adding more cards

1. Create a new folder under `src/app/extensions/`
2. Add `<name>-hsmeta.json` and `<name>.tsx`
3. Reference the manifest from `src/app/app-hsmeta.json`'s `extensions.crm.cards` array
4. Build a corresponding backend endpoint at `src/app/api/hubspot-card/<name>/route.ts` (and add it to `PUBLIC_API_ROUTES` in `src/middleware.ts`)
5. `npx hs project upload`

## Operational notes

- **HubSpot polls the card on every record open.** Backend response time matters. Current endpoint p50 should be < 200ms (single DB query, no external API calls).
- **Signature verification has a 5-minute timestamp window.** If clocks drift between HubSpot and Vercel, set up NTP if needed (Vercel handles this automatically).
- **HubSpot caches the JS bundle.** Major UI changes may take a hard refresh of the record page to pick up.
- **Object type IDs** in `powerhub-card-hsmeta.json` (`2-60847123` for the custom Property object) are portal-specific. The Deal (`0-3`) and Ticket (`0-5`) IDs are universal.
