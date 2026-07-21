// Turns an admin-uploaded headshot into a standardized coach portrait using
// Gemini's image model ("Nano Banana") via the shared Vertex auth. Keeps the
// public /coaches roster visually consistent regardless of the source photo.

import { getVertexToken, vertexUrl } from "@/lib/vertex";

// The image model is not served from asia-south1 (the bot's text region), so it
// gets its own location. us-central1 hosts gemini-2.5-flash-image.
const IMAGE_MODEL = process.env.VERTEX_IMAGE_MODEL ?? "gemini-2.5-flash-image";
const IMAGE_LOCATION = process.env.VERTEX_IMAGE_LOCATION ?? "us-central1";

const HOUSE_STYLE_PROMPT = [
  "Restyle this photo into a clean, professional coaching portrait that matches",
  "a consistent house style for a table-tennis academy's website.",
  "Keep the person's face, likeness, skin tone, hair and identity exactly the same —",
  "do not invent a different person.",
  "Frame as a head-and-shoulders portrait, subject centred and facing the camera,",
  "vertical 4:5 aspect ratio.",
  "Use soft, even studio lighting and a plain, neutral, softly-lit background",
  "(no busy scenery, no text, no logos, no borders).",
  "Natural, confident expression. Photorealistic, high quality.",
].join(" ");

export type Portrait = { bytes: Buffer; mimeType: string };

/**
 * Generate a standardized portrait from a source image. Throws on failure so
 * the caller can decide whether to fall back to the original upload.
 */
export async function standardizeCoachPortrait(
  source: Buffer,
  mimeType: string
): Promise<Portrait> {
  const token = await getVertexToken();
  const body = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: source.toString("base64") } },
          { text: HOUSE_STYLE_PROMPT },
        ],
      },
    ],
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
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((p) => p.inlineData?.data)?.inlineData;
  if (!image?.data) throw new Error("coach_photo_no_image");

  return {
    bytes: Buffer.from(image.data, "base64"),
    mimeType: image.mimeType ?? "image/png",
  };
}
