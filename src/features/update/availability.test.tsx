import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { syncLanguage } from "../../locales";
import { IN_APP_UPDATES_ENABLED } from "./availability";
import { UpdateSettingsSection } from "./UpdateSettingsSection";

afterEach(() => syncLanguage("zh-CN"));

it.each([
  ["zh-CN", "应用内更新已暂停"],
  ["zh-HK", "應用程式內更新已暫停"],
  ["en-US", "In-app updates are paused"],
])("does not expose upstream update controls in %s", async (locale, text) => {
  await syncLanguage(locale);
  expect(IN_APP_UPDATES_ENABLED).toBe(false);
  const markup = renderToStaticMarkup(<UpdateSettingsSection />);
  expect(markup).toContain(text);
  expect(markup).not.toContain("<button");
  expect(markup).not.toContain("<input");
});
