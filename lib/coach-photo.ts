// Turns an admin-uploaded headshot into a standardized coach portrait using
// Gemini's image model ("Nano Banana") via the shared Vertex auth. Keeps the
// public /coaches roster visually consistent: every portrait matches the house
// style — near-black studio background, dramatic warm side-lighting,
// head-and-shoulders, 4:5. An existing portrait is passed as a style reference
// so the model copies the real look rather than guessing from words alone.

import { promises as fs } from "fs";
import path from "path";
import { getVertexToken, vertexUrl } from "@/lib/vertex";

// The image model is not served from asia-south1 (the bot's text region), so it
// gets its own location. us-central1 hosts gemini-2.5-flash-image.
const IMAGE_MODEL = process.env.VERTEX_IMAGE_MODEL ?? "gemini-2.5-flash-image";
const IMAGE_LOCATION = process.env.VERTEX_IMAGE_LOCATION ?? "us-central1";

// An existing house portrait used to anchor background, lighting and framing.
// Shipped to the serverless bundle via next.config outputFileTracingIncludes.
const REFERENCE_IMAGE = "public/images/coach-samir.jpg";

const HOUSE_STYLE_PROMPT = [
  "Re-create this coach as a professional studio portrait in EXACTLY the same",
  "style, lighting and framing as the reference portrait.",
  "Keep the coach's face, likeness, skin tone, facial hair, hairstyle and",
  "identity precisely the same as the source photo — do not turn them into a",
  "different person.",
  "Match the reference: a plain, near-black charcoal studio background with a",
  "soft darker vignette; dramatic, warm directional key light from the upper",
  "left at roughly 45 degrees so one side of the face is brightly lit and the",
  "other falls into soft shadow (Rembrandt lighting); high contrast, moody and",
  "cinematic.",
  "Head-and-shoulders crop, subject centred and facing the camera, wearing a",
  "plain black athletic t-shirt.",
  "Sharp focus, photorealistic, high quality. Vertical 4:5 aspect ratio.",
  "No text, no logos, no props, no borders.",
].join(" ");

export type Portrait = { bytes: Buffer; mimeType: string };

let _ref: { mimeType: string; data: string } | null | undefined;
async function referencePart(): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  if (_ref === undefined) {
    try {
      const buf = await fs.readFile(path.join(process.cwd(), REFERENCE_IMAGE));
      _ref = { mimeType: "image/jpeg", data: buf.toString("base64") };
    } catch {
      _ref = null; // Not on disk (e.g. traced out) — fall back to the prompt.
    }
  }
  return _ref ? { inlineData: _ref } : null;
}

/**
 * Generate a standardized portrait from a source image. Throws on failure so
 * the caller can decide whether to fall back to the original upload.
 */
export async function standardizeCoachPortrait(
  source: Buffer,
  mimeType: string
): Promise<Portrait> {
  const token = await getVertexToken();
  const ref = await referencePart();

  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];
  if (ref) {
    parts.push({ text: "REFERENCE portrait — copy its background, lighting and framing exactly:" });
    parts.push(ref);
    parts.push({ text: "SOURCE photo of the coach — keep this person's face and identity:" });
  }
  parts.push({ inlineData: { mimeType, data: source.toString("base64") } });
  parts.push({ text: HOUSE_STYLE_PROMPT });

  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["IMAGE"] },
  });

  const res = await fetch(vertexUrl(IMAGE_MODEL, IMAGE_LOCATION), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`coach_photo_${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
  };
  const outParts = json.candidates?.[0]?.content?.parts ?? [];
  const image = outParts.find((p) => p.inlineData?.data)?.inlineData;
  if (!image?.data) throw new Error("coach_photo_no_image");

  return {
    bytes: Buffer.from(image.data, "base64"),
    mimeType: image.mimeType ?? "image/png",
  };
}
