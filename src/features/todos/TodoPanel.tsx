import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "../notes/api";
import type { useTodos } from "./store";

export interface TodoPanelHandle {
  flush: () => Promise<void>;
  focus: () => void;
}
export const TodoPanel = forwardRef<
  TodoPanelHandle,
  { model: ReturnType<typeof useTodos>; active: boolean }
>(function TodoPanel({ model, active }, ref) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const updateDraft = (value: string) => {
    draftRef.current = value;
    setDraft(value);
  };
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const revealNewItem = useRef(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const dragId = useRef<string | null>(null);
  const lastEdit = useRef("");
  const commitEdit = () => {
    if (editing?.text.trim() && lastEdit.current !== `${editing.id}:${editing.text}`) {
      model.client.dispatch({ type: "edit", id: editing.id, text: editing.text });
      lastEdit.current = `${editing.id}:${editing.text}`;
    }
  };
  const add = () => {
    if (!model.ready || !draftRef.current.trim()) return false;
    const text = draftRef.current;
    updateDraft("");
    revealNewItem.current = true;
    model.client.dispatch({ type: "add", id: crypto.randomUUID(), text });
    return true;
  };
  useImperativeHandle(ref, () => ({
    async flush() {
      commitEdit();
      add();
      await model.client.flush();
    },
    focus() {
      composer.current?.focus();
    },
  }));
  useEffect(() => {
    if (active && model.ready) composer.current?.focus();
  }, [active, model.ready]);
  useEffect(() => {
    if (revealNewItem.current && list.current) {
      list.current.scrollTop = list.current.scrollHeight;
      revealNewItem.current = false;
    }
  }, [model.state.items.length]);
  useEffect(() => {
    if (!editing?.text.trim()) return;
    const timer = window.setTimeout(() => {
      const key = `${editing.id}:${editing.text}`;
      if (lastEdit.current !== key) {
        lastEdit.current = key;
        model.client.dispatch({ type: "edit", id: editing.id, text: editing.text });
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [editing, model.client]);
  useEffect(() => {
    if (editing) editor.current?.focus();
  }, [editing?.id]);
  return (
    <section className="todo-panel" hidden={!active} aria-label={t("desktopTasks.tasks")}>
      <h1 className="todo-title">{t("desktopTasks.today")}</h1>
      <div
        ref={list}
        className="todo-list"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (dragId.current)
            model.client.dispatch({ type: "move", id: dragId.current, before: null });
          dragId.current = null;
        }}
      >
        {model.ready && model.state.items.length === 0 && (
          <p className="todo-empty">{t("desktopTasks.empty")}</p>
        )}
        {model.state.items.map((item) => (
          <div
            className="todo-row"
            key={item.id}
            data-todo-id={item.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (dragId.current)
                model.client.dispatch({ type: "move", id: dragId.current, before: item.id });
              dragId.current = null;
            }}
          >
            <input
              className="task-checkbox todo-check"
              type="checkbox"
              checked={item.completed}
              aria-label={t(item.completed ? "desktopTasks.uncomplete" : "desktopTasks.complete", {
                text: item.text,
              })}
              onChange={(event) =>
                model.client.dispatch({
                  type: "complete",
                  id: item.id,
                  completed: event.target.checked,
                })
              }
            />
            {editing?.id === item.id ? (
              <textarea
                ref={editor}
                className="todo-editor"
                rows={Math.max(1, editing.text.split("\n").length)}
                aria-label={t("desktopTasks.edit")}
                value={editing.text}
                onChange={(event) => setEditing({ id: item.id, text: event.target.value })}
                onBlur={() => {
                  commitEdit();
                  setEditing(null);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    commitEdit();
                    setEditing(null);
                    composer.current?.focus();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    commitEdit();
                    setEditing(null);
                    composer.current?.focus();
                  }
                }}
              />
            ) : (
              <button
                className={`todo-text ${item.completed ? "task-completed" : ""}`}
                onClick={() => {
                  lastEdit.current = `${item.id}:${item.text}`;
                  setEditing({ id: item.id, text: item.text });
                }}
              >
                {item.text}
              </button>
            )}
            <button
              className="todo-row-action todo-grip"
              draggable
              title={t("desktopTasks.reorder")}
              aria-label={t("desktopTasks.reorder")}
              onDragStart={(event) => {
                dragId.current = item.id;
                event.dataTransfer.setData("text/plain", item.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                dragId.current = null;
              }}
              onKeyDown={(event) => {
                if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                event.preventDefault();
                const index = model.state.items.findIndex((next) => next.id === item.id);
                const before =
                  event.key === "ArrowUp"
                    ? model.state.items[index - 1]?.id
                    : model.state.items[index + 2]?.id;
                if (event.key === "ArrowUp" && index === 0) return;
                model.client.dispatch({ type: "move", id: item.id, before: before ?? null });
              }}
            >
              ⠿
            </button>
            <button
              className="todo-row-action"
              aria-label={t("desktopTasks.delete", { text: item.text })}
              onClick={() => {
                model.client.dispatch({ type: "delete", id: item.id });
                composer.current?.focus();
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {model.error != null && (
        <div className="surface-save-error" role="alert">
          <span>
            {t("desktopTasks.saveFailed")} {getErrorMessage(model.error)}
          </span>
          <button
            onClick={() =>
              void (
                model.ready
                  ? model.client.retry()
                  : import("@tauri-apps/api/core")
                      .then(({ invoke }) => invoke("todos_get"))
                      .then((state) => {
                        model.client.receive(state as typeof model.state);
                        return model.client.retry();
                      })
              ).catch((error) => model.client.fail(error))
            }
          >
            {t("desktopTasks.retry")}
          </button>
        </div>
      )}
      <div className="todo-composer">
        <button
          className="todo-add"
          aria-label={t("desktopTasks.add")}
          disabled={!model.ready}
          onClick={() => {
            add();
            composer.current?.focus();
          }}
        >
          +
        </button>
        <textarea
          ref={composer}
          value={draft}
          disabled={!model.ready}
          rows={Math.min(4, Math.max(1, draft.split("\n").length))}
          aria-label={t("desktopTasks.add")}
          placeholder={t("desktopTasks.enterHint")}
          onChange={(event) => updateDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!add()) {
                updateDraft("");
                composer.current?.blur();
              }
            } else if (event.key === "Escape" && !draft.trim()) {
              event.preventDefault();
              updateDraft("");
              composer.current?.blur();
            }
          }}
        />
      </div>
    </section>
  );
});
