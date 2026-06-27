"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "./lib/auth";

export default function App() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getToken() ? "/board" : "/login");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <p className="text-sm text-slate-400">Đang chuyển hướng...</p>
    </div>
  );
}
