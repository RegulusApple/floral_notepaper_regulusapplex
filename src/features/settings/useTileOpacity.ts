import { useEffect, useRef, useState } from "react";
import { saveTileOpacity } from "./api";
import { normalizeTileOpacity } from "./tileAppearance";

/** Serial, latest-value writer: input stays immediate while IPC writes are coalesced. */
export function createLatestWriter<T>(
  save: (value: T) => Promise<unknown>,
  onError: (error: unknown) => void,
  keyOf: (value: T) => string = () => "value",
) {
  const pending = new Map<string, T>();
  const failed = new Map<string, { value: T; error: unknown }>();
  let running: Promise<void> | null = null;
  const pump = (): Promise<void> => {
    if (running) return running;
    running = (async () => {
      while (pending.size) {
        const [key, next] = pending.entries().next().value!;
        pending.delete(key);
        failed.delete(key);
        try {
          await save(next);
          failed.delete(key);
        } catch (error) {
          if (!pending.has(key)) failed.set(key, { value: next, error });
          onError(error);
        }
      }
    })().finally(() => {
      running = null;
      if (pending.size) void pump();
    });
    return running;
  };
  return {
    push(value: T) {
      const key = keyOf(value);
      failed.delete(key);
      pending.set(key, value);
      void pump();
    },
    busy() {
      return running !== null;
    },
    async flush() {
      for (const [key, entry] of failed) if (!pending.has(key)) pending.set(key, entry.value);
      do {
        await pump();
      } while (pending.size);
      if (failed.size) throw failed.values().next().value!.error;
    },
  };
}

export function useTileOpacity(
  noteId: string,
  storedValue: unknown,
  onError: (error: unknown) => void,
) {
  const [opacity, setOpacity] = useState(normalizeTileOpacity(storedValue));
  const current = useRef({ noteId, value: opacity });
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const writer = useRef<ReturnType<
    typeof createLatestWriter<{ noteId: string; opacity: number }>
  > | null>(null);
  if (!writer.current)
    writer.current = createLatestWriter(
      (value) => saveTileOpacity(value.noteId, value.opacity),
      (error) => errorRef.current(error),
      (value) => value.noteId,
    );
  useEffect(() => {
    if (current.current.noteId !== noteId || !writer.current!.busy()) {
      current.current = { noteId, value: normalizeTileOpacity(storedValue) };
      setOpacity(current.current.value);
    }
  }, [noteId, storedValue]);
  const change = (next: number | ((previous: number) => number)) => {
    const previous =
      current.current.noteId === noteId ? current.current.value : normalizeTileOpacity(storedValue);
    const value = normalizeTileOpacity(typeof next === "function" ? next(previous) : next);
    current.current = { noteId, value };
    setOpacity(value);
    if (noteId) writer.current!.push({ noteId, opacity: value });
  };
  return [opacity, change, () => writer.current!.flush()] as const;
}
