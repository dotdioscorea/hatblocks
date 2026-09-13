import type { CategoryId } from "../ir/types";

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  color: string;
}

/** C-first palette. Shapes stay Scratch; labels and groups follow the language. */
export const CATEGORIES: CategoryMeta[] = [
  { id: "extension", label: "Preproc", color: "#0FBD8C" },
  { id: "custom", label: "Functions", color: "#FF6680" },
  { id: "control", label: "Control", color: "#FFAB19" },
  { id: "operators", label: "Operators", color: "#59C059" },
  { id: "variables", label: "Variables", color: "#FF8C1A" },
  { id: "lists", label: "Arrays", color: "#FF661A" },
  { id: "sensing", label: "Pointers", color: "#5CB1D6" },
  { id: "looks", label: "I/O", color: "#9966FF" },
  { id: "events", label: "Events", color: "#FFBF00" },
  { id: "motion", label: "Motion", color: "#4C97FF" },
  { id: "sound", label: "Sound", color: "#CF63CF" },
];

export const CATEGORY_BY_ID: Record<CategoryId, CategoryMeta> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, CategoryMeta>;
