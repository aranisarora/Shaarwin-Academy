import type { GoTrueClient, JWK, JwtPayload } from "@supabase/supabase-js";

const SIGNING_KEYS: JWK[] = [
  {
    alg: "ES256",
    crv: "P-256",
    ext: true,
    key_ops: ["verify"],
    kid: "75119a57-c4f9-42b1-b1d8-08de7c639819",
    kty: "EC",
    use: "sig",
    x: "oOZjEEdS_9AQhkf2MnOwM3y7DAEUW-AvGJ_i18yEu0k",
    y: "vCE-l15VatglsqSbZ7pSCngS2WXzOKerU3JG9jey9zk",
  },
  {
    alg: "ES256",
    crv: "P-256",
    ext: true,
    key_ops: ["verify"],
    kid: "5626253a-9e6d-436a-b43f-3f96775ada27",
    kty: "EC",
    use: "sig",
    x: "zXEiTiOPg5GZ8rjENd0yAA3HPTTtr_REoStMTD3pqvs",
    y: "gseQwlXsFBlpaF5nz0g4T-jfLQl6HYF73EZOKjn4v14",
  },
];

export const AUTH_TIMEOUT_MS = 3_000;

export async function sessionClaims(auth: GoTrueClient): Promise<JwtPayload | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raced = await Promise.race([
      auth.getClaims(undefined, { jwks: { keys: SIGNING_KEYS } }),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), AUTH_TIMEOUT_MS);
      }),
    ]);
    if (raced === "timeout") {
      console.error(`auth: getClaims gave no answer in ${AUTH_TIMEOUT_MS}ms`);
      return null;
    }
    return raced.data?.claims ?? null;
  } catch (error) {
    console.error("auth: getClaims threw", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
