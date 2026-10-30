"use client";
import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "kp_theme";

/** Light, dark or match the computer. Saved in a cookie so pages render in the right theme from the start. */
export function ThemePicker({ initial }: { initial: ThemeChoice }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  useEffect(() => {
    const root = document.documentElement;
    if (choice === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", choice);
    document.cookie = `${KEY}=${choice}; path=/; max-age=31536000; samesite=lax`;
  }, [choice]);
  const opt = (v: ThemeChoice, label: string) => (
    <button type="button" aria-pressed={choice === v} data-testid={`theme-${v}`} onClick={(e) => { e.preventDefault(); setChoice(v); }}>{label}</button>
  );
  return (
    <>
      <div className="label">Appearance</div>
      <div className="theme">{opt("system", "Match computer")}{opt("light", "Light")}{opt("dark", "Dark")}</div>
    </>
  );
}
