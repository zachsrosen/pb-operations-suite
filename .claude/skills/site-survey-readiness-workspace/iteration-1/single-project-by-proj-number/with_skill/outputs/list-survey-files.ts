import "dotenv/config";
import { getServiceAccountToken } from "../../../../../../../../src/lib/google-auth";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

async function getDriveToken(): Promise<string> {
  const impersonateEmail = process.env.GOOGLE_ADMIN_EMAIL ?? process.env.GMAIL_SENDER_EMAIL;
  if (impersonateEmail) {
    try {
      return await getServiceAccountToken(
        ["https://www.googleapis.com/auth/drive.readonly"],
        impersonateEmail,
      );
    } catch { }
  }
  return getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"]);
}

async function listFolder(folderId: string, token: string): Promise<DriveFile[]> {
  const query = `'${folderId}' in parents and trashed=false`;
  const fields = "files(id,name,mimeType,modifiedTime,size)";
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&pageSize=100`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { files: DriveFile[] };
  return data.files ?? [];
}

async function listRecursive(
  folderId: string,
  token: string,
  path: string = "",
): Promise<{ path: string; file: DriveFile }[]> {
  const files = await listFolder(folderId, token);
  let all: { path: string; file: DriveFile }[] = [];

  for (const f of files) {
    const fullPath = path ? `${path}/${f.name}` : f.name;
    if (f.mimeType === "application/vnd.google-apps.folder") {
      const children = await listRecursive(f.id, token, fullPath);
      all = all.concat(children);
    } else {
      all.push({ path: fullPath, file: f });
    }
  }
  return all;
}

async function main() {
  const token = await getDriveToken();

  // Site survey documents folder from HubSpot
  const ssSurveyFolderId = "1WBSjDm8_3Ov8aiW5oBnGfDy59h7IBFV-";

  const files = await listRecursive(ssSurveyFolderId, token, "1. Site Survey");

  console.log(
    JSON.stringify(
      files.map((f) => ({
        path: f.path,
        name: f.file.name,
        mimeType: f.file.mimeType,
        modified: f.file.modifiedTime,
        size: f.file.size,
      })),
      null,
      2,
    ),
  );

  console.log(`\nTotal files: ${files.length}`);
}

main().catch(console.error);
