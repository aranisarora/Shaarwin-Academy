// Turns an admin-uploaded headshot into a standardized coach portrait using
// Gemini's image model ("Nano Banana") via the shared Vertex auth. Keeps the
// public /coaches roster visually consistent: every portrait matches the house
// style — near-black studio background, warm directional key light,
// head-and-shoulders, black tee, 4:5.
//
// IMPORTANT — identity first. We deliberately DO NOT pass an existing coach's
// portrait as a style reference: giving the model a second human face makes it
// blend the two people, so a new coach came out looking like someone else (and
// worse across gender). Instead the source photo is the ONLY face the model
// sees, and the house look is described entirely in words below — reverse
// engineered from the real roster. The task is framed as a relight/restage of
// the same person, not a "re-create," so the face is preserved.

import { getVertexToken, vertexUrl } from "@/lib/vertex";

// The image model is not served from asia-south1 (the bot's text region), so it
// gets its own location. us-central1 hosts gemini-2.5-flash-image.
const IMAGE_MODEL = process.env.VERTEX_IMAGE_MODEL ?? "gemini-2.5-flash-image";
const IMAGE_LOCATION = process.env.VERTEX_IMAGE_LOCATION ?? "us-central1";

// Reverse-engineered from the real coach portraits. Two blocks: an emphatic
// identity lock (so the output is unmistakably the same person), then the house
// style spec (background, lighting, wardrobe, framing).
const IDENTITY_PROMPT = [
  "You are RETOUCHING and RE-LIGHTING the single photograph provided — not",
  "generating a new person. The output must be unmistakably the SAME individual",
  "as the photo: a real, specific person whose likeness must be preserved with",
  "perfect fidelity.",
  "Keep exactly the same face shape, bone structure, jawline, cheekbones, nose,",
  "lips, eyes and eye colour, eyebrows, forehead, ears, skin tone and complexion,",
  "any moles/marks/freckles, age, gender, facial hair (or clean-shaven face),",
  "and the same hairline, hair length, colour and texture.",
  "Do NOT beautify, slim, smooth, de-age, change gender, straighten hair, add or",
  "remove facial hair, or alter any facial feature or proportion. If the person",
  "wears glasses, a bindi, a turban, a hijab, a piercing or any other personal",
  "feature, keep it. Preserve their natural skin texture — real pores and detail,",
  "never a plastic or airbrushed look.",
  "Keep their head at roughly the same angle as the source; you may gently square",
  "the shoulders to the camera, but never invent facial detail that isn't visible",
  "in the source.",
].join(" ");

const HOUSE_STYLE_PROMPT = [
  "Now restage this exact person as a professional studio portrait in the house style:",
  "Background: a seamless matte studio backdrop in near-black charcoal, with a",
  "soft, subtle glow of slightly lighter grey directly behind the head, deepening",
  "to near-black at the edges (a gentle vignette). No seams, texture, props, text or logos.",
  "Lighting: a single warm, gently amber key light placed high and to the camera's",
  "left, about 45 degrees, giving Rembrandt-style modelling — the near cheek",
  "brightly lit, light falling off softly across the face so the far side sinks",
  "into deep but detailed shadow. Add clear catchlights in the eyes and a faint,",
  "cooler rim light grazing the shadow-side edge of the hair and shoulder to",
  "separate the subject from the dark background.",
  "Mood: high contrast, moody, cinematic, editorial — warm highlights against a",
  "cool near-black background.",
  "Wardrobe: replace their top with a plain black athletic crew-neck t-shirt.",
  "Framing: a tight head-and-shoulders crop, subject centred and facing the",
  "camera, a little headroom above the hair, cropped around mid-chest.",
  "Lens: sharp focus on the eyes, shallow depth of field, ~85mm portrait look,",
  "photorealistic and high quality.",
  "Vertical 4:5 aspect ratio. No text, no logos, no props, no borders, no watermark.",
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

  // Source photo first and alone (the only face), then the instructions. Order
  // matters: leading with the person anchors identity before we describe the look.
  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [
    { text: "Photograph of the coach to restyle — this exact person:" },
    { inlineData: { mimeType, data: source.toString("base64") } },
    { text: IDENTITY_PROMPT },
    { text: HOUSE_STYLE_PROMPT },
  ];

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
