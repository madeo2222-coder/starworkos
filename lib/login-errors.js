/** Return a fixed public message; never expose provider messages or tokens. */
export function getLoginSendErrorMessage(error) {
  switch (error?.code) {
    case "over_email_send_rate_limit":
      return "認証メールの送信回数が上限に達しています。時間を置いてから再送してください。";
    case "over_request_rate_limit":
      return "短時間に送信が集中しています。少し時間を置いてから再送してください。";
    case "email_address_not_authorized":
      return "認証メールの配信設定により、このアドレスには送信できません。管理者によるメール配信設定の確認が必要です。";
    case "email_address_invalid":
    case "validation_failed":
      return "メールアドレスの入力を確認してください。";
    case "email_provider_disabled":
    case "otp_disabled":
    case "signup_disabled":
      return "このアドレスでのメールログインを受け付けられません。管理者による認証設定の確認が必要です。";
    default:
      if (error?.status === 429) {
        return "認証サービスの利用回数が上限に達しています。時間を置いてから再送してください。";
      }
      return "ログインリンクを送信できませんでした。通信状態を確認し、続く場合はこの画面を管理者にお知らせください。";
  }
}

/** Map provider errors to a small allowlist used in callback redirects. */
export function getLoginCallbackErrorCode(error) {
  switch (error?.code) {
    case "pkce_code_verifier_not_found":
      return "auth_browser_missing";
    case "bad_code_verifier":
      return "auth_link_mismatch";
    case "otp_expired":
    case "flow_state_expired":
    case "flow_state_not_found":
      return "auth_link_expired";
    default:
      return "auth_callback_failed";
  }
}

export function getLoginCallbackErrorMessage(code) {
  switch (code) {
    case "auth_browser_missing":
      return "メール送信時の認証情報が、このブラウザーに見つかりません。Safariでログイン画面を開いてメールを送り、届いたリンクも同じSafariで開いてください。";
    case "auth_link_mismatch":
      return "送信時の認証情報とリンクが一致しません。メールを送ったブラウザーで、最後に届いたメールのリンクを開いてください。";
    case "auth_link_expired":
      return "認証リンクが期限切れ、または使用済みです。新しいメールを送信し、最後に届いたリンクを開いてください。";
    case "auth_callback_failed":
      return "メールのリンクによるログインを完了できませんでした。メールを送ったブラウザーで最新のリンクを開いてください。続く場合はこの画面を管理者にお知らせください。";
    default:
      return "";
  }
}
