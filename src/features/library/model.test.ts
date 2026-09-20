import { describe, expect, it } from "vitest";
import {
  buildLibraryTree,
  countLibraryNotes,
  canonicalFolder,
  defaultPeriod,
  isWritableFolder,
  periodDate,
  type RecordKind,
} from "./model";
import type { NoteMetadata } from "../notes/types";
import { metadataFromNote } from "../notes/noteUtils";
import { createNoteTemplate } from "../noteTemplates/templates";
import { createInstance } from "i18next";
import { resources, translationOverrides } from "../../locales/resources";
const note = (id: string, fields: Partial<NoteMetadata> = {}): NoteMetadata => ({
  id,
  title: id,
  fileName: id + ".md",
  category: "",
  preview: "",
  wordCount: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...fields,
});
describe("library periods", () => {
  it.each<[RecordKind, string, string]>([
    ["diary", "2021-01-01", "diary/2020/2020-W53"],
    ["diary", "2024-12-30", "diary/2025/2025-W01"],
    ["weekly", "2020-W53", "weekly/2020/12"],
    ["weekly", "2025-W01", "weekly/2025/01"],
    ["weekly", "2026-W40", "weekly/2026/10"],
    ["monthly", "2024-02", "monthly/2024"],
  ])("files %s %s in %s", (kind, period, folder) =>
    expect(canonicalFolder(kind, period)).toBe(folder),
  );
  it.each<[RecordKind, string]>([
    ["diary", "2023-02-29"],
    ["diary", "2024-2-29"],
    ["weekly", "2021-W53"],
    ["weekly", "2026-W00"],
    ["monthly", "2026-13"],
    ["monthly", "0001-01"],
  ])("rejects invalid %s %s", (kind, period) => expect(periodDate(kind, period)).toBeNull());
  it("uses the local day and retains a leap day", () => {
    expect(defaultPeriod("diary", new Date(2024, 1, 29, 0, 1))).toBe("2024-02-29");
  });
  it.each(["zh-CN", "zh-HK", "en-US"] as const)(
    "creates selected historical period in %s",
    async (locale) => {
      const i18n = createInstance();
      await i18n.init({ resources, lng: locale });
      const t = i18n.getFixedT(locale);
      const template = createNoteTemplate("weekly", t, new Date(2026, 8, 20), "2020-W53");
      expect(template.title).toContain("2020-W53");
      expect(template.content).toContain(
        translationOverrides[locale].noteTemplates.weekly.reflection,
      );
      for (const value of Object.values(translationOverrides[locale].library))
        expect(value).not.toBe("");
    },
  );
});
describe("real folder and period trees", () => {
  it("includes empty custom folders, but not empty archive periods", () => {
    const tree = buildLibraryTree([], ["Work/Project/Notes", "diary/2020/2020-W53"]);
    expect(tree.children.map((node) => node.path)).toEqual([
      "diary",
      "weekly",
      "monthly",
      "tiles",
      "Work",
    ]);
    expect(tree.children[0].children).toEqual([]);
    expect(tree.children[4].children[0].children[0].path).toBe("Work/Project/Notes");
  });
  it("keeps moved records in their period and actual folder with the same ID", () => {
    const record = note("one", {
      category: "Personal",
      recordType: "weekly",
      recordPeriod: "2026-W40",
    });
    const tree = buildLibraryTree([record], ["Personal"]);
    expect(tree.children[1].children[0].children[0].notes).toEqual([record]);
    expect(tree.children[4].notes).toEqual([record]);
    expect(countLibraryNotes(tree)).toBe(1);
    expect(countLibraryNotes(tree.children[1])).toBe(1);
  });
  it("does not infer period metadata from a title", () => {
    const record = note("one", { title: "2026-09-20 日记" });
    const tree = buildLibraryTree([record], []);
    expect(tree.notes).toEqual([record]);
    expect(tree.children[0].children).toEqual([]);
  });
  it("sorts ordinary and tile notes by creation, not edit date", () => {
    const older = note("older", { category: "tiles", updatedAt: "2026-09-20T00:00:00Z" });
    const newer = note("newer", { category: "tiles", createdAt: "2026-02-01T00:00:00Z" });
    expect(buildLibraryTree([older, newer], []).children[3].notes.map((n) => n.id)).toEqual([
      "newer",
      "older",
    ]);
  });
  it("preserves record identity in frontend metadata conversion", () => {
    const source = {
      ...note("one", { recordType: "diary", recordPeriod: "2024-02-29" }),
      content: "Edited",
    };
    expect(metadataFromNote(source)).toMatchObject({
      recordType: "diary",
      recordPeriod: "2024-02-29",
      preview: "Edited",
    });
  });
  it("excludes system archive directories from ordinary destinations", () => {
    expect(["", "tiles", "Custom/Deep"].every(isWritableFolder)).toBe(true);
    expect(["diary", "weekly/2026/10", "monthly/2026"].some(isWritableFolder)).toBe(false);
  });
});
