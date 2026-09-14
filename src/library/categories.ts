import type { CategoryId } from "../ir/types";

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  color: string;
}

/** C-first palette. Shapes stay Scratch; labels and groups follow the language. */
export const CATEGORIES: CategoryMeta[] = [
  { id: "extension", label: "Pre", color: "#0FBD8C" },
  { id: "custom", label: "Func", color: "#FF6680" },
  { id: "control", label: "Ctrl", color: "#FFAB19" },
  { id: "operators", label: "Ops", color: "#59C059" },
  { id: "variables", label: "Vars", color: "#FF8C1A" },
  { id: "lists", label: "Arr", color: "#FF661A" },
  { id: "sensing", label: "Ptr", color: "#5CB1D6" },
  { id: "looks", label: "I/O", color: "#9966FF" },
  { id: "motion", label: "Type", color: "#4C97FF" },
  { id: "events", label: "Events", color: "#FFBF00" },
  { id: "sound", label: "Sound", color: "#CF63CF" },
];

export const CATEGORY_BY_ID: Record<CategoryId, CategoryMeta> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, CategoryMeta>;
