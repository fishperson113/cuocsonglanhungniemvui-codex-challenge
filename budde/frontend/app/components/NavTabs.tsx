"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/board", label: "Kanban Dashboard" },
  { href: "/profiles", label: "Profiles" },
];

export default function NavTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/5 p-1 backdrop-blur-xl">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${
              active
                ? "bg-gradient-to-r from-fuchsia-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/30"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
