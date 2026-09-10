# Phase 2-B1: AI PM STEP 1「要件整理」実働化

## 目的

既存の `run-ai` 実行経路と保存先を維持したまま、STEP 1のAI PMがCEOの依頼を、AI Architect・AI Developer・AI QAへ渡せる検証可能な要件へ変換する。

このPR準備ブランチはOpenAI呼び出しを有効化せず、本番DB、Secret、外部dispatch、Vercel設定を変更しない。安全強化用のDB migrationはローカルに作成するが、本番には未適用とする。

## 現行フローの調査結果

`POST /api/workflow-steps/[stepId]/run-ai` は次の順で処理する。

1. ログインユーザーを確認してから、上限付きでリクエスト本文を読み取る。
2. Workflow IDとSTEP IDを検証し、対象STEPとWorkflowを取得する。
3. Workflowが `IN_PROGRESS`、対象STEPが現在工程かつ `IN_PROGRESS` であることを確認する。
4. `requires_human_approval=true` かつ未承認なら409で停止する。
5. `start_workflow_ai_run` RPCで状態を再確認し、`execution_history` の `RUNNING` を原子的にclaimする。5分以上残った実行は監査履歴を `ERROR` にしてから再実行可能にする。
6. CEO指示、担当AI社員、前工程の成果物から上限付きプロンプトを作る。
7. OpenAI Responses APIを、2分タイムアウト・再試行なし・最大6,000出力トークン・保存なしで呼ぶ。
8. 完了したJSON応答だけを検証し、文字数上限内の `work_note` と `deliverable` に正規化する。
9. `finalize_workflow_ai_run` RPCでSTEP成果物、AI社員の引継ぎ、`SUCCESS`履歴を1トランザクションで確定する。
10. 失敗時は、まだ `RUNNING` の実行履歴だけを `ERROR` に更新する。

STEPの完了と次工程への遷移はAPI内では行わず、既存RPC `complete_current_workflow_step` が担当する。次工程が承認必須なら、同RPCがSTEPとWorkflowを `HUMAN_REVIEW` にしてCEO Inboxへ承認依頼を作成する。したがって、今回の要件整理用プロンプト変更で人間承認状態や遷移RPCは変更しない。

## 実装設計

- プロンプト生成とAI応答解析を `lib/workflow-ai.js` へ分離し、OpenAIやSupabaseなしで単体テストできるようにする。
- Workflowの件名、説明、優先度を既存の取得クエリへ加え、AI PMがTask由来の背景を参照できるようにする。
- STEP 1または工程名が「要件整理」の場合だけ、次の成果物契約を追加する。
  - 目的・期待する成果
  - 対象範囲
  - 対象外
  - 機能要件
  - 非機能要件
  - 制約・既存仕様
  - 受入条件
  - 未確定事項・確認事項
  - リスク
  - 次工程への引継ぎ
- mainマージ、Production deploy、本番DB migration、Secret・Environment変更、破壊的操作は「人間承認待ち」として出力させる。
- 保存カラムとレスポンス契約は `work_note` / `deliverable` のまま維持する。原子的な開始・確定用RPCと二重実行防止インデックスはmigrationで追加する。
- 失敗履歴にはOpenAI・DBの生メッセージを保存せず、タイムアウト、利用上限、設定、接続、回答形式、DB操作などの上限付き監査分類だけを保存する。詳細はサーバーログで確認する。
- ブラウザから呼ぶSTEP完了・CEO承認RPCは、対象テーブルのRLS有効化をmigrationで事前確認し、`SECURITY INVOKER`で利用者のRLS権限を維持する。service-role専用callback RPCは対象外とする。
- 後続STEPにはSTEP 1専用テンプレートを強制せず、共通の人間承認ルールだけを適用する。

## ローカルテスト設計

`tests/workflow-ai.test.mjs` で以下を固定する。

1. STEP 1と「要件整理」を要件整理工程として識別できる。
2. AI PMプロンプトにWorkflow背景と10項目の成果物契約が含まれる。
3. 後続STEPには要件整理専用契約を混入させない。
4. JSONとJSONコードフェンスの応答を保存形式へ正規化できる。
5. 空、JSON不正、必須項目不足、空文字の成果物を拒否する。
6. Workflow状態、現在STEP、人間承認の全ガードが、実行履歴claimとOpenAI呼び出しより前に残っている。
7. 同じSTEPの同時実行を拒否し、5分以上残った実行だけを安全に復旧できる。
8. STEP成果物、引継ぎメッセージ、成功履歴を原子的に確定できる。

既存CIと同じ順番で `npm test`、`npm run lint`、`npm run build` を実行する。

## CI切り分け

- mainのGitHub Actions `CI` は成功している。
- PR #2のHEADは、CI workflow追加前のmainから分岐しているため、PR側GitHub Actionsが発火していない。
- PR #2は現在のmainより1 commit古い。PR #2を最新mainへ同期すれば、既存の `pull_request` トリガーでCIが発火する設計になっている。
- Vercelの3件の失敗はコード失敗ではなく重複プロジェクトによるbuild rate limitであり、GitHub Actionsの品質結果とは分離して扱う。

## PR準備状態

想定ブランチ: `feat/external-agent-boundary-hardening`

想定タイトル: `feat: harden external-agent and Workflow AI boundaries`

PR本文には次を明記する。

- DB migrationは作成済み・未適用
- Secret・Environment変更なし
- 外部dispatchなし
- 人間承認ガードとSTEP遷移RPCの変更なし
- ローカルのtest / lint / build結果
- 反映順はDB migration適用後にコードをデプロイ
- Previewではログイン後にSTEP 1を手動実行し、要件10項目が保存・表示されることだけを確認する

## Preview確認項目

1. NEW TaskからWorkflowを作成する。
2. STEP 1「要件整理」を開く。
3. 「AI社員へ依頼する」を1回実行する。
4. 作業メモと成果物が保存され、成果物に10項目が含まれることを確認する。
5. 未確定情報が事実扱いされず、確認事項に分離されることを確認する。
6. 承認対象操作が必要な依頼では「人間承認待ち」と表示されることを確認する。
7. 承認必須STEPでは未承認の実行が409で拒否されることを確認する。

## 後続課題

複数ブラウザや重複リクエストのDB上のclaim、放置された `RUNNING` の復旧、成功結果の原子的確定は、このPR準備ブランチで対応済み。本番反映前に、追加migration内の事前検査が既存データに対して成功することを確認する。
