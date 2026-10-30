"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** A top-bar link that shows where you are. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  const on = path === href || (href !== "/" && path.startsWith(href + "/") && !(href === "/money" && path.startsWith("/money/partners")) && !(href === "/admin" && /^\/admin\/(team|records)/.test(path)));
  return <Link href={href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>{children}</Link>;
}
