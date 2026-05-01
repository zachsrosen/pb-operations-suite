import { getServiceAccountToken } from "@/lib/google-auth";
import { ISSUE_TYPES } from "@/lib/on-call-call-log";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const ISSUE_LABEL = new Map<string, string>(ISSUE_TYPES.map((t) => [t.value, t.label]));

const HEADERS = [
  "Date",
  "Time",
  "Pool",
  "Region",
  "Electrician",
  "Customer",
  "Issue Type",
  "Issue Detail",
  "Safety Risk",
  "Home Has Power",
  "Troubleshooting",
  "Resolved Remotely",
  "Dispatched",
  "Arrival",
  "Completion",
  "Hours Worked",
  "Escalated To",
  "Notes",
  "Outcome",
];

type CallLogRecord = {
  callReceivedAt: Date;
  customerName: string;
  issueType: string;
  issueTypeOther: string | null;
  safetyRisk: boolean;
  homeHasPower: boolean | null;
  troubleshootingAttempted: string | null;
  resolvedRemotely: boolean;
  dispatched: boolean;
  arrivalAt: Date | null;
  completedAt: Date | null;
  hoursWorked: { toString(): string } | string | number | null;
  escalatedTo: string | null;
  notes: string | null;
  reporterCrewMember: { name: string };
  pool: { name: string; region: string; timezone: string };
};

type SheetsMetadata = {
  sheets?: Array<{
    properties?: {
      title?: string;
      index?: number;
    };
  }>;
};

async function getSheetsToken(): Promise<string> {
  const impersonateEmail = process.env.GOOGLE_ADMIN_EMAIL ?? process.env.GMAIL_SENDER_EMAIL;
  if (impersonateEmail) {
    try {
      return await getServiceAccountToken([SHEETS_SCOPE], impersonateEmail);
    } catch {
      // Domain-wide delegation is optional; fall back to direct service account access.
    }
  }
  return getServiceAccountToken([SHEETS_SCOPE]);
}

async function getFirstSheetTitle(baseUrl: string, token: string): Promise<string> {
  const res = await fetch(`${baseUrl}?fields=sheets(properties(title,index))`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Sheets metadata ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as SheetsMetadata;
  const title = (data.sheets ?? [])
    .map((sheet) => sheet.properties)
    .filter((props): props is { title: string; index?: number } => Boolean(props?.title))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0]?.title;

  if (!title) throw new Error("Sheets metadata did not include any sheet tabs");
  return title;
}

function rangeFor(sheetTitle: string, range: string): string {
  const escapedTitle = sheetTitle.replace(/'/g, "''");
  return encodeURIComponent(`'${escapedTitle}'!${range}`);
}

function formatDateTime(
  d: Date,
  timezone: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  try {
    return d.toLocaleString("en-US", { ...opts, timeZone: timezone });
  } catch {
    return d.toLocaleString("en-US", { ...opts, timeZone: "America/Denver" });
  }
}

function fmtDate(d: Date, timezone: string): string {
  return formatDateTime(d, timezone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function fmtTime(d: Date, timezone: string): string {
  return formatDateTime(d, timezone, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function yesNo(v: boolean): string {
  return v ? "Yes" : "No";
}

function hoursToCell(value: CallLogRecord["hoursWorked"]): string {
  if (value == null) return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : value.toString();
}

function buildRow(log: CallLogRecord): string[] {
  const timezone = log.pool.timezone || "America/Denver";
  return [
    fmtDate(log.callReceivedAt, timezone),
    fmtTime(log.callReceivedAt, timezone),
    log.pool.name,
    log.pool.region,
    log.reporterCrewMember.name,
    log.customerName,
    ISSUE_LABEL.get(log.issueType) ?? log.issueType,
    log.issueTypeOther ?? "",
    yesNo(log.safetyRisk),
    log.homeHasPower === true ? "Yes" : log.homeHasPower === false ? "No" : "Didn't ask",
    log.troubleshootingAttempted ?? "",
    yesNo(log.resolvedRemotely),
    yesNo(log.dispatched),
    log.arrivalAt ? fmtTime(log.arrivalAt, timezone) : "",
    log.completedAt ? fmtTime(log.completedAt, timezone) : "",
    hoursToCell(log.hoursWorked),
    log.escalatedTo ?? "",
    log.notes ?? "",
    log.resolvedRemotely ? "Resolved remotely" : log.dispatched ? "Dispatched" : "Follow-up needed",
  ];
}

export async function appendCallLogToSheet(log: CallLogRecord): Promise<void> {
  const sheetId = process.env.ONCALL_HR_SHEET_ID;
  if (!sheetId) return;

  const token = await getSheetsToken();
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  const sheetTitle = await getFirstSheetTitle(baseUrl, token);

  const headerRes = await fetch(`${baseUrl}/values/${rangeFor(sheetTitle, "A1:S1")}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!headerRes.ok) {
    throw new Error(`Sheets header read ${headerRes.status}: ${await headerRes.text()}`);
  }

  const headerData = (await headerRes.json()) as { values?: string[][] };
  const hasHeaders = Boolean(headerData.values?.[0]?.length);

  if (!hasHeaders) {
    const writeHeaderRes = await fetch(
      `${baseUrl}/values/${rangeFor(sheetTitle, "A1:S1")}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: [HEADERS] }),
      },
    );
    if (!writeHeaderRes.ok) {
      throw new Error(`Sheets header write ${writeHeaderRes.status}: ${await writeHeaderRes.text()}`);
    }
  }

  const appendRes = await fetch(
    `${baseUrl}/values/${rangeFor(sheetTitle, "A1:S1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [buildRow(log)] }),
    },
  );

  if (!appendRes.ok) {
    throw new Error(`Sheets append ${appendRes.status}: ${await appendRes.text()}`);
  }
}
