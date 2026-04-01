#!/usr/bin/env node
/**
 * Count install photos in Google Drive for construction-complete deals.
 *
 * Usage: node scripts/count-install-photos.mjs
 * Requires: .env with GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, GOOGLE_ADMIN_EMAIL
 */

import crypto from "crypto";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env") });

// ---- Google Auth (mirror of lib/google-auth.ts) ----

function base64UrlEncode(str) {
  return Buffer.from(str).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function parsePrivateKey(raw) {
  const normalizedRaw = raw.replace(/\\n/g, "\n").trim();
  if (normalizedRaw.includes("-----BEGIN")) return normalizedRaw;
  const decoded = Buffer.from(raw, "base64").toString("utf-8");
  const normalizedDecoded = decoded.replace(/\\n/g, "\n").trim();
  if (normalizedDecoded.includes("-----BEGIN")) return normalizedDecoded;
  return normalizedRaw;
}

async function signRS256(input, privateKeyPem) {
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(input);
  sign.end();
  const sig = sign.sign(privateKeyPem, "base64");
  return sig.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const impersonate = process.env.GOOGLE_ADMIN_EMAIL || process.env.GMAIL_SENDER_EMAIL;

  if (!email || !rawKey) throw new Error("Missing Google SA credentials in .env");

  const privateKey = parsePrivateKey(rawKey);
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  if (impersonate) claims.sub = impersonate;

  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify(claims));
  const sig = await signRS256(`${header}.${payload}`, privateKey);
  const jwt = `${header}.${payload}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) throw new Error(`Token error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// ---- Drive Image Counting ----

const IMAGE_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
];
const IMAGE_QUERY = IMAGE_TYPES.map(t => `mimeType='${t}'`).join(" or ");

async function driveList(query, fields = "files(id,name,mimeType)") {
  const token = await getToken();
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    `&fields=nextPageToken,${encodeURIComponent(fields)}` +
    `&pageSize=1000` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    if (res.status === 404) return [];
    if (res.status === 429) {
      // Rate limit — wait and retry once
      await new Promise(r => setTimeout(r, 2000));
      const retry = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}` } });
      if (!retry.ok) return [];
      const rd = await retry.json();
      return rd.files ?? [];
    }
    return [];
  }

  const data = await res.json();
  return data.files ?? [];
}

async function countImagesRecursive(folderId, maxDepth = 3, depth = 0) {
  if (depth > maxDepth) return 0;

  let count = 0;

  // Count images at this level
  const query = `'${folderId}' in parents and (${IMAGE_QUERY}) and trashed=false`;
  const images = await driveList(query, "files(id)");
  count += images.length;

  // Get subfolders and recurse
  const folderQuery = `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const subfolders = await driveList(folderQuery, "files(id,name)");

  for (const sub of subfolders) {
    count += await countImagesRecursive(sub.id, maxDepth, depth + 1);
  }

  return count;
}

// ---- Deal Data ----

// All 145 construction-complete deals in 2026 Q1
const DEALS = [
  // January
  { id: "13226257699", proj: "PROJ-4876", name: "Johnson, Connor", loc: "San Luis Obispo", date: "2026-01-02", folder: "" },
  { id: "42651746563", proj: "PROJ-8513", name: "Oram, Craig", loc: "Centennial", date: "2026-01-07", folder: "1JBypOIFpwPK4b4cyKA_zCsrcrk4UEw8x" },
  { id: "41809680938", proj: "PROJ-8679", name: "Dent, John", loc: "San Luis Obispo", date: "2026-01-08", folder: "1dTlKnHBxTq2EQFY96RKeABj58N2DsGv4" },
  { id: "39116272203", proj: "PROJ-8180", name: "Goska, Anthony", loc: "Centennial", date: "2026-01-08", folder: "1j5PDM0OObs6XOsPsmxw8D-zbQYcfhh3E" },
  { id: "45371131267", proj: "PROJ-8721", name: "Henry, Edward", loc: "San Luis Obispo", date: "2026-01-08", folder: "1eFljDfpYxRANZsHx0HXrurc9ArTxSnD1" },
  { id: "45446304791", proj: "PROJ-8722", name: "Henry, Christine", loc: "San Luis Obispo", date: "2026-01-08", folder: "12FFnvuBcTJ_OYzW8gUY0C5S1mSyun4Rc" },
  { id: "34201738365", proj: "PROJ-7797", name: "Reiss, Thomas", loc: "San Luis Obispo", date: "2026-01-08", folder: "1yCdu8UY1_FhezTLPNE-aMotalVd5D04j" },
  { id: "39933714957", proj: "PROJ-8323", name: "Wilkin, Nick", loc: "Centennial", date: "2026-01-09", folder: "1wcJ6t4sXrfVp4ygUw567u5EemTRXZ5t9" },
  { id: "32819950628", proj: "PROJ-8412", name: "Junker, Thomas", loc: "Centennial", date: "2026-01-09", folder: "1gaBdlCJ3KDnIh0jI4GN8tgbZR3lvr4xm" },
  { id: "42045575067", proj: "PROJ-8553", name: "Buck-Macleod, Ian", loc: "San Luis Obispo", date: "2026-01-09", folder: "1RFileyuBJmhcb6WyoPtZLdeI3ftGyNgS" },
  { id: "43499637109", proj: "PROJ-8635", name: "Bayless, Greg", loc: "Camarillo", date: "2026-01-12", folder: "1lqCaO6gC-xqv9Os1iAraKVglTyXDePBE" },
  { id: "42973689097", proj: "PROJ-8659", name: "Hahn, Sandy", loc: "Centennial", date: "2026-01-12", folder: "1Bi3uNcPbbTuU-DJF9N1XNHzCR8b1w3zk" },
  { id: "34296641347", proj: "PROJ-8424", name: "Wandishin, Jeff", loc: "Centennial", date: "2026-01-13", folder: "1Rq6nxWderiiq6RizSp1Wo4w5qvV_kqmj" },
  { id: "43170798722", proj: "PROJ-8594", name: "SAGE, SOM CHAI", loc: "Colorado Springs", date: "2026-01-15", folder: "1Zwi1C1GoiLqsR_Dj14dBJj3nTb7ihZK9" },
  { id: "43216836975", proj: "PROJ-8654", name: "Lingle, Sam", loc: "Colorado Springs", date: "2026-01-16", folder: "1nl1p0B8Ck7cJpGX1lmUiCDP0jshadzFa" },
  { id: "41148554057", proj: "PROJ-8395", name: "Wu, DOMINIC", loc: "Camarillo", date: "2026-01-20", folder: "1TFcFQNgp_6SaJ-OfZukpEavP2rz8XkFm" },
  { id: "18872830551", proj: "PROJ-7075", name: "Miller, Jason", loc: "Centennial", date: "2026-01-20", folder: "" },
  { id: "32743168407", proj: "PROJ-7634", name: "American Water Works Association", loc: "Centennial", date: "2026-01-23", folder: "1Gn7J5Pe5_zZm_YB9k1-9XUPXW307WA9-" },
  { id: "13126218378", proj: "PROJ-6839", name: "Whittier Place, Reconstruction Experts", loc: "Westminster", date: "2026-01-23", folder: "" },
  { id: "41600411820", proj: "PROJ-8512", name: "Merrick, Julie", loc: "Westminster", date: "2026-01-23", folder: "1f-HB-OQ1mScmVRFQoZbwVZ2KbjNhTUn5" },
  { id: "42073940556", proj: "PROJ-8518", name: "Neal, James", loc: "Centennial", date: "2026-01-27", folder: "1jedH-N1qwhNVEXzvB03rN5ywxTqjuxHy" },
  { id: "46427629876", proj: "PROJ-8783", name: "Cantwell, Sean", loc: "Westminster", date: "2026-01-27", folder: "1qoupwx-ryCUrwzEYLOHj6MvhkECsUkGR" },
  { id: "43946261506", proj: "PROJ-8697", name: "Castillo, David", loc: "Camarillo", date: "2026-01-28", folder: "13ktufCIwSpJs9lcQSHXBdmhCHBDdbR5k" },
  { id: "42725891186", proj: "PROJ-8535", name: "Amery, Heather", loc: "Centennial", date: "2026-01-28", folder: "1H54n2PDnyYS4WafgHAUsW_L2TOwMYP7I" },
  { id: "42048118141", proj: "PROJ-8724", name: "Weyerman, Shane", loc: "Centennial", date: "2026-01-30", folder: "1Q5YYjPcKW7WPr3HCLp_V2kpHvfjrDcju" },
  { id: "43114949791", proj: "PROJ-8629", name: "Hewitt, Keith", loc: "Centennial", date: "2026-01-30", folder: "1cPfrDThrZF-836IZgDHeXk_gmmaD4yjp" },
  { id: "42568336245", proj: "PROJ-8489", name: "Hidalgo, Dave", loc: "Westminster", date: "2026-01-30", folder: "14LlbrdCSCQiM5bi8cffx1kWpIuEb6S85" },
  // February
  { id: "29846655361", proj: "PROJ-7298", name: "Eskelin, John", loc: "San Luis Obispo", date: "2026-02-02", folder: "1m_JXaSCermq4IK7RDngTgnJ_qHp4Y3_3" },
  { id: "41434163825", proj: "PROJ-8596", name: "Eckert, Dieter", loc: "San Luis Obispo", date: "2026-02-02", folder: "1WUPGBVcTuQySonyc1XQ-H9XHEYkBRo9x" },
  { id: "49792683926", proj: "PROJ-8853", name: "Clark, Jonathan", loc: "Centennial", date: "2026-02-03", folder: "1pXIFtTDQpjfIzRWZZw3X6ajDKQbgG6TR" },
  { id: "34669853762", proj: "PROJ-8521", name: "Mahaffey, Matthew", loc: "Westminster", date: "2026-02-03", folder: "1XYmumc6X-6_lC2DUAxGW6JCistJ8hPvw" },
  { id: "41583167666", proj: "PROJ-8558", name: "Griffith, Bradley", loc: "Centennial", date: "2026-02-05", folder: "1Q0E7yAQM1KgGAr-FSpBx3bnpsNdkFri6" },
  { id: "52474068069", proj: "PROJ-8897", name: "Rose, David", loc: "Westminster", date: "2026-02-05", folder: "1EN6yApPhTlD_MtfxMrizSX-EB8ta8Iro" },
  { id: "33719541677", proj: "PROJ-7777", name: "Slater, Jami", loc: "Westminster", date: "2026-02-05", folder: "1m_oDdUlqrymH_PzrBmIpwRL783HtUpCI" },
  { id: "31948825672", proj: "PROJ-8790", name: "St John, Robert", loc: "Centennial", date: "2026-02-06", folder: "1Kdc6dYVSPKLaeKnbLDyw_3lEhNoyoLWk" },
  { id: "21567787677", proj: "PROJ-8069", name: "Strong, Jessica", loc: "San Luis Obispo", date: "2026-02-09", folder: "" },
  { id: "43487863931", proj: "PROJ-8650", name: "Rosell, Sean", loc: "Centennial", date: "2026-02-10", folder: "10Pie0SVrS1YWClToCqu1fV1HgyQN2XTX" },
  { id: "48177770077", proj: "PROJ-8834", name: "Haas, James", loc: "Centennial", date: "2026-02-10", folder: "1giGAQ5DwGOOYCWAwao1w7fb0oLW_TYOc" },
  { id: "45767512931", proj: "PROJ-8789", name: "KAMINSKY, BENJAMIN", loc: "Westminster", date: "2026-02-10", folder: "1z90-ROALGgKMh7TXc-EFAJKFABPnZLZR" },
  { id: "43784573251", proj: "PROJ-8694", name: "Morales, Michelle", loc: "Centennial", date: "2026-02-13", folder: "1UZJ_GGGt7JOMiimETaBps194xyhYZfaM" },
  { id: "54991688013", proj: "PROJ-9044", name: "Latino, Carlo", loc: "San Luis Obispo", date: "2026-02-13", folder: "1c2lYXm8W4o4oZ3YadaxflDSDzKnv_C_-" },
  { id: "42755755408", proj: "PROJ-8609", name: "Case, Jared", loc: "Camarillo", date: "2026-02-17", folder: "1fbH0t5nCRduikBdFIHPyKepMwIHOpIPF" },
  { id: "53131685682", proj: "PROJ-8966", name: "HAYCRAFT, JEANNIE", loc: "Centennial", date: "2026-02-18", folder: "1oryigJjA26c-ZAN123BpdqVU-8CfQuiy" },
  { id: "55356823672", proj: "PROJ-9064", name: "Haycraft, Gregg", loc: "Centennial", date: "2026-02-18", folder: "18Hl_k7WbkYCK8F9jn2xwNJ9__dNFUzIr" },
  { id: "38852005018", proj: "PROJ-8095", name: "Rosen, Zach", loc: "Centennial", date: "2026-02-18", folder: "1cku4HoCE7o-SYReS631nlqTfDY2cYpzw" },
  { id: "44106432085", proj: "PROJ-8798", name: "ROWLEY, CHRISTOPHER", loc: "Westminster", date: "2026-02-18", folder: "1JeHglFpBsjNrb339ubI7ePAH7kNnTf2D" },
  { id: "15941713193", proj: "PROJ-8934", name: "Beckett, William", loc: "Westminster", date: "2026-02-18", folder: "" },
  { id: "45155019946", proj: "PROJ-8763", name: "Wiggins, Pamela", loc: "Colorado Springs", date: "2026-02-19", folder: "18bLdjcQbmUnwLsq0lX6FI6coGgq_und_" },
  { id: "48475133869", proj: "PROJ-8810", name: "Rahane, Annasaheb", loc: "Camarillo", date: "2026-02-20", folder: "1Ge_D3o3nmc24CeUZktAhJA_iLOMeAA5E" },
  { id: "52248960812", proj: "PROJ-8901", name: "EDDY, MEGHAN", loc: "Centennial", date: "2026-02-20", folder: "1g7NpP-Bnh7X6lAoZCBWpPRnUppQEl9aN" },
  { id: "52071909996", proj: "PROJ-8915", name: "Sjostrom, Bradley", loc: "Centennial", date: "2026-02-20", folder: "1HAsQa9USKgjNmPfOk8Y_sxxUfQmBMpzQ" },
  { id: "52836777632", proj: "PROJ-8987", name: "SKIGEN, SARAH", loc: "Westminster", date: "2026-02-20", folder: "1rf3YtP4g2RmTYlPxoTKwQaQz9Hjh9XW7" },
  { id: "39049084790", proj: "PROJ-8128", name: "Martin, Annette", loc: "Westminster", date: "2026-02-20", folder: "1EyfH7dmhIsLryEmdDlMSyuvU-cvsSqUn" },
  { id: "46825526853", proj: "PROJ-8771", name: "Rassokhin, Vasily", loc: "Westminster", date: "2026-02-20", folder: "1Ij9fHqOrWpnaI_dVA8dzm-4np7guBD8N" },
  { id: "55410669488", proj: "PROJ-9093", name: "Marie Lopes, Teresa", loc: "San Luis Obispo", date: "2026-02-20", folder: "1hDrIdI3zJ7XXxp74clSP6l7tW8wf_3qr" },
  { id: "53501152385", proj: "PROJ-8979", name: "Koken, Daniel", loc: "Centennial", date: "2026-02-23", folder: "1_h_uVtLme1cncU3SboZxDBMQpzM_gsAJ" },
  { id: "52386016931", proj: "PROJ-8980", name: "Lenick, Christine", loc: "Centennial", date: "2026-02-23", folder: "1OPb9cDasl4_R6Jot9V1URD7fpb5WiTCf" },
  { id: "55582585513", proj: "PROJ-9067", name: "Robinson, JOSEPH", loc: "Westminster", date: "2026-02-23", folder: "1oPNt5i87PIw1-0i2fh0eFaLtmkGnHvh7" },
  { id: "48169564958", proj: "PROJ-8821", name: "Kelm, Derek", loc: "Westminster", date: "2026-02-23", folder: "1GpCZPQpPko5btJw4vDfRVYgwEci8JT7l" },
  { id: "54220428468", proj: "PROJ-9017", name: "Hassinger, Jon", loc: "Centennial", date: "2026-02-24", folder: "1RqHyjvBCRaWd_HBRlU_HVjptOtahDeLp" },
  { id: "12154128687", proj: "PROJ-8618", name: "Miller, Tamara", loc: "Centennial", date: "2026-02-24", folder: "" },
  { id: "45151434504", proj: "PROJ-8723", name: "Baker, Bradley", loc: "Colorado Springs", date: "2026-02-25", folder: "1Ur1Paly8Hx7jW7m5eCqPEaHSq11Id-fg" },
  { id: "52223252228", proj: "PROJ-8900", name: "Kelly, Jason", loc: "Westminster", date: "2026-02-25", folder: "1mQJJMnBlOlLgxJCVBIOzBKFRcU6xImdp" },
  { id: "43562208539", proj: "PROJ-8634", name: "Bryan, Jake", loc: "San Luis Obispo", date: "2026-02-25", folder: "1IZWI-FyvSPntmSSOIvFFHZ5P75WX0iw3" },
  { id: "35133791026", proj: "PROJ-7932", name: "Frantz, John", loc: "San Luis Obispo", date: "2026-02-25", folder: "1iNmOF8-6brlIv4rjiOh0LNR1dYl1828w" },
  { id: "55680915717", proj: "PROJ-9092", name: "Chorny, Joe", loc: "Centennial", date: "2026-02-26", folder: "1FKon28BLLx8vRGJgn8MEP73xAIiaSlR9" },
  { id: "49007887125", proj: "PROJ-8860", name: "Parker, Albert", loc: "Centennial", date: "2026-02-26", folder: "18qscm11snayImMXUS4Q-yoJovDtrJcde" },
  { id: "44403374344", proj: "PROJ-8704", name: "Burnham, Benjamin", loc: "Westminster", date: "2026-02-26", folder: "1KclxGXIrJpX63NjVfZ--NmVREC5LLEsM" },
  { id: "52865379253", proj: "PROJ-8936", name: "Packer, WILLIAM", loc: "Westminster", date: "2026-02-26", folder: "1S0T7mP_ehry4ZmFF_rNZAtRwaW0u-4uz" },
  { id: "52390853461", proj: "PROJ-8911", name: "Varghese, Julian", loc: "Westminster", date: "2026-02-26", folder: "18j2XVa25t7mac9TNq_at_ED0PAvxSOjQ" },
  { id: "52397662312", proj: "PROJ-8918", name: "Dripps, David", loc: "Westminster", date: "2026-02-26", folder: "1D2SdwKdCOtiT7p7pGXMX_BUqSwPhSn6K" },
  { id: "54239022600", proj: "PROJ-9046", name: "Bryan, Jake", loc: "San Luis Obispo", date: "2026-02-26", folder: "1a1Ssl4uAFwl7lnRNRRSCPtBZFnsJsIpH" },
  { id: "42265220259", proj: "PROJ-8540", name: "Lynes, Billie", loc: "San Luis Obispo", date: "2026-02-26", folder: "1s6IIKJJd9z_l_EELqK9xZvg5Amwmn-So" },
  { id: "43711803674", proj: "PROJ-8686", name: "Maddox, Glenn", loc: "Colorado Springs", date: "2026-02-27", folder: "1rj0TZ6Cff2b0kXwAOhd8Lnwvj8TGpI-L" },
  { id: "53079995212", proj: "PROJ-8971", name: "Reinhart, Mark", loc: "Westminster", date: "2026-02-27", folder: "1hu0vcWt9DjsmpgUXr5bgds2Xw7_yK-q4" },
  { id: "56006450346", proj: "PROJ-9490", name: "Nenow, Andrew", loc: "San Luis Obispo", date: "2026-02-27", folder: "1ENqgxkhn-M_KA8xw_9r8fihb2Ro8lPqY" },
  { id: "51930719144", proj: "PROJ-8883", name: "Nenow, Andrew", loc: "San Luis Obispo", date: "2026-02-27", folder: "1UvoAdCcoa6nCKai5qYi9MI4DKMW8po2L" },
  // March
  { id: "54110046247", proj: "PROJ-9009", name: "Wang, XIAODONG", loc: "Centennial", date: "2026-03-02", folder: "1g5H8T0HsbPdw9kwjyeUlpMrAV5LWYVtD" },
  { id: "21136538505", proj: "PROJ-8613", name: "Mones, Amanda", loc: "Westminster", date: "2026-03-03", folder: "" },
  { id: "53347131515", proj: "PROJ-8933", name: "Fincher, Jan", loc: "Westminster", date: "2026-03-03", folder: "1AlE4MPGJEBkNFW9h1mECyz-Y5RT3WO2c" },
  { id: "53407883872", proj: "PROJ-9012", name: "Gompf, Robert", loc: "Westminster", date: "2026-03-04", folder: "1g3oYPifcK7lhBZus1lkgkagNHZ1HAV1l" },
  { id: "50895749181", proj: "PROJ-8881", name: "Pyziak, David M", loc: "Colorado Springs", date: "2026-03-05", folder: "1mWaIFgQPwIYfTfLQPEnbVl82f4utV29W" },
  { id: "43907266442", proj: "PROJ-8813", name: "Kraft, Joel", loc: "Centennial", date: "2026-03-05", folder: "11J0twL36zzsRVo9_j6I1_jdYfcCV0wi7" },
  { id: "54233472943", proj: "PROJ-9054", name: "Schanhals, Aaron", loc: "Westminster", date: "2026-03-05", folder: "1xwFVyef1P5zpZ29aCNy9AMYTQjayaS62" },
  { id: "44570124914", proj: "PROJ-8729", name: "Novosad, Sean", loc: "Westminster", date: "2026-03-05", folder: "1CSeshGb_vVsNIxZdX4GcXYAsMqAbzCsW" },
  { id: "43526135415", proj: "PROJ-8862", name: "Snyder, Matthew", loc: "Centennial", date: "2026-03-06", folder: "1z2A1l_Hvlk35TR5H8nnKsC2pjyhXwfqE" },
  { id: "53646269969", proj: "PROJ-9022", name: "Pearson, Ronald", loc: "Centennial", date: "2026-03-09", folder: "1URmeJ6bgQ5a20bzdpFY7DABwsxnG8T4m" },
  { id: "53412268712", proj: "PROJ-8952", name: "Blondeau, Donna", loc: "Westminster", date: "2026-03-09", folder: "1cg1bCgbPQFs55lik7E5ffQ5HdSWOlVvI" },
  { id: "52384418094", proj: "PROJ-8905", name: "Pearson, LESLIE", loc: "Centennial", date: "2026-03-10", folder: "1vEWHVV9TbngwcXNTyIouniWkffpzhOiL" },
  { id: "55703569414", proj: "PROJ-9468", name: "Johnston, Jeanette", loc: "San Luis Obispo", date: "2026-03-10", folder: "1hlnX_LGd7P2tQavF_Wdju6fAWqlbJEmT" },
  { id: "51956310800", proj: "PROJ-8903", name: "Martinez, Ricardo", loc: "Centennial", date: "2026-03-11", folder: "13jTjTV5t765Laodd5ACJ9Z5UOYa0haxB" },
  { id: "54314991412", proj: "PROJ-9058", name: "McGrath, Dennis", loc: "Centennial", date: "2026-03-11", folder: "1AH_9sBDeV0_OOJcmKsvaR32bU0SKUH_E" },
  { id: "51527015294", proj: "PROJ-8942", name: "Zito, Heather", loc: "Westminster", date: "2026-03-11", folder: "1FyU6KqVFfHvRNaB5oojJKMNT9x7u0pge" },
  { id: "41893564057", proj: "PROJ-8449", name: "He, Steven", loc: "Centennial", date: "2026-03-12", folder: "1CDd3YnGch2wuoCnTo9Jgc8bhbmkpXCdm" },
  { id: "54267085961", proj: "PROJ-9020", name: "Markland, Wade", loc: "Westminster", date: "2026-03-12", folder: "1HHMT88a5UpXuBqyytSvBlSXNcrbYJJri" },
  { id: "53078911121", proj: "PROJ-8977", name: "Sheldon, John", loc: "Westminster", date: "2026-03-12", folder: "1LCErpnNt2PCMRnpmSx-2PRKrpv8qZyq1" },
  { id: "53261368987", proj: "PROJ-8969", name: "Dippo, PATRICIA", loc: "Centennial", date: "2026-03-13", folder: "1baTDzGb78CcA-_96-NSreRh7AF-v2VG8" },
  { id: "54481110457", proj: "PROJ-9043", name: "Law, Kelly", loc: "Westminster", date: "2026-03-13", folder: "1C3iQAdMlF2uYoTLYjmSP1-bwhxUxILrb" },
  { id: "43483187506", proj: "PROJ-8702", name: "Schaub, Kevin", loc: "Westminster", date: "2026-03-13", folder: "1aa28e1LM8decBhApCvZAF0BKU4Gwqecf" },
  { id: "52252665407", proj: "PROJ-9066", name: "Randles, Nick", loc: "Centennial", date: "2026-03-16", folder: "1xznk0h4qpwt27MX5SiUpaVO9T58Tncpp" },
  { id: "35676030801", proj: "PROJ-8539", name: "Anderson, Niles", loc: "Westminster", date: "2026-03-16", folder: "1BPvraX3kHun0KFX1NvlwnU6Kxa75ht88" },
  { id: "11759644531", proj: "PROJ-8847", name: "Goltermann, Andrew", loc: "Centennial", date: "2026-03-17", folder: "" },
  { id: "53787983704", proj: "PROJ-9015", name: "Turner, Alex", loc: "Centennial", date: "2026-03-17", folder: "1UORqa6KYvxfkmWcp2Z_Bg3_mO1E2EeBS" },
  { id: "53782899356", proj: "PROJ-9456", name: "Nuccio, Vito", loc: "Centennial", date: "2026-03-17", folder: "1vr5cbHlXmdcUG-uzRxris1D9UMV_uQsZ" },
  { id: "52844039493", proj: "PROJ-9045", name: "Meier, Sandra", loc: "Westminster", date: "2026-03-17", folder: "1RqBcY9ljn9E_AmlSCufD6erroeM27Ngv" },
  { id: "37165737473", proj: "PROJ-8519", name: "Emerle, Rebecca", loc: "Westminster", date: "2026-03-17", folder: "1uvkxcmwsTL7df6o20kUy1VRz3v3G4qNc" },
  { id: "55042437445", proj: "PROJ-9060", name: "Rifkin, John", loc: "Westminster", date: "2026-03-17", folder: "1HoJGtLlA4niiefeCnfZnaO0aWfJrEV3t" },
  { id: "46048497773", proj: "PROJ-8778", name: "Rees, Christiaan", loc: "Colorado Springs", date: "2026-03-18", folder: "1EdFXMSBwnvYX2UJNyYwEq5fyC242Qi3V" },
  { id: "39259676559", proj: "PROJ-8788", name: "Rowe, Brian", loc: "Colorado Springs", date: "2026-03-18", folder: "1kjmnNHdRgzEKEv9NbPzBM-Zdu8tlZXPU" },
  { id: "49134683809", proj: "PROJ-8832", name: "Harris, Robert", loc: "Camarillo", date: "2026-03-18", folder: "1WDIJJp7mIV803nGdBN_mSI3ejRSf1Sgz" },
  { id: "55481445026", proj: "PROJ-9074", name: "Okuneff, Larry", loc: "Centennial", date: "2026-03-18", folder: "1KQlJjrxF4HfpKBKUytezaxirN1jRDLkx" },
  { id: "52386673939", proj: "PROJ-8940", name: "Hacker, MIRIAM", loc: "Westminster", date: "2026-03-18", folder: "1dsBE6U0GSdX7EZywrxYm7EYAhzxjax9l" },
  { id: "42969550992", proj: "PROJ-8632", name: "Johnston, Jeanette", loc: "San Luis Obispo", date: "2026-03-18", folder: "1WgkhgrUJLviAUpkJjXBQbXsWRMZvIXIv" },
  { id: "58144981061", proj: "PROJ-9586", name: "TEST Rosen, Caleb", loc: "San Luis Obispo", date: "2026-03-18", folder: "1CQ4aIRT62doH5CehZzjCcPjDHenbcS0_" },
  { id: "45192777353", proj: "PROJ-8793", name: "Whitmore, Joshua", loc: "Centennial", date: "2026-03-19", folder: "1VJQIGFPfs9q9jtgwsPACPBKUt-ZOulSk" },
  { id: "43067096885", proj: "PROJ-8743", name: "Gantman, Marissa", loc: "Westminster", date: "2026-03-19", folder: "1ZYU5_XGJlg2jpaGQtiKpgfUtL7FpsVno" },
  { id: "49090021780", proj: "PROJ-8829", name: "Ridings, Nick", loc: "Westminster", date: "2026-03-19", folder: "1GGlJqZyt7ofrxwXGl2iK_UQioY_3V2pb" },
  { id: "53692717960", proj: "PROJ-9016", name: "Aung, Tin", loc: "Colorado Springs", date: "2026-03-20", folder: "1gRR_8CKVfVLTgBeOR9_2_Sz7fCiBqXri" },
  { id: "53251048250", proj: "PROJ-9034", name: "White, Frank", loc: "Centennial", date: "2026-03-20", folder: "1Jn6s0qzgBUHXuwWt88olVW7gW4MYUe4K" },
  { id: "45080982280", proj: "PROJ-8764", name: "Jones, Corey", loc: "Centennial", date: "2026-03-20", folder: "1xledWbmu2f8cJNWamasTv2_LE7YXim6Y" },
  { id: "54628588969", proj: "PROJ-9061", name: "Dierking, Keith", loc: "Centennial", date: "2026-03-20", folder: "1tRslLpCLQ0LOp5DmRTs3dKyTMQiSPbnw" },
  { id: "54693664282", proj: "PROJ-9077", name: "Wahr, Kathleen", loc: "Westminster", date: "2026-03-20", folder: "1zM9NrAjhqmSCry9sIWZDzxVfjL83iD5X" },
  { id: "44465115663", proj: "PROJ-8691", name: "Kleinman, Aaron", loc: "Westminster", date: "2026-03-20", folder: "1F64iS4CqMIvUN_2YXMtNb2RClz2ODqNQ" },
  { id: "16490701650", proj: "PROJ-6351", name: "Matt Gamarra, Bread Bike", loc: "San Luis Obispo", date: "2026-03-20", folder: "1-QIHTlxK1Pq8BqB4f2NAoc6IqdkWvPNj" },
  { id: "56254059185", proj: "PROJ-9475", name: "Slagle, Matthew", loc: "Westminster", date: "2026-03-23", folder: "1z-sUBLXqEXK4zf8N82Fjz2HlS9VKYGsQ" },
  { id: "38866623353", proj: "PROJ-8091", name: "Rakoski, Noah", loc: "Camarillo", date: "2026-03-24", folder: "1Vhn41RNOMQ-tkdhx_HsYxdn2T34iSUko" },
  { id: "11759540266", proj: "PROJ-8935", name: "Rooney, Chelsea", loc: "Centennial", date: "2026-03-24", folder: "1kB3GrrcE4tXihgmN9OMdVPi61HG8c6k6" },
  { id: "52046760116", proj: "PROJ-8889", name: "Semcken, Jackson", loc: "Centennial", date: "2026-03-24", folder: "1gIhqjiREVckIl3NEE8mqO48LyxEu1GgM" },
  { id: "52883875648", proj: "PROJ-8907", name: "Fitch, Aide", loc: "Westminster", date: "2026-03-24", folder: "118EmiCBjOgOnH4JZKcBQKvPC4scGstVJ" },
  { id: "50880438134", proj: "PROJ-8949", name: "WIEN, MICHEAL", loc: "Westminster", date: "2026-03-24", folder: "1pd4KkrOl4Yv5PstNP7YiFk4aBLRAmONN" },
  { id: "53684897073", proj: "PROJ-9000", name: "Casterline, Forest", loc: "Colorado Springs", date: "2026-03-25", folder: "1AogEAPgIHorXKOnmg5ANhc0QhXyq-iNo" },
  { id: "52037859506", proj: "PROJ-8884", name: "Davis, John & Patricia", loc: "Colorado Springs", date: "2026-03-25", folder: "1szO6yXl8zBuruljuAY7EVnOUqHKcxJHJ" },
  { id: "53212098989", proj: "PROJ-9042", name: "Brazerol, Vaughn", loc: "San Luis Obispo", date: "2026-03-25", folder: "1kCGLBKvHF4YuZaCxI6B0XbxFc4m_798_" },
  { id: "56222090662", proj: "PROJ-9483", name: "Elliott, Aaron", loc: "Centennial", date: "2026-03-26", folder: "1hxF1ADOb9GgoN7UFp-5d_Ew6sFMnrPpA" },
  { id: "53076733358", proj: "PROJ-8984", name: "Rothman, Paul", loc: "Westminster", date: "2026-03-26", folder: "1DhUfajCZfacC1rC2S6hRglDRghB40178" },
  { id: "54102533022", proj: "PROJ-9031", name: "Czajkowski, Thomas", loc: "Westminster", date: "2026-03-26", folder: "1AxRj7eRNC3CGcyg15JH5XvLwQe3QvvCC" },
  { id: "52342977045", proj: "PROJ-9051", name: "Wilder, Megan", loc: "Westminster", date: "2026-03-27", folder: "1gGefcuas1c4g5LOkTqp7APWtkglc6FBs" },
  { id: "55133090333", proj: "PROJ-9464", name: "Mucaj, Rigert", loc: "Westminster", date: "2026-03-27", folder: "1xf4nWw2alfktWQZtYyQY10DbDDvdnSEH" },
  { id: "22983647032", proj: "PROJ-8770", name: "Collins, Logan", loc: "Westminster", date: "2026-03-27", folder: "13m8kHXb_u_XsQNAoUiTeSAMupx-WUIO6" },
  { id: "56924180097", proj: "PROJ-9530", name: "Cool, Monte", loc: "San Luis Obispo", date: "2026-03-27", folder: "1avm5XYOuo0tgUxMzksOrZww-RWKn_J_w" },
  { id: "54263226474", proj: "PROJ-9081", name: "Montgomery, Rebecca", loc: "Centennial", date: "2026-03-30", folder: "1kaciESm9r5GAD0C33-NXWSuVvypQsp6Z" },
  { id: "53527775873", proj: "PROJ-8995", name: "Trifon, Lisa", loc: "Westminster", date: "2026-03-30", folder: "1oFgCH4-bY16dVDDejWL5P5IKaGm3M47n" },
  { id: "53548136054", proj: "PROJ-8983", name: "Maes, Porfillo", loc: "Colorado Springs", date: "2026-03-31", folder: "1Zd-7fN_3RgN350kkIIxv1k7wBEi47z6a" },
  { id: "43602808364", proj: "PROJ-9473", name: "Schmidt, William", loc: "Centennial", date: "2026-03-31", folder: "1EVITyEuYyNEO3w6Tv3LzGQDJqdWWxYr6" },
  { id: "52923589186", proj: "PROJ-9027", name: "Grundy, Michael", loc: "Westminster", date: "2026-03-31", folder: "1EPYzNwld0n3R8sqXlwoPLB8M-DTRmXN9" },
];

// ---- Main ----

const CONCURRENCY = 5; // Parallel requests to avoid rate limiting

async function runBatch(items, fn, concurrency) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log(`\n📸 Install Photo Count — Q1 2026 Construction Completes`);
  console.log(`${"=".repeat(70)}`);
  console.log(`Scanning ${DEALS.length} deals...\n`);

  const dealsWithFolders = DEALS.filter(d => d.folder);
  const dealsWithoutFolders = DEALS.filter(d => !d.folder);

  console.log(`  ${dealsWithFolders.length} deals have installation_documents folder`);
  console.log(`  ${dealsWithoutFolders.length} deals MISSING installation_documents folder\n`);

  if (dealsWithoutFolders.length > 0) {
    console.log(`⚠️  MISSING installation_documents property:`);
    for (const d of dealsWithoutFolders) {
      console.log(`   ${d.proj} | ${d.name} | ${d.loc} | ${d.date}`);
    }
    console.log();
  }

  // Count photos for each deal with a folder
  let completed = 0;
  const results = await runBatch(dealsWithFolders, async (deal, i) => {
    try {
      const count = await countImagesRecursive(deal.folder);
      completed++;
      if (completed % 10 === 0) {
        process.stderr.write(`  Progress: ${completed}/${dealsWithFolders.length}\n`);
      }
      return { ...deal, photoCount: count, error: null };
    } catch (err) {
      completed++;
      return { ...deal, photoCount: -1, error: err.message };
    }
  }, CONCURRENCY);

  // Merge with no-folder deals
  const allResults = [
    ...results,
    ...dealsWithoutFolders.map(d => ({ ...d, photoCount: 0, error: "No folder" })),
  ].sort((a, b) => a.loc.localeCompare(b.loc) || a.date.localeCompare(b.date));

  // Group by location
  const byLocation = {};
  for (const r of allResults) {
    if (!byLocation[r.loc]) byLocation[r.loc] = [];
    byLocation[r.loc].push(r);
  }

  // Print results
  console.log(`\n${"=".repeat(70)}`);
  console.log(`RESULTS BY LOCATION`);
  console.log(`${"=".repeat(70)}\n`);

  let grandTotal = 0;
  let grandDeals = 0;
  let zeroPhotoDeals = [];

  for (const [loc, deals] of Object.entries(byLocation).sort((a, b) => a[0].localeCompare(b[0]))) {
    const totalPhotos = deals.reduce((s, d) => s + Math.max(0, d.photoCount), 0);
    const withPhotos = deals.filter(d => d.photoCount > 0).length;
    const avgPhotos = withPhotos > 0 ? (totalPhotos / withPhotos).toFixed(1) : "0";

    grandTotal += totalPhotos;
    grandDeals += deals.length;

    console.log(`📍 ${loc} — ${deals.length} deals, ${totalPhotos} total photos, ${withPhotos}/${deals.length} have photos (avg ${avgPhotos}/deal)`);
    console.log(`${"─".repeat(70)}`);

    for (const d of deals) {
      const flag = d.photoCount === 0 ? " ❌ NO PHOTOS" : d.photoCount < 0 ? " ⚠️  ERROR" : "";
      const countStr = d.photoCount >= 0 ? String(d.photoCount).padStart(3) : "ERR";
      console.log(`  ${d.date} | ${d.proj.padEnd(10)} | ${d.name.substring(0, 25).padEnd(25)} | ${countStr} photos${flag}`);
      if (d.photoCount === 0) zeroPhotoDeals.push(d);
    }
    console.log();
  }

  // Summary
  console.log(`${"=".repeat(70)}`);
  console.log(`SUMMARY`);
  console.log(`${"=".repeat(70)}`);
  console.log(`  Total deals:           ${grandDeals}`);
  console.log(`  Total photos:          ${grandTotal}`);
  console.log(`  Deals WITH photos:     ${grandDeals - zeroPhotoDeals.length}`);
  console.log(`  Deals WITHOUT photos:  ${zeroPhotoDeals.length} (${((zeroPhotoDeals.length / grandDeals) * 100).toFixed(1)}%)`);
  console.log(`  Avg photos/deal:       ${grandDeals > 0 ? (grandTotal / grandDeals).toFixed(1) : 0}`);
  console.log();

  if (zeroPhotoDeals.length > 0) {
    console.log(`🚩 DEALS WITH ZERO PHOTOS:`);
    console.log(`${"─".repeat(70)}`);
    for (const d of zeroPhotoDeals) {
      const reason = d.folder ? "Empty folder" : "No folder link";
      console.log(`  ${d.proj} | ${d.name.substring(0, 30)} | ${d.loc} | ${d.date} | ${reason}`);
    }
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
