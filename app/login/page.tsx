"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/utils/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsLoading(true);

    try {
      const supabase = createClient();

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setMessage(`送信に失敗しました：${error.message}`);
        return;
      }

      setMessage("ログイン用リンクをメールへ送信しました。");
    } catch {
      setMessage("予期しないエラーが発生しました。");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-gray-500">STAR WORK OS</p>

        <h1 className="mt-2 text-3xl font-bold text-gray-900">
          ログイン
        </h1>

        <p className="mt-3 text-sm leading-6 text-gray-600">
          登録したメールアドレスへログイン用リンクを送信します。
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700"
            >
              メールアドレス
            </label>

            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 outline-none focus:border-gray-900"
              placeholder="name@example.com"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-xl bg-black px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "送信中..." : "ログインリンクを送信"}
          </button>
        </form>

        {message && (
          <p className="mt-5 rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-700">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}