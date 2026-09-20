import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import { resources, translationOverrides } from "../../locales/resources";
import { SUPPORTED_LOCALES } from "../../locales/locale-whitelist";
import { createNoteTemplate, NOTE_TEMPLATE_TYPES, getNoteTemplateLabel } from "./templates";

async function translator(locale = "zh-CN") {
  const instance = createInstance();
  await instance.init({ resources, lng: locale, interpolation: { escapeValue: false } });
  return instance.getFixedT(locale);
}

describe("new-note templates", () => {
  it("keeps a blank note empty", async () => {
    expect(createNoteTemplate("blank", await translator())).toEqual({ title: "", content: "" });
  });

  it("creates the agreed diary, weekly and monthly Markdown", async () => {
    const t = await translator();
    const date = new Date(2026, 8, 20, 0, 5);
    expect(createNoteTemplate("diary", t, date)).toEqual({
      title: "2026-09-20 日记",
      content: "# 2026-09-20 日记\n\n## 今日记录\n\n## 遇到的问题\n\n## 明日计划\n\n",
    });
    expect(createNoteTemplate("weekly", t, date)).toEqual({
      title: "2026-W38 周小结",
      content: "# 2026-W38 周小结\n\n## 本周完成\n\n## 本周问题\n\n## 下周计划\n\n## 复盘\n\n",
    });
    expect(createNoteTemplate("monthly", t, date)).toEqual({
      title: "2026-09 月报",
      content: "# 2026-09 月报\n\n## 本月完成\n\n## 本月成果\n\n## 问题与改进\n\n## 下月计划\n\n",
    });
  });

  it.each([
    [2021, 0, 1, "2020-W53"],
    [2021, 0, 3, "2020-W53"],
    [2021, 0, 4, "2021-W01"],
    [2024, 11, 30, "2025-W01"],
    [2026, 8, 21, "2026-W39"],
  ])("uses the ISO week-year for %i-%i-%i", async (year, month, day, period) => {
    expect(createNoteTemplate("weekly", await translator(), new Date(year, month, day)).title).toBe(
      `${period} 周小结`,
    );
  });

  it("uses the local calendar near midnight, including leap days", async () => {
    const t = await translator();
    const localMidnight = new Date(2024, 1, 29, 0, 1);
    expect(createNoteTemplate("diary", t, localMidnight).title).toBe("2024-02-29 日记");
    expect(createNoteTemplate("monthly", t, new Date(2026, 0, 1, 0, 1)).title).toBe("2026-01 月报");
  });

  it.each(SUPPORTED_LOCALES)("fully localizes menu, title and sections in %s", async (locale) => {
    const t = await translator(locale);
    // Check the locale's own overrides: fallback strings must not hide missing translations.
    const text = translationOverrides[locale].noteTemplates;
    for (const type of NOTE_TEMPLATE_TYPES) {
      expect(getNoteTemplateLabel(type, t)).not.toContain("noteTemplates.");
      if (type === "blank") continue;
      const note = createNoteTemplate(type, t, new Date(2026, 8, 20));
      expect(note.title).toContain(text[type].name);
      for (const [key, value] of Object.entries(text[type])) {
        if (key !== "name" && key !== "title") expect(note.content).toContain(`## ${value}\n`);
      }
      expect(note.content).toMatch(new RegExp(`^# ${note.title}\\n\\n`));
      expect(note.content).not.toMatch(/\{\{|noteTemplates\./);
    }
  });
});
