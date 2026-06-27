"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSession, logout, type User } from "../lib/auth";

interface Profile {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  profiles: Profile[];
  total: number;
}

const emptyForm = { name: "", email: "", role: "", description: "" };

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder-slate-500 outline-none transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40";

function avatarColor(seed: string): string {
  const colors = [
    "from-fuchsia-500 to-pink-600",
    "from-indigo-500 to-blue-600",
    "from-cyan-500 to-teal-600",
    "from-amber-500 to-orange-600",
    "from-emerald-500 to-green-600",
    "from-violet-500 to-purple-600",
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ProfilesPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [form, setForm] = useState({ ...emptyForm });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/profile");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ListResponse = await res.json();
      setProfiles(data.profiles ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSession().then((u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      setUser(u);
      setAuthChecked(true);
      load();
    });
  }, [router]);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      setForm({ ...emptyForm });
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <svg className="h-8 w-8 animate-spin text-indigo-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
          </svg>
          <p className="text-sm text-slate-400">Đang kiểm tra đăng nhập...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      {/* background blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute top-1/2 -right-32 h-96 w-96 rounded-full bg-fuchsia-600/20 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-5xl px-4 py-10">
        {/* header */}
        <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="bg-gradient-to-r from-white to-slate-400 bg-clip-text text-3xl font-bold text-transparent">
              Profiles
            </h1>
            <p className="mt-1 text-sm text-slate-400">Quản lý hồ sơ người dùng</p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 backdrop-blur-xl">
            {user && (
              <>
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br ${avatarColor(
                    user.email,
                  )} text-sm font-semibold text-white`}
                >
                  {initials(user.name)}
                </div>
                <div className="hidden sm:block">
                  <div className="text-sm font-medium text-white">{user.name}</div>
                  <div className="text-xs text-slate-400">{user.role}</div>
                </div>
              </>
            )}
            <button
              onClick={handleLogout}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              Đăng xuất
            </button>
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-5">
          {/* form */}
          <div className="lg:col-span-2">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-xl">
              <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-white">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-white">
                  +
                </span>
                Thêm / cập nhật
              </h2>
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Tên</label>
                  <input
                    className={inputClass}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Nguyễn Văn A"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Email</label>
                  <input
                    type="email"
                    className={inputClass}
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Title</label>
                  <input
                    className={inputClass}
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                    placeholder="VD: Học sinh, Giáo viên, Mentor..."
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Mô tả</label>
                  <textarea
                    className={inputClass}
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Vài dòng giới thiệu..."
                  />
                </div>

                {error && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-600 px-4 py-3 font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:shadow-xl hover:shadow-indigo-500/40 disabled:opacity-50"
                >
                  {saving ? "Đang lưu..." : "Lưu profile"}
                </button>
              </form>
            </div>
          </div>

          {/* list */}
          <div className="lg:col-span-3">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-xl">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">
                  Danh sách
                  <span className="ml-2 rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-sm font-medium text-indigo-300">
                    {profiles.length}
                  </span>
                </h2>
                <button
                  onClick={load}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.356M2.985 19.644v-4.992h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  Tải lại
                </button>
              </div>

              {loading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex animate-pulse items-center gap-3 rounded-2xl bg-white/5 p-4">
                      <div className="h-11 w-11 rounded-full bg-white/10" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-1/3 rounded bg-white/10" />
                        <div className="h-2.5 w-1/2 rounded bg-white/10" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : profiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-14 text-center">
                  <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 text-2xl">
                    🗂️
                  </div>
                  <p className="text-slate-300">Chưa có profile nào</p>
                  <p className="text-sm text-slate-500">Thêm profile đầu tiên ở form bên trái</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {profiles.map((p) => (
                    <li
                      key={p.id}
                      className="group flex items-start gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 transition-all hover:border-indigo-400/40 hover:bg-white/10"
                    >
                      <div
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${avatarColor(
                          p.email || p.id,
                        )} font-semibold text-white`}
                      >
                        {initials(p.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-white">{p.name}</span>
                          {p.role && (
                            <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-xs font-medium text-indigo-300">
                              {p.role}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-sm text-slate-400">{p.email}</div>
                        {p.description && (
                          <p className="mt-1.5 text-sm text-slate-500">{p.description}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
