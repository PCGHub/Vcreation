export type Character = {
  id: string; name: string; description: string; wardrobe: string; voice_notes: string; image_path: string | null;
};
export type Shot = {
  id: string; title: string; prompt: string; dialogue: string; duration: number;
  character_ids: string[]; approved: boolean; selected_take_id: string | null; position: number;
};
export type Job = {
  id: string; shot_id: string | null; kind: "take" | "export"; provider: "preview" | "replicate";
  status: string; estimated_usd: number; reserved_usd: number; actual_usd: number | null;
  provider_id: string | null; billing_reference: string | null;
  output_url: string | null; error: string | null;
  snapshot: { contains_animatic?: boolean; shot?: { title: string }; takes?: { take_id: string }[] };
};
export type Project = {
  id: string; title: string; story: string; budget_usd: number; characters: Character[]; shots: Shot[]; jobs: Job[];
  costs: { estimated_usd: number; reserved_usd: number; actual_usd: number; unreconciled_paid_jobs: number };
};
export type ProjectSummary = { id: string; title: string; created_at: string };
export type Capabilities = {
  preview: { ready: boolean; label: string }; replicate: { ready: boolean; reason: string | null }; cost_notice: string;
};
export type Quote = { id: string; estimated_usd: number; provider: "preview" | "replicate"; requestId: string };
export const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
