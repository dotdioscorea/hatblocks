import type { CategoryId } from "../ir/types";

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  /** Scratch 3 primary */
  color: string;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: "motion", label: "Motion", color: "#4C97FF" },
  { id: "looks", label: "Looks", color: "#9966FF" },
  { id: "sound", label: "Sound", color: "#CF63CF" },
  { id: "events", label: "Events", color: "#FFBF00" },
  { id: "control", label: "Control", color: "#FFAB19" },
  { id: "sensing", label: "Sensing", color: "#5CB1D6" },
  { id: "operators", label: "Operators", color: "#59C059" },
  { id: "variables", label: "Variables", color: "#FF8C1A" },
  { id: "lists", label: "Lists", color: "#FF661A" },
  { id: "custom", label: "My Blocks", color: "#FF6680" },
  { id: "extension", label: "C", color: "#0FBD8C" },
];

export const CATEGORY_BY_ID: Record<CategoryId, CategoryMeta> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, CategoryMeta>;
