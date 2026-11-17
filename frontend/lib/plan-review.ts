import { filmPlanSchema, type FilmPlan } from "./film-assistant";
export function newFilmPlan(): FilmPlan {
  return { title: "Untitled film", story: "", characters: [], shots: [{ title: "Opening shot", prompt: "", dialogue: "", duration: 5, character_names: [] }] };
}
export function renameCast(plan: FilmPlan, index: number, name: string): FilmPlan {
  const old = plan.characters[index].name;
  return { ...plan, characters: plan.characters.map((actor, i) => i === index ? { ...actor, name } : actor), shots: plan.shots.map(shot => ({ ...shot, character_names: shot.character_names.map(value => value === old ? name : value) })) };
}
export function removeCast(plan: FilmPlan, index: number): FilmPlan {
  const name = plan.characters[index].name;
  return { ...plan, characters: plan.characters.filter((_, i) => i !== index), shots: plan.shots.map(shot => ({ ...shot, character_names: shot.character_names.filter(value => value !== name) })) };
}
export function moveShot(plan: FilmPlan, index: number, direction: number): FilmPlan {
  const next = index + direction;
  if (index < 0 || index >= plan.shots.length || next < 0 || next >= plan.shots.length) return plan;
  const shots = [...plan.shots]; [shots[index], shots[next]] = [shots[next], shots[index]];
  return { ...plan, shots };
}
export function reviewPlan(plan: FilmPlan): FilmPlan {
  const result = filmPlanSchema.safeParse(plan);
  if (!result.success) throw new Error("Add a film title, story, and a visual direction for every shot. Shots must be 2–15 seconds; use at most 8 characters and 12 shots.");
  if (!result.data.title.trim() || !result.data.story.trim() || result.data.shots.some(shot => !shot.title.trim() || !shot.prompt.trim())) throw new Error("Film title, story, shot titles and visual direction cannot be blank.");
  const names = result.data.characters.map(actor => actor.name.trim());
  if (names.some(name => !name) || new Set(names).size !== names.length) throw new Error("Give each character a unique, non-empty name before sending this plan.");
  if (result.data.shots.some(shot => shot.character_names.some(name => !result.data.characters.some(actor => actor.name === name)))) throw new Error("A shot refers to a character that is no longer in the cast. Review its cast selection.");
  return result.data;
}
export function downloadText(filename: string, content: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
