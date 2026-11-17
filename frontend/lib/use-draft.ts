"use client";
import { useCallback, useSyncExternalStore, type SetStateAction } from "react";
const memory = new Map<string, string>();
function read(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? memory.get(key) ?? fallback; }
  catch { return memory.get(key) ?? fallback; }
}
function parse<T>(raw: string, initial: T): T {
  try {
    const value = JSON.parse(raw);
    if (initial === null) return (value === null || typeof value === "string" ? value : initial) as T;
    if (typeof initial === "object" && !Array.isArray(initial)) return value && typeof value === "object" && !Array.isArray(value) ? { ...initial, ...value } : initial;
    return typeof value === typeof initial ? value : initial;
  } catch { return initial; }
}
export function useDraft<T>(key: string, initial: T): [T, (value: SetStateAction<T>) => void] {
  const fallback = JSON.stringify(initial);
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener("vcreation:draft", notify); window.addEventListener("storage", notify);
    return () => { window.removeEventListener("vcreation:draft", notify); window.removeEventListener("storage", notify); };
  }, []);
  const snapshot = useCallback(() => read(key, fallback), [key, fallback]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => fallback);
  const update = useCallback((value: SetStateAction<T>) => {
    const previous = parse<T>(read(key, fallback), JSON.parse(fallback));
    const next = typeof value === "function" ? (value as (old: T) => T)(previous) : value;
    const serialized = JSON.stringify(next); memory.set(key, serialized);
    try { localStorage.setItem(key, serialized); } catch { /* Keep the current draft in memory if browser storage is unavailable. */ }
    window.dispatchEvent(new Event("vcreation:draft"));
  }, [key, fallback]);
  return [parse<T>(raw, initial), update];
}
