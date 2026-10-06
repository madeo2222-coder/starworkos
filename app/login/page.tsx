"use client";

import { FormEvent, use, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { getLoginCallbackErrorMessage, getLoginSendErrorMessage } from "@/lib/login-errors";

export default function LoginPage({ searchParams }: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const params = use(searchParams);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(() =>
    getLoginCallbackErrorMessage(typeof params.error === "string" ? params.error : ""),
  );
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsLoading(true);

    try {
      const supabase = createClient();

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setMessage(getLoginSendErrorMessage(error));
        return;
      }

      setMessage("ログイン用リンクをメールへ送信しました。最後に届いたメールのリンクを、このブラウザーで開いてください。");
    } catch {
      setMessage("認証サービスへ接続できませんでした。通信状態を確認し、続く場合はこの画面を管理者にお知らせください。");
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
          <p role="status" className="mt-5 rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-700">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
