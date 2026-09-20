import type { TFunction } from "i18next";
import type { SaveNoteRequest } from "../notes/types";

export const NOTE_TEMPLATE_TYPES = ["blank", "diary", "weekly", "monthly"] as const;
export type NoteTemplateType = (typeof NOTE_TEMPLATE_TYPES)[number];

export function getNoteTemplateLabel(type: NoteTemplateType, t: TFunction): string {
  return type === "blank" ? t("common.blankNote") : t(`noteTemplates.${type}.name`);
}

// Use local calendar dates for the user's day, but UTC arithmetic for ISO weeks
// so daylight-saving changes cannot move a date into the wrong week/year.
export function isoWeek(date: Date): string {
  const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);
  const year = thursday.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function createNoteTemplate(
  type: NoteTemplateType,
  t: TFunction,
  date = new Date(),
  selectedPeriod?: string,
): Pick<SaveNoteRequest, "title" | "content"> {
  if (type === "blank") return { title: "", content: "" };

  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const period =
    selectedPeriod ??
    (type === "diary"
      ? `${month}-${String(date.getDate()).padStart(2, "0")}`
      : type === "weekly"
        ? isoWeek(date)
        : month);
  const title = t(`noteTemplates.${type}.title`, { period });
  const headings =
    type === "diary"
      ? [
          t("noteTemplates.diary.record"),
          t("noteTemplates.diary.problems"),
          t("noteTemplates.diary.plan"),
        ]
      : type === "weekly"
        ? [
            t("noteTemplates.weekly.completed"),
            t("noteTemplates.weekly.problems"),
            t("noteTemplates.weekly.plan"),
            t("noteTemplates.weekly.reflection"),
          ]
        : [
            t("noteTemplates.monthly.completed"),
            t("noteTemplates.monthly.achievements"),
            t("noteTemplates.monthly.improvements"),
            t("noteTemplates.monthly.plan"),
          ];

  return {
    title,
    content: `# ${title}\n\n${headings.map((heading) => `## ${heading}\n\n`).join("")}`,
  };
}
