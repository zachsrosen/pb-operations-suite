---
name: find-design-plans
description: Use when you need to find a planset PDF or design files for a PB project. Triggered by needing to locate a stamped planset, wanting to run the planset-bom skill on a job, or looking up design documents for any PROJ-XXXX deal. Covers the full lookup chain: HubSpot deal → Google Drive folder → Stamped Plans subfolder.
version: 0.1.0
---

# Find Design Plans

Locate planset PDFs and design documents for any PB project using HubSpot deal properties and Google Drive.

## Folder Structure

Every project's Drive folder follows this standard layout:

```
[Project Root]  ← all_document_parent_folder_id on HubSpot deal
  0. Sales/
  1. Site Survey/
  2. Design/             ← design_document_folder_id (when populated)
    Stamped Plans/       ← planset PDFs live here
    DA/
    Archive/
  3. Permitting/
  4. Interconnections/
  5. Installation/
  6. Inspections/
  7. PTO & Closeout/
  8. Incentives/
```

## Lookup Steps

### 1. Find the deal in HubSpot

Search by customer name or PROJ number:

```
mcp__98214750__search_crm_objects
  objectType: deals
  query: "Wang" (or "PROJ-9009")
  properties: ["dealname", "design_documents", "all_document_parent_folder_id"]
```

Key properties:
- `design_documents` — **direct URL to the "2. Design" folder** (preferred, almost always set)
- `all_document_parent_folder_id` — root project folder ID (fallback if design_documents missing)

The `design_documents` value is a full `https://drive.google.com/drive/folders/FOLDER_ID` URL.
Extract the folder ID from the URL path.

### 2. Navigate to the Design folder

If `design_documents` is set, extract the folder ID from the URL:
```
https://drive.google.com/drive/folders/1NS-Rz1svH7V1mJxtcq-OOekZw9OUuCDk
                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                        this is the folder ID
```

If not set, search inside `all_document_parent_folder_id` for the "2. Design" subfolder:
```
mcp__c1fc4002__google_drive_search
  api_query: '{ROOT_FOLDER_ID}' in parents
```

### 3. List PDFs via the app's drive-files endpoint

**Do NOT use the Google Drive MCP to list PDFs — it only supports Google Docs.**

Use the app's `/api/bom/drive-files` endpoint instead. It uses the user's OAuth token (or service account fallback) and does a recursive breadth-first PDF scan:

```
GET /api/bom/drive-files?folderId={DESIGN_FOLDER_ID_OR_URL}
```

The `folderId` param accepts either a bare folder ID or a full Drive URL — the route parses both.

Example using preview_eval on the running dev server:

```javascript
const res = await fetch('/api/bom/drive-files?folderId=1NS-Rz1svH7V1mJxtcq-OOekZw9OUuCDk');
const data = await res.json();
// data.files = [{ id, name, mimeType, modifiedTime, size }, ...]
```

### 4. Pass file ID to BOM extract

Once you have a file ID from step 3, pass it to the extract route:

```json
{ "fileId": "GOOGLE_DRIVE_FILE_ID" }
```

The extract route downloads the PDF using the same Drive API and sends it to Claude for BOM extraction.

## Quick Reference

| What you have | What to do |
|---|---|
| Customer name | Search HubSpot deals by name |
| PROJ number (e.g. PROJ-9009) | Search HubSpot deals, query "9009" |
| HubSpot deal | Fetch `design_documents` property → extract folder ID from URL |
| `design_documents` URL | Extract folder ID → list children → find "Stamped Plans" |
| `all_document_parent_folder_id` | List children → find "2. Design" → find "Stamped Plans" |
| Stamped Plans folder link | Share with user or extract file ID for BOM tool |

## Auth Boundary

`/api/bom/drive-files` requires a logged-in user session (Google OAuth cookie). It **cannot** be called unauthenticated from a Claude chat session.

**To trigger PDF listing from the BOM tool UI** (no auth needed in chat):
```
/dashboards/bom?deal=HUBSPOT_DEAL_ID
```
The UI auto-links the deal and loads design files using the user's session.

**To run `planset-bom` in-chat**, the user must share a direct Drive file link or file ID from the BOM tool's "📁 Design Folder" tab.

## Common Issues

**Empty search results for PROJ-XXXX:** The Drive search doesn't index by PROJ number. Search HubSpot for the deal first, then use the folder ID from HubSpot.

**`design_documents` not populated:** Use `all_document_parent_folder_id` and navigate manually — the "2. Design" subfolder is always present.

**Can't list PDFs in the folder:** The Google Drive MCP only supports Google Docs. Provide the `web_view_link` of "Stamped Plans" to the user so they can share the PDF link themselves, or ask them to paste the share URL.
