import type { TFunction } from "i18next";
import type { NoteMetadata } from "../notes/types";
import { formatShortDate } from "../notes/noteUtils";
import { type LibraryNode, periodDate, SYSTEM_ROOTS } from "./model";

// Flatten only the archive's redundant year level in the view. Real paths remain
// unchanged for folder selection, drag/drop and filesystem operations.
export function visibleLibraryChildren(node: LibraryNode): LibraryNode[] {
  if (node.path !== "diary" && node.path !== "weekly") return node.children;
  return node.children.flatMap((child) =>
    /^\d{4}$/.test(child.name) && child.notes.length === 0 ? child.children : [child],
  );
}

export function periodGroupLabel(path: string, t: TFunction): string | null {
  const week = /^diary\/\d{4}\/(\d{4})-W(\d{2})$/.exec(path);
  if (week) return t("library.period.week", { year: week[1], week: week[2] });
  const month = /^weekly\/(\d{4})\/(\d{2})$/.exec(path);
  if (month) return t("library.period.month", { year: month[1], month: month[2] });
  const year = /^monthly\/(\d{4})$/.exec(path);
  if (year) return t("library.period.year", { year: year[1] });
  return null;
}

export function libraryFolderLabel(node: LibraryNode, t: TFunction): string {
  const rootLabels = {
    diary: t("library.diary"),
    weekly: t("library.weekly"),
    monthly: t("library.monthly"),
    tiles: t("library.tiles"),
  };
  return (
    periodGroupLabel(node.path, t) ??
    (SYSTEM_ROOTS.includes(node.path)
      ? rootLabels[node.path as keyof typeof rootLabels]
      : node.name)
  );
}

export function recordedPeriod(note: NoteMetadata): string | null {
  return note.recordType &&
    note.recordType !== "ordinary" &&
    note.recordPeriod &&
    periodDate(note.recordType, note.recordPeriod)
    ? note.recordPeriod
    : null;
}

export function noteDateLabel(note: NoteMetadata): string {
  const period = recordedPeriod(note);
  // Calendar strings are never converted through UTC, including historical notes.
  if (period) return note.recordType === "diary" ? period.slice(5) : period;
  return formatShortDate(note.createdAt);
}
