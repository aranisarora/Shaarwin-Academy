"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireFounder } from "@/lib/founder";
import {
  addCoachCore,
  decideTimeOffCore,
  deleteCoachCore,
  deletePendingCoachCore,
  promoteToCoachCore,
  saveCoachCore,
  savePendingCoachCore,
  setCoachActiveCore,
  type CoachDetails,
  type CoachInput,
} from "@/lib/admin-ops";
import { standardizeCoachPortrait } from "@/lib/coach-photo";

type Result = { ok: boolean; error?: string };

export async function promoteToCoach(profileId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await promoteToCoachCore(supabase, founder.id, profileId);
  if (!result.ok) return result;
  revalidatePath("/admin/coaches");
  return { ok: true };
}

export async function addCoach(
  details: CoachDetails
): Promise<Result & { pending?: boolean }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await addCoachCore(supabase, founder.id, details);
  if (!result.ok) return result;
  revalidatePath("/admin/coaches");
  return { ok: true, pending: result.pending };
}

export async function savePendingCoach(id: string, details: CoachDetails): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await savePendingCoachCore(supabase, founder.id, id, details);
  if (!result.ok) return result;
  revalidatePath("/admin/coaches");
  return { ok: true };
}

export async function deletePendingCoach(id: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await deletePendingCoachCore(supabase, founder.id, id);
  if (!result.ok) return result;
  revalidatePath("/admin/coaches");
  return { ok: true };
}

export async function saveCoach(input: CoachInput): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await saveCoachCore(supabase, founder.id, input);
  if (!result.ok) return result;
  revalidatePath("/admin/coaches");
  return { ok: true };
}

export async function deleteCoach(
  coachId: string,
  replacementCoachId?: string | null
): Promise<Result & { changed?: number; skipped?: number }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await deleteCoachCore(supabase, founder.id, coachId, replacementCoachId);
  if (!result.ok) return result;
  revalidatePath("/admin/coaches");
  revalidatePath("/admin/schedule");
  revalidatePath("/coaches");
  return result;
}

/**
 * Upload a headshot, restyle it into the house portrait format via Gemini, and
 * save it as the coach's public photo. Falls back to the original upload if the
 * generation step fails, so the admin always ends up with a working image.
 */
export async function generateCoachPhoto(
  coachId: string,
  formData: FormData
): Promise<Result & { photoUrl?: string }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image to upload." };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "That file isn't an image." };
  }

  const source = Buffer.from(await file.arrayBuffer());
  let bytes: Buffer = source;
  let mimeType = file.type;
  try {
    const portrait = await standardizeCoachPortrait(source, file.type);
    bytes = portrait.bytes;
    mimeType = portrait.mimeType;
  } catch (e) {
    // Non-fatal: keep the original upload so the admin still gets a photo.
    console.warn("coach photo: generation failed, storing original —", e);
  }

  const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const path = `${coachId}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("coach-photos")
    .upload(path, new Blob([new Uint8Array(bytes)], { type: mimeType }), {
      contentType: mimeType,
      upsert: true,
    });
  if (upErr) return { ok: false, error: "Couldn't save the image." };

  const { data: pub } = supabase.storage.from("coach-photos").getPublicUrl(path);
  const photoUrl = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: saveErr } = await supabase
    .from("coaches")
    .update({ photo_url: photoUrl })
    .eq("id", coachId);
  if (saveErr) return { ok: false, error: "Couldn't save the coach's photo." };

  revalidatePath("/admin/coaches");
  revalidatePath("/coaches");
  return { ok: true, photoUrl };
}

export async function setCoachActive(coachId: string, active: boolean): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await setCoachActiveCore(supabase, founder.id, coachId, active);
  if (!result.ok) return result;
  revalidatePath("/admin/coaches");
  revalidatePath("/admin/schedule");
  return { ok: true };
}

export async function decideTimeOff(
  timeOffId: string,
  approve: boolean
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "founder") return { ok: false, error: "Founder only." };

  const result = await decideTimeOffCore(supabase, user.id, timeOffId, approve);
  if (!result.ok) return result;

  revalidatePath("/admin/coaches");
  revalidatePath("/admin");
  return { ok: true };
}
