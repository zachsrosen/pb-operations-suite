# PB Operations Suite - Setup Guide

## Quick Start (Local Development)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` and add your HubSpot access token:
   ```
   HUBSPOT_ACCESS_TOKEN=pat-na1-xxxx-xxxx-xxxx
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```

4. **Open the dashboards:**
   - API: http://localhost:3000/api/projects?stats=true
   - Static dashboards: http://localhost:3000/dashboards/pb-dashboard-hub.html

---

## Deploy to Vercel

### Option 1: Vercel CLI

1. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Deploy:**
   ```bash
   vercel
   ```

3. **Add environment variables in Vercel dashboard:**
   - `HUBSPOT_ACCESS_TOKEN` - Your HubSpot Private App token
   - `HUBSPOT_PORTAL_ID` - Your HubSpot portal ID (default: 21710069)
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - Google OAuth credentials
   - `NEXTAUTH_SECRET` - Random secret for auth/JWT signing
   - `NEXTAUTH_URL` - Your production app URL
   - `ALLOWED_EMAIL_DOMAIN` - Allowed Google Workspace domain(s)
   - `DEPLOYMENT_WEBHOOK_SECRET` - Secret required by `/api/deployment` in production
   - `API_SECRET_TOKEN` - (Optional) Token for external API access
   - `SITE_PASSWORD` - (Optional) Legacy password gate

### Option 2: GitHub Integration

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Import the repository
4. Add environment variables during setup
5. Deploy

---

## API Endpoints

### GET /api/projects

Fetch projects from HubSpot with filtering options.

**Query Parameters:**
| Parameter | Description | Default |
|-----------|-------------|---------|
| `context` | Filter preset: `scheduling`, `equipment`, `pe`, `executive`, `at-risk`, `all` | - |
| `location` | Filter by PB location | - |
| `stage` | Filter by stage name | - |
| `active` | Include only active projects | `true` |
| `stats` | Include aggregate statistics | `false` |
| `refresh` | Bypass cache | `false` |

**Examples:**
```bash
# All active projects with stats
curl "http://localhost:3000/api/projects?stats=true"

# Participate Energy projects only
curl "http://localhost:3000/api/projects?context=pe&stats=true"

# Projects ready for scheduling
curl "http://localhost:3000/api/projects?context=scheduling"

# At-risk projects
curl "http://localhost:3000/api/projects?context=at-risk"

# Filter by location
curl "http://localhost:3000/api/projects?location=San%20Luis%20Obispo"

# Force fresh data
curl "http://localhost:3000/api/projects?refresh=true"
```

### GET /api/stats

Get aggregate statistics only.

```bash
curl "http://localhost:3000/api/stats"
```

---

## Data Contexts

The API supports pre-configured filters for different dashboard needs:

| Context | Description | Stages Included |
|---------|-------------|-----------------|
| `scheduling` | Projects needing scheduling | Ready To Build, RTB-Blocked, Construction |
| `equipment` | Projects with equipment data | All active with system size > 0 |
| `pe` | Participate Energy projects | All PE-tagged active projects |
| `executive` | Executive overview | All active projects |
| `at-risk` | Overdue or blocked projects | Blocked, stale, or past forecast dates |
| `all` | No filtering | Everything |

---

## HubSpot Configuration

### Required Scopes

Your HubSpot Private App needs these scopes:
- `crm.objects.deals.read`
- `crm.objects.line_items.read`
- `crm.schemas.deals.read`

### Pipeline

This integration is configured for the **Project Pipeline** (ID: `6900017`).

### Key Properties Used

| Category | Properties |
|----------|------------|
| **Dates** | `closedate`, `permit_submit_date`, `permit_completion_date`, `install_schedule_date`, `construction_complete_date`, `inspections_schedule_date`, `inspections_completion_date`, `pto_start_date`, `pto_completion_date` |
| **Location** | `pb_location`, `ahj`, `utility_company`, `address_line_1`, `city`, `state`, `postal_code` |
| **Equipment** | `module_brand`, `module_model`, `module_count`, `inverter_brand`, `inverter_model`, `battery_brand`, `battery_count`, `calculated_system_size__kwdc_` |
| **Tags** | `tags` (includes "Participate Energy"), `participate_energy_status` |
| **Planning** | `days_for_installers`, `days_for_electricians`, `install_crew`, `install_difficulty` |

---

## Security

### Password Protection

Set `SITE_PASSWORD` environment variable to enable password protection. Users will be prompted to enter the password before accessing any dashboard.

### API Authentication

For external API access, set `API_SECRET_TOKEN` and include it in requests:
```bash
curl -H "Authorization: Bearer your-token" "https://your-app.vercel.app/api/projects"
```

### Production Hardening Checklist

- Set `NEXTAUTH_SECRET` and `NEXTAUTH_URL` in all environments.
- Set `DEPLOYMENT_WEBHOOK_SECRET` in production before enabling deployment webhooks.
- Keep `DEBUG_API_ENABLED` unset or `false` in production.
- Keep `ENABLE_ADMIN_ROLE_RECOVERY` unset or `false` in production.
- Optionally set `AUTH_TOKEN_SECRET` and `AUTH_SALT` for stricter auth-token separation.
- In production, startup auth config validates critical env vars and will fail fast if required values are missing.

---

## Migrating Dashboards to Live Data

The static HTML dashboards in `/dashboards/` currently use embedded JSON data. To connect them to the live API:

1. Replace the `<script id="project-data">` section with:
   ```javascript
   async function loadProjects() {
     const response = await fetch('/api/projects?context=scheduling&stats=true');
     const data = await response.json();
     return data.projects;
   }
   ```

2. Update the initialization code to call `loadProjects()` instead of reading from the embedded JSON.

---

## Troubleshooting

### "Unauthorized" errors
- Check that `HUBSPOT_ACCESS_TOKEN` is set correctly
- Verify the token hasn't expired
- Ensure the Private App has the required scopes

### Empty results
- Confirm deals exist in the Project Pipeline
- Check that deals have the expected stage IDs
- Try `?active=false` to include all deals

### Stale data
- Use `?refresh=true` to bypass the 5-minute cache
- Check the `lastUpdated` field in the response

---

## Development

### Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── projects/route.ts   # Main projects endpoint
│   │   │   ├── stats/route.ts      # Stats endpoint
│   │   │   └── auth/login/route.ts # Auth endpoint
│   │   └── login/page.tsx          # Login page
│   ├── lib/
│   │   └── hubspot.ts              # HubSpot integration
│   └── middleware.ts               # Auth middleware
├── dashboards/                     # Static HTML dashboards
├── .env.local                      # Local environment
└── vercel.json                     # Vercel configuration
```

### Testing

```bash
# Start dev server
npm run dev

# Test API
curl "http://localhost:3000/api/projects?stats=true"

# Test specific context
curl "http://localhost:3000/api/projects?context=pe"
```
