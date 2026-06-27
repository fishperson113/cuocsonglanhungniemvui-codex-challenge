"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { login, register } from "../lib/auth";

type Mode = "login" | "register";

const passwordRules = [
  { label: "Ít nhất 6 kí tự", test: (value: string) => value.length >= 6 },
  { label: "Có chữ hoa", test: (value: string) => /[A-Z]/.test(value) },
  { label: "Có chữ thường", test: (value: string) => /[a-z]/.test(value) },
  { label: "Có số", test: (value: string) => /\d/.test(value) },
  { label: "Có kí tự đặc biệt", test: (value: string) => /[^A-Za-z0-9]/.test(value) },
];

function getPasswordError(password: string): string | null {
  const missingRule = passwordRules.find((rule) => !rule.test(password));
  return missingRule
    ? "Mật khẩu phải có ít nhất 6 kí tự, gồm chữ hoa, chữ thường, số và kí tự đặc biệt."
    : null;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "register") {
      const passwordError = getPasswordError(password);
      if (passwordError) {
        setError(passwordError);
        return;
      }

      if (password !== confirmPassword) {
        setError("Mật khẩu nhập lại không khớp.");
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, name);
      }
      router.push("/profiles");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-slate-950 px-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-fuchsia-600/30 blur-3xl animate-pulse" />
        <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl animate-pulse [animation-delay:1s]" />
        <div className="absolute -bottom-32 left-1/3 h-96 w-96 rounded-full bg-cyan-500/20 blur-3xl animate-pulse [animation-delay:2s]" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-indigo-600 shadow-lg shadow-indigo-500/30">
            <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a7.5 7.5 0 0115 0v.75H4.5v-.75z" />
            </svg>
          </div>
          <h1 className="bg-gradient-to-r from-white to-slate-300 bg-clip-text text-3xl font-bold text-transparent">
            {mode === "login" ? "Chào mừng trở lại" : "Tạo tài khoản"}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            {mode === "login" ? "Đăng nhập để tiếp tục" : "Bắt đầu chỉ trong vài giây"}
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1">
            {(["login", "register"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                  setConfirmPassword("");
                }}
                className={`rounded-lg py-2.5 text-sm font-semibold transition-all ${
                  mode === m
                    ? "bg-gradient-to-r from-fuchsia-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/30"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {m === "login" ? "Đăng nhập" : "Đăng ký"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <Field label="Tên">
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nguyễn Văn A"
                  autoComplete="name"
                  required
                />
              </Field>
            )}

            <Field label="Email">
              <input
                type="email"
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </Field>

            <Field label="Mật khẩu">
              <PasswordInput
                value={password}
                onChange={setPassword}
                visible={showPassword}
                onToggle={() => setShowPassword((current) => !current)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </Field>

            {mode === "register" && (
              <>
                <Field label="Nhập lại mật khẩu">
                  <PasswordInput
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    visible={showConfirmPassword}
                    onToggle={() => setShowConfirmPassword((current) => !current)}
                    autoComplete="new-password"
                  />
                </Field>

                <ul className="grid gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-400">
                  {passwordRules.map((rule) => {
                    const passed = rule.test(password);
                    return (
                      <li
                        key={rule.label}
                        className={passed ? "text-emerald-300" : "text-slate-400"}
                      >
                        {passed ? "✓" : "•"} {rule.label}
                      </li>
                    );
                  })}
                  <li
                    className={
                      confirmPassword && password === confirmPassword
                        ? "text-emerald-300"
                        : "text-slate-400"
                    }
                  >
                    {confirmPassword && password === confirmPassword ? "✓" : "•"} Mật khẩu nhập lại khớp
                  </li>
                </ul>
              </>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-600 px-4 py-3 font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:shadow-xl hover:shadow-indigo-500/40 disabled:opacity-50"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                {loading && (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                  </svg>
                )}
                {loading ? "Đang xử lý..." : mode === "login" ? "Đăng nhập" : "Đăng ký"}
              </span>
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Được bảo vệ bởi Better Auth · Encore
        </p>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder-slate-500 outline-none transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40";

function PasswordInput({
  value,
  onChange,
  visible,
  onToggle,
  autoComplete,
}: {
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  autoComplete: string;
}) {
  const Icon = visible ? EyeSlashIcon : EyeIcon;

  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        className={`${inputClass} pr-12`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="••••••••"
        minLength={6}
        autoComplete={autoComplete}
        required
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 transition-colors hover:text-white"
        aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
        title={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
      >
        <Icon className="h-5 w-5" />
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-300">{label}</label>
      {children}
    </div>
  );
}
