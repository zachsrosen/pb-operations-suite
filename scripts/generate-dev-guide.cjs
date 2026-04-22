/**
 * PB Tech Ops Suite — Developer Guide Generator
 *
 * Generates a comprehensive .docx developer guide covering:
 *   - System architecture & integrations
 *   - API endpoint reference (every route group)
 *   - Process walkthroughs (deal-to-SO, ticket lifecycle, etc.)
 *   - Data models, caching, auth, and conventions
 *
 * Usage: node scripts/generate-dev-guide.cjs
 * Output: docs/PB-Operations-Suite-Developer-Guide.docx
 */

const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak,
  TableOfContents,
} = require("/opt/homebrew/lib/node_modules/docx");

// ─── Constants ───────────────────────────────────────────────────────────────
const PAGE_WIDTH = 12240;   // US Letter
const PAGE_HEIGHT = 15840;
const MARGIN = 1440;        // 1 inch
const CONTENT_W = PAGE_WIDTH - 2 * MARGIN; // 9360

const COLORS = {
  primary: "1B4F72",
  accent: "E67E22",
  headerBg: "1B4F72",
  headerText: "FFFFFF",
  altRowBg: "F2F4F5",
  border: "BDC3C7",
  codeBg: "F7F9FA",
  lightBg: "EBF5FB",
};

const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: COLORS.border };
const borders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function heading(level, text) {
  return new Paragraph({ heading: level, children: [new TextRun(text)] });
}

function para(text, opts = {}) {
  const runs = typeof text === "string"
    ? [new TextRun({ text, ...opts })]
    : text;
  return new Paragraph({ children: runs, spacing: { after: 120 } });
}

function bold(text) { return new TextRun({ text, bold: true }); }
function italic(text) { return new TextRun({ text, italics: true }); }
function code(text) { return new TextRun({ text, font: "Courier New", size: 20, shading: { fill: COLORS.codeBg, type: ShadingType.CLEAR } }); }

function bulletList(items, ref = "bullets") {
  return items.map(item => {
    const children = typeof item === "string"
      ? [new TextRun(item)]
      : item;
    return new Paragraph({ numbering: { reference: ref, level: 0 }, children, spacing: { after: 60 } });
  });
}

function numberedList(items) {
  return items.map(item => {
    const children = typeof item === "string"
      ? [new TextRun(item)]
      : item;
    return new Paragraph({ numbering: { reference: "numbers", level: 0 }, children, spacing: { after: 60 } });
  });
}

function codeBlock(text) {
  return text.split("\n").map(line =>
    new Paragraph({
      children: [new TextRun({ text: line || " ", font: "Courier New", size: 18 })],
      spacing: { after: 0 },
      indent: { left: 360 },
      shading: { fill: COLORS.codeBg, type: ShadingType.CLEAR },
    })
  );
}

function apiTable(rows) {
  // rows: [[method, path, auth, description], ...]
  const colWidths = [900, 3200, 1800, 3460];
  const headerRow = new TableRow({
    tableHeader: true,
    children: ["Method", "Path", "Auth", "Description"].map((h, i) =>
      new TableCell({
        borders, width: { size: colWidths[i], type: WidthType.DXA },
        margins: cellMargins,
        shading: { fill: COLORS.headerBg, type: ShadingType.CLEAR },
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: COLORS.headerText, font: "Arial", size: 20 })] })],
      })
    ),
  });

  const dataRows = rows.map((row, ri) =>
    new TableRow({
      children: row.map((cell, ci) =>
        new TableCell({
          borders, width: { size: colWidths[ci], type: WidthType.DXA },
          margins: cellMargins,
          shading: ri % 2 === 1 ? { fill: COLORS.altRowBg, type: ShadingType.CLEAR } : undefined,
          children: [new Paragraph({ children: [new TextRun({ text: cell, font: ci <= 1 ? "Courier New" : "Arial", size: 20 })] })],
        })
      ),
    })
  );

  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows],
  });
}

function simpleTable(headers, rows, colWidths) {
  if (!colWidths) {
    const w = Math.floor(CONTENT_W / headers.length);
    colWidths = headers.map(() => w);
  }
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) =>
      new TableCell({
        borders, width: { size: colWidths[i], type: WidthType.DXA },
        margins: cellMargins,
        shading: { fill: COLORS.headerBg, type: ShadingType.CLEAR },
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: COLORS.headerText, size: 20 })] })],
      })
    ),
  });
  const dataRows = rows.map((row, ri) =>
    new TableRow({
      children: row.map((cell, ci) =>
        new TableCell({
          borders, width: { size: colWidths[ci], type: WidthType.DXA },
          margins: cellMargins,
          shading: ri % 2 === 1 ? { fill: COLORS.altRowBg, type: ShadingType.CLEAR } : undefined,
          children: [new Paragraph({ children: typeof cell === "string" ? [new TextRun({ text: cell, size: 20 })] : cell })],
        })
      ),
    })
  );
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows],
  });
}

function spacer() { return new Paragraph({ spacing: { after: 200 }, children: [] }); }

// ─── Document Sections ───────────────────────────────────────────────────────

function buildTitlePage() {
  return [
    new Paragraph({ spacing: { before: 3000 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "PB Tech Ops Suite", size: 56, bold: true, color: COLORS.primary })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: "Developer Guide", size: 40, color: COLORS.accent })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: "Photon Brothers Solar Operations Platform", size: 24, color: "666666" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, size: 22, color: "999999" })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function buildTOC() {
  return [
    heading(HeadingLevel.HEADING_1, "Table of Contents"),
    new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function buildIntroduction() {
  return [
    heading(HeadingLevel.HEADING_1, "1. Introduction"),
    para("PB Tech Ops Suite is the internal operations platform for Photon Brothers, a residential and commercial solar installation company operating across 5 locations in Colorado and California (Westminster, Centennial, Colorado Springs, San Luis Obispo, Camarillo)."),
    para("The platform manages the full project lifecycle from sales through installation and service, integrating with HubSpot (CRM), Zuper (field service), Zoho Inventory (products and sales orders), Google Calendar (scheduling), and multiple AI providers."),
    spacer(),

    heading(HeadingLevel.HEADING_2, "1.1 Tech Stack"),
    simpleTable(
      ["Layer", "Technology"],
      [
        ["Framework", "Next.js 16.1, React 19.2, TypeScript 5"],
        ["Styling", "Tailwind CSS v4 with CSS variable tokens"],
        ["Database", "Prisma 7.3 on Neon Postgres"],
        ["Auth", "next-auth v5 beta (Google OAuth, domain-restricted)"],
        ["Data Fetching", "React Query v5 + SSE real-time invalidation"],
        ["CRM", "HubSpot (deals, contacts, companies, tickets, line items)"],
        ["Field Service", "Zuper (jobs, scheduling, crew management)"],
        ["Inventory", "Zoho Inventory (products, sales orders, purchase orders)"],
        ["Calendar", "Google Calendar API (shared install/survey calendars)"],
        ["Email", "Google Workspace (primary) + Resend (fallback)"],
        ["AI - BOM", "Anthropic Claude (planset PDF extraction)"],
        ["AI - Analytics", "OpenAI (anomaly detection, NL queries)"],
        ["AI - Photos", "Google Gemini (DA photo equipment assets)"],
        ["Real-time", "Server-Sent Events via /api/stream + useSSE hook"],
        ["Video", "Remotion (walkthrough content generation)"],
        ["Monitoring", "Sentry (error tracking with DSN tunnel)"],
        ["Deploy", "Vercel (preview + production deployments)"],
      ],
      [2400, 6960]
    ),
    spacer(),

    heading(HeadingLevel.HEADING_2, "1.2 Build Commands"),
    ...codeBlock(
`npm run dev              # Local dev server
npm run build            # prisma generate && next build
npm run test             # Jest tests
npm run test:watch       # Jest watch mode
npm run lint             # ESLint
npm run preflight        # Pre-deploy checks
npm run db:migrate       # prisma migrate deploy
npm run email:preview    # React Email dev preview
npm run build:solar      # Build Solar Surveyor sub-app
npm run remotion:studio  # Remotion video editor`
    ),
    spacer(),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function buildArchitecture() {
  return [
    heading(HeadingLevel.HEADING_1, "2. System Architecture"),

    heading(HeadingLevel.HEADING_2, "2.1 Integration Map"),
    para("The platform acts as an orchestration layer between four external systems:"),
    ...codeBlock(
`HubSpot CRM                    Zuper Field Service
  (deals, contacts,               (jobs, scheduling,
   tickets, line items)            crew, compliance)
        |                               |
        v                               v
  +------------------------------------------+
  |       PB Tech Ops Suite (Next.js)      |
  |                                          |
  |  Prisma DB  <-->  API Routes  <-->  UI   |
  |     (Neon)        (34+ groups)   (70+ pg)|
  +------------------------------------------+
        |                               |
        v                               v
  Zoho Inventory                Google Calendar
  (products, SOs,               (shared install +
   purchase orders)              survey calendars)`
    ),
    spacer(),

    heading(HeadingLevel.HEADING_2, "2.2 Authentication Mechanisms"),
    simpleTable(
      ["Mechanism", "Used By", "How It Works"],
      [
        ["NextAuth Session", "Most routes", "Google OAuth, domain-restricted to ALLOWED_EMAIL_DOMAIN"],
        ["API_SECRET_TOKEN", "Machine-to-machine", "Bearer token in Authorization header for BOM/product endpoints"],
        ["CRON_SECRET", "Cron jobs", "Bearer token for /api/cron/* endpoints"],
        ["HubSpot Webhook Sig", "Webhooks", "HMAC-SHA256 signature validation on webhook payloads"],
        ["Solar Auth", "Solar Surveyor", "Custom auth with CSRF + rate limiting for solar sub-app"],
        ["Portal Token", "Customer portal", "Hashed token for survey invite links (no session required)"],
      ],
      [2200, 2200, 4960]
    ),
    spacer(),

    heading(HeadingLevel.HEADING_2, "2.3 Role-Based Access Control"),
    para("11 roles defined in Prisma. Legacy roles auto-normalize (MANAGER -> PROJECT_MANAGER, DESIGNER/PERMITTING -> TECH_OPS)."),
    simpleTable(
      ["Role", "Scope"],
      [
        ["ADMIN", "All routes, user management, system config, impersonation"],
        ["EXECUTIVE", "All routes except /admin"],
        ["PROJECT_MANAGER", "Ops, D&E, P&I, intelligence, service, D&R (executive via direct URL only)"],
        ["OPERATIONS_MANAGER", "Ops, service, D&R, intelligence (executive via direct URL only)"],
        ["OPERATIONS", "Ops, service, D&R only"],
        ["TECH_OPS", "D&E, P&I, ops only"],
        ["SALES", "Sales scheduler + survey availability"],
        ["VIEWER", "Minimal dashboard/API access (default for new users)"],
      ],
      [3000, 6360]
    ),
    para([bold("Permission overrides: "), new TextRun("canScheduleSurveys, canScheduleInstalls, canScheduleInspections, canSyncZuper, canManageUsers, canManageAvailability, canEditDesign, canEditPermitting, canViewAllLocations")]),
    spacer(),

    heading(HeadingLevel.HEADING_2, "2.4 Real-time Data (SSE)"),
    para("GET /api/stream returns a Server-Sent Events connection. Messages include:"),
    ...bulletList([
      [bold("connected"), new TextRun(" - initial handshake with timestamp")],
      [bold("heartbeat"), new TextRun(" - every 30s to keep connection alive")],
      [bold("cache_update"), new TextRun(" - key + timestamp when server cache invalidates")],
      [bold("reconnect"), new TextRun(" - sent before TTL auto-close (50s Vercel limit)")],
    ]),
    para("Client-side useSSE hook handles exponential backoff: 1s -> 2s -> 4s -> 8s -> 16s -> 30s cap, max 10 retries."),
    spacer(),

    heading(HeadingLevel.HEADING_2, "2.5 Caching Strategy"),
    ...bulletList([
      [bold("React Query"), new TextRun(": Client-side data caching with configurable stale times")],
      [bold("Server cache"), new TextRun(" (lib/cache.ts): In-memory TTL cache for expensive API responses")],
      [bold("Query keys"), new TextRun(" (lib/query-keys.ts): Centralized key factory for cache invalidation")],
      [bold("Cache cascade"), new TextRun(": Service priority queue listens to upstream deals:service* and service-tickets* invalidations with 500ms debounce")],
    ]),
    spacer(),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function buildApiReference() {
  const sections = [];

  sections.push(heading(HeadingLevel.HEADING_1, "3. API Endpoint Reference"));
  sections.push(para("All API routes live under src/app/api/. Each subsection documents method, auth, request/response shapes."));
  sections.push(spacer());

  // ─── 3.1 Deals & Projects ─────────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "3.1 Deals & Projects"));
  sections.push(apiTable([
    ["GET", "/api/deals", "Session", "List deals by pipeline with filters, pagination, sorting"],
    ["GET", "/api/deals/search", "API auth", "Search deals by query string (min 2 chars)"],
    ["GET", "/api/deals/stream", "Session", "SSE stream for real-time deal updates"],
    ["GET", "/api/projects", "Bearer/Public", "List projects with advanced filtering, caching, pagination"],
    ["GET", "/api/projects/[id]", "API auth", "Single project detail"],
    ["PATCH", "/api/projects/[id]", "API auth", "Update specific project properties"],
  ]));
  sections.push(spacer());
  sections.push(para([bold("GET /api/deals"), new TextRun(" query params: pipeline (required: sales|dnr|service|roofing), active, location, stage, search, page, limit, sort, order, refresh")]));
  sections.push(para([bold("GET /api/projects"), new TextRun(" query params: location, locations, stage, search, context (scheduling|equipment|pe|executive|at-risk|all), active, stats, refresh, fields, page, limit, sort, order")]));
  sections.push(spacer());

  // ─── 3.2 Service Suite ─────────────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "3.2 Service Suite"));
  sections.push(apiTable([
    ["GET", "/api/service/tickets", "Session", "List open service tickets with stage map, owners, locations"],
    ["GET", "/api/service/tickets/[id]", "Session", "Ticket detail with associations and timeline"],
    ["PATCH", "/api/service/tickets/[id]", "Session", "Update ticket owner, stage, or add note"],
    ["GET", "/api/service/customers", "Session", "Search customers by name/email/phone/address (q param, min 2 chars)"],
    ["GET", "/api/service/customers/[contactId]", "Session", "Customer 360-view: deals, tickets, Zuper jobs"],
    ["GET", "/api/service/priority-queue", "Session", "Scored priority queue (0-100) with tier breakdown"],
    ["POST", "/api/service/priority-queue/overrides", "Session+Role", "Set manual priority override (ADMIN/EXECUTIVE/MGR/OPS roles)"],
    ["DELETE", "/api/service/priority-queue/overrides/[type]/[id]", "Session+Role", "Remove priority override"],
    ["GET", "/api/service/equipment", "API auth", "Equipment list by project with module/inverter/battery details"],
  ]));
  sections.push(spacer());

  // ─── 3.3 BOM Pipeline ─────────────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "3.3 BOM Pipeline"));
  sections.push(apiTable([
    ["POST", "/api/bom/extract", "Session+Role", "Extract BOM from planset PDF via Claude vision (SSE response, 300s timeout)"],
    ["POST", "/api/bom/upload", "Session+Role", "Upload planset PDF to Vercel Blob (binary stream, 60s)"],
    ["POST", "/api/bom/upload-token", "Session+Role", "Get Vercel Blob client upload token"],
    ["POST", "/api/bom/chunk", "Session+Role", "Chunked upload for large PDFs (base64 chunks, 120s)"],
    ["POST", "/api/bom/save", "Session", "Save BOM snapshot, sync InternalProducts, match catalog"],
    ["GET", "/api/bom/history", "Session", "BOM snapshots for a deal (dealId param)"],
    ["POST", "/api/bom/history", "Session+Role", "Create new BOM snapshot with version auto-increment"],
    ["GET", "/api/bom/history/all", "Session", "All BOM snapshots across deals (paginated, max 500)"],
    ["POST", "/api/bom/push-to-hubspot", "Session+Role", "Push BOM line items to HubSpot deal (lock-based)"],
    ["POST", "/api/bom/create-so", "Session+Role", "Create draft Zoho Sales Order from BOM snapshot"],
    ["POST", "/api/bom/create-po", "Session+Role", "Create Zoho Purchase Order from BOM snapshot"],
    ["GET", "/api/bom/zoho-so", "Session", "Fetch Zoho Sales Order(s) by number, batch, or search"],
    ["GET", "/api/bom/zoho-customers", "Session", "Search Zoho customers by name or HubSpot contact ID"],
    ["GET", "/api/bom/zoho-vendors", "Session", "List Zoho vendors (30-min TTL cache)"],
    ["GET", "/api/bom/linked-products", "Session+Role", "Products linked to a deal (HubSpot + Zoho)"],
    ["POST", "/api/bom/linked-products/add-hubspot-line-item", "Session+Role", "Add HubSpot line item to deal"],
    ["POST", "/api/bom/linked-products/add-zuper-part", "Session+Role", "Add Zuper part to job"],
    ["POST", "/api/bom/linked-products/sync-missing", "Admin/Owner", "Preview/execute missing line item sync"],
    ["POST", "/api/bom/resolve-customer", "Session", "Resolve Zoho customer from deal name/contact/address"],
    ["GET", "/api/bom/drive-files", "Session", "List PDFs in Google Drive folder (15s timeout)"],
    ["POST", "/api/bom/export-pdf", "Session", "Export BOM snapshot as PDF download (30s)"],
    ["POST", "/api/bom/feedback", "Session", "Submit BOM tool feedback"],
    ["POST", "/api/bom/notify", "Session", "Send BOM extraction notification email (15s)"],
    ["POST", "/api/bom/pipeline-retry", "Session+Role", "Retry failed BOM pipeline run (300s)"],
  ]));
  sections.push(spacer());

  // ─── 3.4 Product Catalog ───────────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "3.4 Product Catalog"));
  sections.push(apiTable([
    ["GET", "/api/catalog/search", "API auth", "Search products by brand/model/description/SKU"],
    ["GET", "/api/catalog/vendors", "Public", "List all vendors with optional Zoho IDs"],
    ["GET/POST", "/api/catalog/vendors/sync", "Cron/Admin", "Sync vendor list from Zoho"],
    ["GET", "/api/catalog/review", "Admin/Owner", "List catalog match groups for review"],
    ["POST", "/api/catalog/review", "Admin/Owner", "Approve/reject catalog match group"],
    ["GET", "/api/catalog/push-requests", "API auth", "List pending catalog push requests"],
    ["POST", "/api/catalog/push-requests", "API auth", "Create new catalog push request"],
    ["PATCH", "/api/catalog/push-requests/[id]", "Admin", "Update push request details"],
    ["POST", "/api/catalog/push-requests/[id]/approve", "Admin/Owner/Mgr", "Approve and sync to HubSpot/Zoho/Zuper"],
    ["POST", "/api/catalog/push-requests/[id]/reject", "Admin", "Reject push request"],
    ["POST", "/api/catalog/extract-from-datasheet", "API auth", "Extract product specs from datasheet PDF"],
    ["POST", "/api/catalog/upload-photo", "API auth", "Upload product photo to Vercel Blob (5MB max)"],
    ["DELETE", "/api/catalog/upload-photo", "API auth", "Delete product photo"],
    ["POST", "/api/catalog/match", "Admin/Owner", "Run catalog matching engine"],
    ["POST", "/api/catalog/harvest", "Admin/Owner", "Harvest product data from external sources"],
    ["POST", "/api/catalog/expire-pending", "Cron/Admin", "Expire stale PendingCatalogPush records"],
    ["POST", "/api/catalog/zoho-dedup", "Admin/Owner", "Scan Zoho for duplicate products"],
    ["POST", "/api/catalog/zoho-dedup/execute", "Admin/Owner", "Execute dedup with confirmation token"],
    ["GET", "/api/catalog/zoho-dedup/history", "Admin/Owner", "Dedup run history"],
  ]));
  sections.push(spacer());

  // ─── 3.5 Inventory ────────────────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "3.5 Inventory"));
  sections.push(apiTable([
    ["GET", "/api/inventory/products", "Public", "List products with category/search/active filters"],
    ["POST", "/api/inventory/products", "Admin/Owner/PM", "Create new internal product"],
    ["PATCH", "/api/inventory/products", "Admin/Owner/PM", "Update product properties"],
    ["DELETE", "/api/inventory/products", "Admin only", "Delete product (cascade deletes specs, stock, transactions)"],
    ["GET", "/api/inventory/products/stats", "API auth", "Category-level sync health statistics"],
    ["GET", "/api/inventory/stock", "Public", "Stock levels by location and category"],
    ["PUT", "/api/inventory/stock/[id]", "API auth+Role", "Update min stock level"],
    ["GET", "/api/inventory/transactions", "Public", "Transaction history with filters"],
    ["POST", "/api/inventory/transactions", "API auth", "Record stock transaction (atomic upsert)"],
    ["GET", "/api/inventory/needs", "Public", "Demand analysis with weighted stage scoring"],
    ["POST", "/api/inventory/sync-zoho", "API auth+Role", "Sync stock from Zoho Inventory locations"],
  ]));
  sections.push(spacer());

  // ─── 3.6 Zuper Field Service ──────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "3.6 Zuper Field Service"));
  sections.push(apiTable([
    ["POST", "/api/zuper/jobs", "API auth", "Create Zuper job (survey, install, inspection)"],
    ["GET", "/api/zuper/jobs", "API auth", "List jobs with filters (hubspot_id, status, category, dates)"],
    ["PUT", "/api/zuper/jobs/schedule/tentative", "Session", "Create tentative schedule (no Zuper sync)"],
    ["GET", "/api/zuper/availability", "Session", "Crew availability for date range"],
    ["GET", "/api/zuper/revenue-calendar", "Session", "Revenue calendar with job values"],
    ["GET", "/api/zuper/linkage-coverage", "Session", "HubSpot-Zuper job linkage coverage report"],
  ]));
  sections.push(spacer());

  // ─── 3.7 Forecasting ──────────────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "3.7 Forecasting"));
  sections.push(apiTable([
    ["GET", "/api/forecasting/baselines", "Public", "Forecast baselines by segment (cached)"],
    ["GET", "/api/forecasting/accuracy", "Public", "Milestone accuracy metrics and monthly trends (120s timeout)"],
    ["GET", "/api/forecasting/timeline", "Public", "Project timeline with forecast vs actual milestones (120s timeout)"],
  ]));
  sections.push(spacer());

  // ─── 3.8 Admin ────────────────────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "3.8 Admin"));
  sections.push(apiTable([
    ["GET", "/api/admin/users", "Admin", "List all users with roles"],
    ["PUT", "/api/admin/users", "Admin", "Change user role"],
    ["PUT", "/api/admin/users/permissions", "Admin", "Update granular permission booleans"],
    ["GET/POST", "/api/admin/sync-zuper", "Admin", "Preview (GET) or execute (POST) Zuper user/crew sync"],
    ["GET/POST", "/api/admin/crew", "Admin", "List or create/seed crew members"],
    ["GET", "/api/admin/audit", "Admin", "Activity logs with filtering (type, role, user, date, email)"],
    ["GET/POST/DELETE", "/api/admin/impersonate", "Admin", "Start, check, or end role impersonation"],
  ]));
  sections.push(spacer());

  // ─── 3.9 Webhooks ────────────────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "3.9 Webhooks"));
  sections.push(apiTable([
    ["POST", "/api/webhooks/hubspot/design-review", "HubSpot Sig", "Triggered on deal stage change; runs design review checks"],
    ["POST", "/api/webhooks/hubspot/design-complete", "HubSpot Sig", "Triggered on design-complete stage; runs full BOM pipeline"],
  ]));
  sections.push(para([bold("Auth: "), new TextRun("HubSpot HMAC-SHA256 signature validation via x-hubspot-signature-v3 header")]));
  sections.push(para([bold("Deduplication: "), new TextRun("Review lock prevents concurrent runs per deal. Stale locks (>10 min) auto-recovered.")]));
  sections.push(spacer());

  // ─── 3.10 Portal ──────────────────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "3.10 Customer Portal"));
  sections.push(apiTable([
    ["POST", "/api/portal/survey/invite", "Session+Perm", "Create survey invite with token, send email (14-day expiry)"],
    ["GET", "/api/portal/survey/[token]", "Public", "Validate invite token and return survey details"],
    ["POST", "/api/portal/survey/[token]", "Public", "Submit survey response (availability, system details)"],
    ["GET", "/api/portal/survey/contact-email", "Session", "Look up contact email for deal"],
    ["GET", "/api/portal/survey/invites", "Session", "List user's survey invites"],
  ]));
  sections.push(spacer());

  // ─── 3.11 AI & Chat ──────────────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "3.11 AI & Chat"));
  sections.push(apiTable([
    ["POST", "/api/chat", "Session", "Claude chat with deal context and tool use (max 5 iterations)"],
    ["POST", "/api/ai/nl-query", "Admin/Owner", "Natural language to project filter spec (10 req/min)"],
    ["POST", "/api/ai/anomalies", "Session", "Anomaly detection on activity data"],
  ]));
  sections.push(para([bold("Chat tools: "), new TextRun("get_deal, get_review_results, search_deals, run_review, filter_deals_by_stage, count_deals_by_stage")]));
  sections.push(spacer());

  // ─── 3.12 Other Routes ───────────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "3.12 Other Routes"));
  sections.push(apiTable([
    ["GET", "/api/stream", "Session", "SSE endpoint for real-time cache invalidation"],
    ["GET", "/api/health", "Public", "Health check with uptime and cache stats"],
    ["POST/GET", "/api/deployment", "Webhook secret", "Vercel deployment event receiver"],
    ["GET", "/api/cron/audit-digest", "CRON_SECRET", "Daily audit digest email (7am MT)"],
    ["GET", "/api/cron/audit-retention", "CRON_SECRET", "Audit log retention cleanup"],
    ["POST", "/api/compliance/email", "Admin/Owner", "Generate and send compliance digest email"],
    ["POST", "/api/reviews/run", "Session+Role", "Trigger design review for a deal"],
    ["POST", "/api/reviews/batch-status", "Session", "Batch check review status for deal IDs"],
    ["GET", "/api/reviews/status/[id]", "Session", "Review run status and findings"],
    ["POST", "/api/activity/log", "Session", "Log user activity event"],
    ["POST", "/api/bugs/report", "Session", "Submit bug report"],
    ["GET", "/api/sop/*", "Session+Role", "SOP tab and section CRUD (role-gated)"],
    ["GET", "/api/solar/*", "Solar auth", "Solar Surveyor project CRUD, weather, shade, equipment"],
  ]));
  sections.push(spacer());
  sections.push(new Paragraph({ children: [new PageBreak()] }));

  return sections;
}

function buildProcessWalkthroughs() {
  const sections = [];

  sections.push(heading(HeadingLevel.HEADING_1, "4. Process Walkthroughs"));

  // ─── 4.1 Deal-to-Sales-Order Pipeline ──────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "4.1 Deal-to-Sales-Order Pipeline"));
  sections.push(para("The BOM pipeline converts a planset PDF into a Zoho Sales Order through four stages:"));
  sections.push(spacer());

  sections.push(heading(HeadingLevel.HEADING_3, "Stage 1: BOM Extraction (bom-extract.ts)"));
  sections.push(para("Claude vision reads the planset PDF and extracts equipment as BomItem[] with: category, brand, model, description, qty, unitSpec, unitLabel, flags."));
  sections.push(para([bold("Trigger: "), new TextRun("Manual via UI (POST /api/bom/extract) or automatic via webhook (design-complete stage change).")]));
  sections.push(spacer());

  sections.push(heading(HeadingLevel.HEADING_3, "Stage 2: Snapshot & Catalog Match"));
  sections.push(para([bold("bom-snapshot.ts"), new TextRun(": Auto-increments version, post-processes items, records snapshot in ProjectBomSnapshot table.")]));
  sections.push(para([bold("bom-catalog-match.ts"), new TextRun(": For each item:")]));
  sections.push(...numberedList([
    "Check if category is in INVENTORY_CATEGORIES",
    "Search Zoho Inventory by brand + model",
    "If Zoho match found: create/link InternalProduct",
    "If no Zoho match: search internal InternalProduct by canonicalKey",
    "If no match anywhere: create PendingCatalogPush (90-day TTL)",
  ]));
  sections.push(spacer());

  sections.push(heading(HeadingLevel.HEADING_3, "Stage 3: HubSpot Line Items Push"));
  sections.push(para([bold("bom-hubspot-line-items.ts"), new TextRun(": Pushes matched products as HubSpot line items on the deal.")]));
  sections.push(...bulletList([
    "Acquires PENDING lock per deal (partial unique index, stale after 5 min)",
    "Creates line items from InternalProduct -> HubSpot Product linkage",
    "Deletes prior BOM-managed items on success (atomic swap)",
    "Logs result in BomHubSpotPushLog",
  ]));
  sections.push(spacer());

  sections.push(heading(HeadingLevel.HEADING_3, "Stage 4: Sales Order Creation"));
  sections.push(para([bold("bom-so-create.ts"), new TextRun(": Creates a draft Zoho Sales Order.")]));
  sections.push(...numberedList([
    "Post-process items: batch quantities, bundle accessories, suggest additions (bom-so-post-process.ts)",
    "Resolve Zoho customer from HubSpot company (bom-customer-resolve.ts)",
    "Build Zoho SO payload with line items",
    "Create draft Sales Order in Zoho Inventory",
    "Update snapshot with SO ID",
  ]));
  sections.push(spacer());

  // ─── 4.2 Service Ticket Lifecycle ──────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "4.2 Service Ticket Lifecycle"));
  sections.push(para("Service tickets flow through the HubSpot service pipeline with priority scoring:"));
  sections.push(...numberedList([
    [bold("Ticket Created"), new TextRun(": Created in HubSpot service pipeline (ID: 23928924)")],
    [bold("Fetched by App"), new TextRun(": hubspot-tickets.ts paginates all open tickets, resolves deal associations for location")],
    [bold("Location Derived"), new TextRun(": ticket -> deal -> pb_location, fallback: ticket -> company -> city/state")],
    [bold("Priority Scored"), new TextRun(": service-priority.ts scores 0-100 based on warranty, recency, stage duration, value, urgency")],
    [bold("Queue Displayed"), new TextRun(": /dashboards/service-tickets shows kanban board with stage columns and filters")],
    [bold("Manual Override"), new TextRun(": Ops can set priority override with reason and expiration via ServicePriorityOverride")],
    [bold("Ticket Updated"), new TextRun(": PATCH changes owner, stage, or adds note in HubSpot")],
    [bold("Cache Invalidated"), new TextRun(": SSE pushes cache_update event, React Query refetches")],
  ]));
  sections.push(spacer());

  // ─── 4.3 Customer History Lookup ───────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "4.3 Customer History Lookup"));
  sections.push(para([bold("customer-resolver.ts"), new TextRun(": Provides 360-degree customer view.")]));
  sections.push(spacer());
  sections.push(para([bold("Search (searchContacts):")]));
  sections.push(...numberedList([
    "Parallel search HubSpot contacts by name/email/phone/address",
    "Parallel search HubSpot companies by name/domain",
    "Resolve company -> associated contacts",
    "Deduplicate by contact ID, cap at 25 results",
  ]));
  sections.push(spacer());
  sections.push(para([bold("Detail Resolution (resolveContactDetail):")]));
  sections.push(...numberedList([
    "Batch-read contact properties from HubSpot",
    "Resolve contact -> deal associations (batch API)",
    "Resolve contact -> ticket associations (batch API)",
    "Resolve contact -> company for company name",
    "Batch-read all deal details (stage, amount, location)",
    "Batch-read all ticket details (subject, status, priority)",
    "Resolve Zuper jobs via deal-linked cache OR name/address heuristic fallback",
  ]));
  sections.push(spacer());

  // ─── 4.4 Priority Queue Scoring ────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "4.4 Priority Queue Scoring Algorithm"));
  sections.push(para("The priority engine (service-priority.ts) scores each service deal and ticket on a 0-100 scale:"));
  sections.push(simpleTable(
    ["Factor", "Max Points", "Rules"],
    [
      ["Warranty Expiry", "40", "Expired: +30, <=7 days: +40, <=30 days: +15"],
      ["Last Contact Recency", "35", ">7 days: +35, >3 days: +25, >1 day: +5"],
      ["Stage Duration", "20", ">7 days stuck: +20, >3 days: +10"],
      ["Deal Value", "10", ">$10k: +10, >$5k: +5"],
      ["Stage-Specific Urgency", "5", "Inspection/Invoicing = urgent stages"],
    ],
    [2400, 1600, 5360]
  ));
  sections.push(spacer());
  sections.push(para([bold("Tiers: "), new TextRun("Critical (75-100), High (50-74), Medium (25-49), Low (0-24)")]));
  sections.push(para([bold("Cache: "), new TextRun("Key service:priority-queue cascades from deals:service* and service-tickets* with 500ms debounce to prevent thundering herd.")]));
  sections.push(spacer());

  // ─── 4.5 Scheduling Flow ──────────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "4.5 Scheduling Flow"));
  sections.push(para("The platform supports multiple scheduling types: site surveys, installations, inspections, roofing, D&R, and service."));
  sections.push(...numberedList([
    [bold("Slot Selection"), new TextRun(": UI shows available crew slots based on CrewAvailability and AvailabilityOverride records")],
    [bold("Travel Time Check"), new TextRun(": Google Maps Distance Matrix calculates drive time between consecutive jobs (survey scheduling)")],
    [bold("Policy Validation"), new TextRun(": scheduling-policy.ts enforces rules (e.g., Sales role = surveys only, 2+ days out)")],
    [bold("Tentative Save"), new TextRun(": PUT /api/zuper/jobs/schedule/tentative saves to ScheduleRecord without Zuper sync")],
    [bold("Zuper Job Create"), new TextRun(": POST /api/zuper/jobs creates the actual Zuper job with assigned_to (can only be set at creation)")],
    [bold("Calendar Sync"), new TextRun(": google-calendar.ts creates events on location-specific shared calendars")],
    [bold("Email Notification"), new TextRun(": SchedulingNotification email sent to assignee and optional BCC recipients")],
    [bold("Customer Portal"), new TextRun(": For surveys, customer gets a portal invite to confirm availability (14-day token)")],
  ]));
  sections.push(spacer());

  // ─── 4.6 Product Catalog Sync ──────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "4.6 Product Catalog Sync Pipeline"));
  sections.push(para("Products flow through a multi-system sync pipeline:"));
  sections.push(...numberedList([
    [bold("Internal Product Created"), new TextRun(": Via catalog wizard (BasicsStep -> DetailsStep -> ReviewStep) or BOM extraction")],
    [bold("Spec Tables Populated"), new TextRun(": Category-specific specs (ModuleSpec, InverterSpec, BatterySpec, etc.) stored separately")],
    [bold("Push Request Created"), new TextRun(": PendingCatalogPush record with target systems (INTERNAL, HUBSPOT, ZOHO, ZUPER)")],
    [bold("Admin Approval"), new TextRun(": POST /api/catalog/push-requests/[id]/approve triggers two-phase sync")],
    [bold("HubSpot Sync"), new TextRun(": Creates HubSpot Product with properties mapped via hubspotProperty field definitions")],
    [bold("Zoho Sync"), new TextRun(": Creates/updates Zoho Inventory item with category -> group_name mapping")],
    [bold("Zuper Sync"), new TextRun(": Creates Zuper product with custom fields from spec tables")],
  ]));
  sections.push(spacer());
  sections.push(para([bold("Deduplication: "), new TextRun("catalog-dedupe.ts groups products by canonical brand+model, presents merge candidates via DedupPanel component. Zoho-specific dedup available at POST /api/catalog/zoho-dedup.")]));
  sections.push(spacer());

  // ─── 4.7 Design Review Workflow ────────────────────────────────────────────
  sections.push(heading(HeadingLevel.HEADING_2, "4.7 Design Review Workflow"));
  sections.push(...numberedList([
    [bold("Trigger"), new TextRun(": Manual (POST /api/reviews/run) or webhook (deal stage change to design-review target)")],
    [bold("Lock Acquired"), new TextRun(": review-lock.ts prevents concurrent reviews per deal")],
    [bold("Deal Properties Fetched"), new TextRun(": 22 properties including stage, location, design status, equipment specs")],
    [bold("AI Review"), new TextRun(": Checks design completeness, equipment compatibility, compliance requirements")],
    [bold("Results Stored"), new TextRun(": ProjectReview record with findings, status (PENDING/COMPLETE/NEEDS_REVISION), duration")],
    [bold("Feedback"), new TextRun(": DesignReviewFeedback records for review comments and follow-ups")],
  ]));
  sections.push(spacer());
  sections.push(new Paragraph({ children: [new PageBreak()] }));

  return sections;
}

function buildDataModels() {
  return [
    heading(HeadingLevel.HEADING_1, "5. Data Models"),
    para("The Prisma schema defines models organized by domain. Key model groups:"),
    spacer(),

    heading(HeadingLevel.HEADING_2, "5.1 User & Auth"),
    ...bulletList([
      [bold("User"), new TextRun(": Account with role (11 enums), permission booleans, preferences")],
      [bold("ActivityLog"), new TextRun(": Audit trail (50+ ActivityType enums) with IP, user agent, metadata")],
      [bold("AuditSession"), new TextRun(": Session tracking with client type (BROWSER, CLAUDE_CODE, CODEX, API_CLIENT)")],
      [bold("AuditAnomalyEvent"), new TextRun(": Suspicious activity with risk level (LOW-CRITICAL)")],
    ]),
    spacer(),

    heading(HeadingLevel.HEADING_2, "5.2 BOM Pipeline"),
    ...bulletList([
      [bold("ProjectBomSnapshot"), new TextRun(": BOM version per deal with bomData JSON, source file, Zoho SO/PO IDs")],
      [bold("BomPipelineRun"), new TextRun(": Pipeline execution tracking (status: QUEUED -> EXTRACTING -> VALIDATING -> MATCHING -> PUSHING -> COMPLETE/FAILED)")],
      [bold("BomHubSpotPushLog"), new TextRun(": HubSpot line item push results with pushed/skipped/deleted counts")],
      [bold("PendingCatalogPush"), new TextRun(": Staging area for unmatched products (90-day TTL, target systems)")],
      [bold("CatalogMatchGroup"), new TextRun(": Product matching groups with confidence (EXACT/HIGH/MEDIUM/LOW)")],
    ]),
    spacer(),

    heading(HeadingLevel.HEADING_2, "5.3 Product Catalog"),
    ...bulletList([
      [bold("InternalProduct"), new TextRun(": Master product record (category, brand, model, SKU, pricing, sync health)")],
      [bold("ModuleSpec, InverterSpec, BatterySpec, EvChargerSpec"), new TextRun(": Category-specific spec tables")],
      [bold("MountingHardwareSpec, ElectricalHardwareSpec, RelayDeviceSpec"), new TextRun(": Hardware spec tables")],
      [bold("VendorLookup"), new TextRun(": Vendor name normalization and Zoho ID mapping")],
      [bold("InventoryStock"), new TextRun(": Per-location stock levels synced from Zoho")],
      [bold("StockTransaction"), new TextRun(": Stock movements (RECEIPT, ALLOCATION, TRANSFER, ADJUSTMENT, WRITE_OFF)")],
    ]),
    spacer(),

    heading(HeadingLevel.HEADING_2, "5.4 Scheduling"),
    ...bulletList([
      [bold("BookedSlot"), new TextRun(": Persistent calendar bookings with date, assignee, location")],
      [bold("CrewMember"), new TextRun(": Field crew profiles with Zuper UIDs, locations, max daily jobs")],
      [bold("CrewAvailability"), new TextRun(": Weekly availability slots per crew member")],
      [bold("AvailabilityOverride"), new TextRun(": One-off availability exceptions (PTO, special schedules)")],
      [bold("ScheduleRecord"), new TextRun(": Zuper job schedule records for tracking")],
    ]),
    spacer(),

    heading(HeadingLevel.HEADING_2, "5.5 Service"),
    ...bulletList([
      [bold("ServicePriorityOverride"), new TextRun(": Manual priority overrides with reason, expiration, set-by")],
      [bold("ChatMessage"), new TextRun(": AI chat history per user/deal context")],
    ]),
    spacer(),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function buildEnvironmentVars() {
  return [
    heading(HeadingLevel.HEADING_1, "6. Environment Variables"),
    para("See .env.example for the complete list. Key variable groups:"),
    spacer(),

    simpleTable(
      ["Group", "Key Variables", "Notes"],
      [
        ["Database", "DATABASE_URL", "Neon Postgres connection string"],
        ["HubSpot", "HUBSPOT_ACCESS_TOKEN, HUBSPOT_PORTAL_ID, HUBSPOT_PIPELINE_*", "Private app token + pipeline IDs"],
        ["Zuper", "ZUPER_API_KEY, ZUPER_TEAM_UIDS, ZUPER_USER_UIDS", "API key + JSON-formatted team/user UID maps"],
        ["Zoho", "ZOHO_INVENTORY_ORG_ID, ZOHO_INVENTORY_REFRESH_TOKEN, ZOHO_INVENTORY_CLIENT_*", "OAuth2 refresh token flow recommended"],
        ["Google OAuth", "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET", "Google Cloud Console credentials"],
        ["NextAuth", "NEXTAUTH_SECRET, AUTH_URL, NEXTAUTH_URL", "Session encryption + callback URLs"],
        ["Email", "GOOGLE_WORKSPACE_EMAIL_ENABLED, GOOGLE_EMAIL_SENDER, RESEND_API_KEY", "Dual-provider: GWS primary, Resend fallback"],
        ["Calendars", "GOOGLE_INSTALL_CALENDAR_*_ID, GOOGLE_SITE_SURVEY_CALENDAR_ID", "Per-location shared calendar IDs"],
        ["AI", "ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY", "Claude (BOM), OpenAI (analytics), Gemini (photos)"],
        ["Auth", "ALLOWED_EMAIL_DOMAIN, API_SECRET_TOKEN", "Domain restriction + machine auth token"],
        ["Sentry", "SENTRY_DSN, SENTRY_AUTH_TOKEN, NEXT_PUBLIC_SENTRY_DSN", "Error tracking + source map upload"],
        ["Travel", "GOOGLE_MAPS_API_KEY, TRAVEL_TIME_ENABLED", "Distance Matrix for survey scheduling"],
        ["Solar", "NREL_API_KEY, SOLAR_ALLOWED_ORIGINS", "Weather data + CORS for solar sub-app"],
        ["Cron", "CRON_SECRET", "Bearer token for scheduled job endpoints"],
        ["Webhooks", "DEPLOYMENT_WEBHOOK_SECRET", "Vercel deployment event authentication"],
      ],
      [1800, 4000, 3560]
    ),
    spacer(),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function buildConventions() {
  return [
    heading(HeadingLevel.HEADING_1, "7. Conventions & Patterns"),

    heading(HeadingLevel.HEADING_2, "7.1 Dashboard Pattern"),
    para("Most dashboards wrap content in DashboardShell (mobile opts out for full-bleed layout):"),
    ...codeBlock(
`<DashboardShell
  title="Page Name"
  accentColor="orange"  // orange|green|red|blue|purple|emerald|cyan|yellow
  lastUpdated={data?.lastUpdated}
  exportData={{ data: rows, filename: "export.csv" }}
  fullWidth={true}      // optional, viewport width
>`
    ),
    spacer(),

    heading(HeadingLevel.HEADING_2, "7.2 Theme System"),
    para("CSS variables in globals.css with no runtime CSS injection:"),
    simpleTable(
      ["Token", "Usage"],
      [
        ["bg-background", "Page background"],
        ["bg-surface", "Card/panel backgrounds"],
        ["bg-surface-2", "Nested/secondary surfaces"],
        ["bg-surface-elevated", "Modals, popovers"],
        ["text-foreground", "Primary text"],
        ["text-muted", "Secondary/label text"],
        ["border-t-border", "Borders and dividers"],
        ["shadow-card", "Standard card shadow"],
      ],
      [3500, 5860]
    ),
    para("Dark mode: html.dark class toggle. Keep text-white on colored buttons. Remaining bg-zinc-* are intentional status colors."),
    spacer(),

    heading(HeadingLevel.HEADING_2, "7.3 Metric Cards"),
    ...bulletList([
      [bold("StatCard"), new TextRun(": Large accent gradient, for hero metrics")],
      [bold("MiniStat"), new TextRun(": Compact centered, for summary rows")],
      [bold("MetricCard"), new TextRun(": Flexible with border accent, for detail grids")],
      [bold("SummaryCard"), new TextRun(": Minimal, for simple key-value display")],
    ]),
    para("All use key={String(value)} + animate-value-flash for value-change animation."),
    spacer(),

    heading(HeadingLevel.HEADING_2, "7.4 API Error Handling"),
    para("All external API clients (HubSpot, Zuper, Zoho) use exponential backoff retry:"),
    ...bulletList([
      "429 rate limit: exponential backoff + retry",
      "403/404: immediate failure",
      "Network errors: exponential backoff",
      "See searchWithRetry() in hubspot.ts as the reference pattern",
    ]),
    spacer(),

    heading(HeadingLevel.HEADING_2, "7.5 Zuper Gotchas"),
    ...bulletList([
      "assigned_to can only be set at job CREATION time, not on updates",
      "Custom fields: GET returns array of objects, POST expects flat object",
      "Status lives in current_job_status, not status field",
      "Job categories have separate status workflows",
      "Team/User UIDs configured via JSON-formatted environment variables",
    ]),
    spacer(),

    heading(HeadingLevel.HEADING_2, "7.6 General Conventions"),
    ...bulletList([
      "Use DashboardShell for new dashboard pages (unless full-bleed needed)",
      "Use SuitePageShell for suite landing pages",
      "Use theme tokens (bg-surface, text-foreground) - never hardcode colors",
      "Use stagger-grid CSS class for animated grid entry",
      "Use MultiSelectFilter for filterable lists (not custom dropdowns)",
      "Secrets managed via Vercel env vars - never commit .env files",
      "ESLint flat config: eslint-config-next/core-web-vitals + typescript",
      "Prisma output goes to src/generated/prisma",
      "React Query keys centralized in lib/query-keys.ts",
      "All HubSpot/Zuper/Zoho API calls must use rate-limit retry wrappers",
      "BOM pipeline operations must acquire lock before mutating line items",
      "Email templates use React Email - preview with npm run email:preview",
    ]),
  ];
}

// ─── Build Document ──────────────────────────────────────────────────────────

async function main() {
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Arial", size: 22 } }, // 11pt
      },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 36, bold: true, font: "Arial", color: COLORS.primary },
          paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 28, bold: true, font: "Arial", color: COLORS.primary },
          paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 24, bold: true, font: "Arial", color: "34495E" },
          paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 } },
      ],
    },
    numbering: {
      config: [
        { reference: "bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: "numbers",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.primary, space: 4 } },
            children: [
              new TextRun({ text: "PB Tech Ops Suite ", bold: true, size: 18, color: COLORS.primary }),
              new TextRun({ text: "Developer Guide", size: 18, color: "666666" }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Page ", size: 18, color: "999999" }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "999999" }),
            ],
          })],
        }),
      },
      children: [
        ...buildTitlePage(),
        ...buildTOC(),
        ...buildIntroduction(),
        ...buildArchitecture(),
        ...buildApiReference(),
        ...buildProcessWalkthroughs(),
        ...buildDataModels(),
        ...buildEnvironmentVars(),
        ...buildConventions(),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  const outDir = path.join(__dirname, "..", "docs");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "PB-Operations-Suite-Developer-Guide.docx");
  fs.writeFileSync(outPath, buffer);
  console.log(`Generated: ${outPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
