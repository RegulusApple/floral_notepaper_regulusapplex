import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { normalizeTileOpacity } from "../settings/tileAppearance";

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}
export interface TodoState {
  revision: number;
  items: TodoItem[];
  opacity: number;
}
export type TodoAction =
  | { type: "add"; id: string; text: string; after?: string }
  | { type: "edit"; id: string; text: string }
  | { type: "complete"; id: string; completed: boolean }
  | { type: "delete"; id: string }
  | { type: "move"; id: string; before: string | null }
  | { type: "opacity"; value: number };

export function optimisticTodo(state: TodoState, action: TodoAction): TodoState {
  const items = state.items.map((item) => ({ ...item }));
  if (action.type === "opacity") return { ...state, opacity: normalizeTileOpacity(action.value) };
  const index = items.findIndex((item) => item.id === action.id);
  switch (action.type) {
    case "add": {
      if (index >= 0) break;
      const previous = items.findIndex((item) => item.id === action.after);
      items.splice(previous < 0 ? items.length : previous + 1, 0, {
        id: action.id,
        text: action.text.trim(),
        completed: false,
      });
      break;
    }
    case "edit":
      if (index >= 0) items[index].text = action.text.trim();
      break;
    case "complete":
      if (index >= 0) items[index].completed = action.completed;
      break;
    case "delete":
      if (index >= 0) items.splice(index, 1);
      break;
    case "move": {
      if (index < 0 || action.before === action.id) break;
      const [item] = items.splice(index, 1);
      const target = items.findIndex((item) => item.id === action.before);
      items.splice(target < 0 ? items.length : target, 0, item);
    }
  }
  return { ...state, items };
}

// Commands are atomic on the backend. Rebase pending actions on newer snapshots,
// including snapshots emitted by another window, instead of saving whole lists.
export function createTodoClient(save: (action: TodoAction) => Promise<TodoState>) {
  let base: TodoState = { revision: -1, items: [], opacity: 0.45 };
  const queue: TodoAction[] = [];
  let error: unknown = null;
  let running: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  let snapshot: { state: TodoState; ready: boolean; pending: number; error: unknown } = {
    state: base,
    ready: false,
    pending: 0,
    error,
  };
  const publish = () => {
    snapshot = {
      state: queue.reduce(optimisticTodo, base),
      ready: base.revision >= 0,
      pending: queue.length,
      error,
    };
    listeners.forEach((listener) => listener());
  };
  const receive = (next: TodoState) => {
    if (next.revision >= base.revision) {
      base = next;
      publish();
    }
  };
  const pump = (): Promise<void> => {
    if (running) return running;
    if (error || base.revision < 0) return Promise.resolve();
    running = (async () => {
      while (queue.length) {
        try {
          const next = await save(queue[0]);
          queue.shift();
          if (next.revision >= base.revision) base = next;
          error = null;
          publish();
        } catch (cause) {
          error = cause;
          publish();
          break;
        }
      }
    })().finally(() => {
      running = null;
      if (queue.length && !error) void pump();
    });
    return running;
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => snapshot,
    receive,
    fail(cause: unknown) {
      error = cause;
      publish();
    },
    dispatch(action: TodoAction) {
      queue.push(action);
      publish();
      void pump();
    },
    async flush() {
      do {
        await pump();
        if (error) throw error;
      } while (queue.length && base.revision >= 0);
    },
    retry() {
      error = null;
      publish();
      return pump();
    },
  };
}

export function useTodos(enabled: boolean) {
  const clientRef = useRef<ReturnType<typeof createTodoClient> | null>(null);
  if (!clientRef.current)
    clientRef.current = createTodoClient((action) => invoke("todos_mutate", { action }));
  const client = clientRef.current;
  const snapshot = useSyncExternalStore(client.subscribe, client.snapshot);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    // Subscribe before loading so changes during the initial read aren't lost.
    const unlisten = listen<TodoState>("todos-changed", (event) => {
      if (active) client.receive(event.payload);
    });
    void unlisten
      .then(() => invoke<TodoState>("todos_get"))
      .then((state) => {
        if (active) client.receive(state);
      })
      .catch((error) => {
        if (active) client.fail(error);
      });
    return () => {
      active = false;
      void unlisten.then((stop) => stop());
    };
  }, [client, enabled]);
  return { ...snapshot, client };
}
