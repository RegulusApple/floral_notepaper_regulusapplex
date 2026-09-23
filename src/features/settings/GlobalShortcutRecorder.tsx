import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { checkGlobalShortcut } from "./api";
import {
  formatHeldKeys,
  hotkeyToConfigString,
  isValidGlobalShortcut,
  shortcutPlatform,
} from "./shortcutRecorder";
import { useShortcutRecorder } from "./useShortcutRecorder";

interface GlobalShortcutRecorderProps {
  value: string;
  onChange: (value: string) => void;
  helpKey?: string;
}

type ShortcutMsg = { key: string; params?: Record<string, string> } | { raw: string };

export function GlobalShortcutRecorder({
  value,
  onChange,
  helpKey = "settings.shortcut.forQuickNote",
}: GlobalShortcutRecorderProps) {
  const { t } = useTranslation();
  const [checkState, setCheckState] = useState<"idle" | "checking" | "ok" | "warning" | "error">(
    "idle",
  );
  const [checkMsg, setCheckMsg] = useState<ShortcutMsg>({ key: helpKey });
  const shortcutCheckRequestId = useRef(0);
  const isMounted = useRef(true);
  const platform = shortcutPlatform();

  const resolveMsg = (msg: ShortcutMsg): string =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    "raw" in msg ? msg.raw : (t as any)(msg.key, msg.params);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      shortcutCheckRequestId.current += 1;
    };
  }, []);

  const isCurrentShortcutCheck = (requestId: number) =>
    isMounted.current && requestId === shortcutCheckRequestId.current;

  const invalidateShortcutChecks = () => {
    shortcutCheckRequestId.current += 1;
  };

  const markShortcutCleared = () => {
    invalidateShortcutChecks();
    setCheckState("idle");
    setCheckMsg({ key: "settings.shortcut.cleared" });
  };

  const runShortcutCheck = async (shortcut: string, saveWhenAvailable: boolean) => {
    // An empty shortcut is valid and does not need a backend conflict check.
    if (!shortcut) {
      markShortcutCleared();
      return;
    }

    const requestId = shortcutCheckRequestId.current + 1;
    shortcutCheckRequestId.current = requestId;
    setCheckState("checking");
    setCheckMsg({ key: "settings.shortcut.checking" });
    try {
      const result = await checkGlobalShortcut(shortcut);
      if (!isCurrentShortcutCheck(requestId)) return;
      const conflictMsg: ShortcutMsg = {
        key: `settings.shortcut.conflict.${result.conflictType}`,
        params: { shortcut },
      };
      if (result.available) {
        setCheckState("ok");
        setCheckMsg(conflictMsg);
        if (saveWhenAvailable) onChange(shortcut);
      } else {
        setCheckState("warning");
        setCheckMsg(conflictMsg);
      }
    } catch (error) {
      if (!isCurrentShortcutCheck(requestId)) return;
      setCheckState("error");
      setCheckMsg(
        error instanceof Error ? { raw: error.message } : { key: "settings.shortcut.checkFailed" },
      );
    }
  };

  const recorder = useShortcutRecorder({
    onRecord: (shortcut) => {
      if (shortcut === "") {
        onChange("");
        markShortcutCleared();
      } else if (isValidGlobalShortcut(shortcut)) {
        const configString = hotkeyToConfigString(shortcut, platform);
        void runShortcutCheck(configString, true);
      } else {
        invalidateShortcutChecks();
        setCheckState("warning");
        setCheckMsg({ key: "settings.shortcut.needsModifier" });
      }
    },
  });
  const containerRef = useRef<HTMLDivElement>(null);

  const clearShortcut = () => {
    // Clearing unregisters the previous global shortcut in the backend.
    recorder.cancelRecording();
    onChange("");
    markShortcutCleared();
  };

  useEffect(() => {
    if (!recorder.isRecording) return;
    const handleClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        recorder.cancelRecording();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [recorder.isRecording, recorder.cancelRecording]);

  const liveDisplay =
    recorder.isRecording && recorder.heldKeys.length > 0
      ? formatHeldKeys(recorder.heldKeys, platform)
      : null;
  const statusClass =
    checkState === "ok"
      ? "text-bamboo"
      : checkState === "warning" || checkState === "error"
        ? "text-red-400"
        : "text-ink-ghost";
  const isChecking = checkState === "checking";

  return (
    <div ref={containerRef} className="relative space-y-1.5">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => recorder.startRecording()}
          className={`min-w-0 flex-1 h-8 px-2.5 rounded-lg border text-[12px] flex items-center gap-2 cursor-pointer transition-colors ${
            recorder.isRecording
              ? "bg-bamboo-mist/40 border-bamboo"
              : "bg-paper-warm/70 border-paper-deep/40 hover:border-paper-deep/60"
          }`}
        >
          {recorder.isRecording ? (
            <>
              <span className="flex-1 min-w-0 text-left text-bamboo truncate">
                {liveDisplay ||
                  t("settings.shortcut.pressHint", {
                    defaultValue: "按下快捷键；按 Delete 清空。",
                  })}
              </span>
              <span className="text-[10px] text-ink-faint shrink-0">
                {t("settings.shortcut.cancelHint", { defaultValue: "Esc 取消" })}
              </span>
            </>
          ) : (
            <>
              <span
                className={`flex-1 min-w-0 text-left truncate ${
                  value ? "text-ink-soft" : "text-ink-ghost"
                }`}
              >
                {value || t("settings.shortcut.notSet", { defaultValue: "未设置" })}
              </span>
              <span className="text-[10px] text-ink-ghost shrink-0">
                {t("settings.shortcut.clickToRecord", { defaultValue: "点击录制" })}
              </span>
            </>
          )}
        </button>
        <button
          type="button"
          disabled={!value || recorder.isRecording}
          onClick={clearShortcut}
          aria-label={t("settings.shortcut.clear", { defaultValue: "清除" })}
          title={t("settings.shortcut.clear", { defaultValue: "清除" })}
          className="w-8 h-8 rounded-lg border border-paper-deep/45 text-[15px] leading-none text-ink-faint hover:text-red-400 hover:bg-paper-warm/70 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          ×
        </button>
        <button
          type="button"
          disabled={!value || isChecking || recorder.isRecording}
          onClick={() => void runShortcutCheck(value, false)}
          className="h-8 px-3 rounded-lg border border-paper-deep/45 text-[11px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {isChecking
            ? t("settings.shortcut.checkingShort", { defaultValue: "检测中" })
            : t("settings.shortcut.check", { defaultValue: "检测" })}
        </button>
      </div>
      <p className={`min-h-4 text-[11px] ${statusClass}`}>{resolveMsg(checkMsg)}</p>
    </div>
  );
}
