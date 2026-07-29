// Vertex AI auth + endpoint helpers, shared by the WhatsApp bot (text) and the
// coach-portrait generator (image). Service-account JWT → short-lived OAuth
// token; the model endpoint URL is region-aware so text and image models can
// live in different Vertex locations.

import { createSign } from "crypto";

type ServiceAccount = { client_email: string; private_key: string; project_id: string };

// Parse the service-account key ONCE at module load rather than on every
// request/token refresh. Lazy + memoised so a missing env var only throws when
// something actually calls Vertex, not at import time.
let _sa: ServiceAccount | null = null;
function serviceAccount(): ServiceAccount {
  if (!_sa) _sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!) as ServiceAccount;
  return _sa;
}

let _tokenCache: { token: string; expiresAt: number } | null = null;

export async function getVertexToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (_tokenCache && _tokenCache.expiresAt > nowSec + 60) return _tokenCache.token;

  const sa = serviceAccount();
  const iat = nowSec;
  const exp = iat + 3600;

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      exp,
      iat,
    })
  ).toString("base64url");

  const sigInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(sigInput);
  const sig = signer.sign(sa.private_key, "base64url");
  const jwt = `${sigInput}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`vertex_token_${res.status}: ${await res.text().catch(() => "")}`);
  const { access_token } = (await res.json()) as { access_token: string };
  _tokenCache = { token: access_token, expiresAt: exp };
  return access_token;
}

/**
 * `:generateContent` endpoint for a model. `location` defaults to the text
 * region (`VERTEX_LOCATION`, asia-south1); pass an explicit region for models
 * not served there (e.g. the image model — see VERTEX_IMAGE_LOCATION).
 */
export function vertexUrl(model: string, location?: string): string {
  const { project_id } = serviceAccount();
  const loc = location ?? process.env.VERTEX_LOCATION ?? "asia-south1";
  return `https://${loc}-aiplatform.googleapis.com/v1/projects/${project_id}/locations/${loc}/publishers/google/models/${model}:generateContent`;
}
