"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

/** The account menu closes itself after you go somewhere or click outside it. */
export function AccountMenu({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const path = usePathname();
  const search = useSearchParams();
  useEffect(() => { if (ref.current) ref.current.open = false; }, [path, search]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return <details className="menu" ref={ref}><summary data-testid="account-menu">{summary}</summary><div className="pop">{children}</div></details>;
}
