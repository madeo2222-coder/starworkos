# Phase 2-B1: AI PM STEP 1「要件整理」実働化

## 目的

既存の `run-ai` 実行経路と保存先を維持したまま、STEP 1のAI PMがCEOの依頼を、AI Architect・AI Developer・AI QAへ渡せる検証可能な要件へ変換する。

この差分はOpenAI呼び出しを有効化せず、本番DB、Secret、外部dispatch、Vercel設定を変更しない。

## 現行フローの調査結果

`POST /api/workflow-steps/[stepId]/run-ai` は次の順で処理する。

1. ログインユーザーを確認する。
2. 対象STEPとWorkflowを取得する。
3. Workflowが `IN_PROGRESS`、対象STEPが現在工程かつ `IN_PROGRESS` であることを確認する。
4. `requires_human_approval=true` かつ未承認なら409で停止する。
5. `execution_history` に `RUNNING` を保存する。
6. CEO指示、担当AI社員、前工程の成果物からプロンプトを作る。
7. OpenAI Responses APIを呼ぶ。
8. `workflow_steps.work_note` と `workflow_steps.deliverable` を更新する。
9. `workflow_messages` にAI社員の引継ぎを保存する。
10. `execution_history` を `SUCCESS` または `ERROR` に更新する。

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
- 保存カラムとレスポンス契約は `work_note` / `deliverable` のままにし、DB migrationを不要にする。
- 後続STEPにはSTEP 1専用テンプレートを強制せず、共通の人間承認ルールだけを適用する。

## ローカルテスト設計

`tests/workflow-ai.test.mjs` で以下を固定する。

1. STEP 1と「要件整理」を要件整理工程として識別できる。
2. AI PMプロンプトにWorkflow背景と10項目の成果物契約が含まれる。
3. 後続STEPには要件整理専用契約を混入させない。
4. JSONとJSONコードフェンスの応答を保存形式へ正規化できる。
5. 空、JSON不正、必須項目不足、空文字の成果物を拒否する。
6. Workflow状態、現在STEP、人間承認の全ガードが、実行履歴保存とOpenAI呼び出しより前に残っている。

既存CIと同じ順番で `npm test`、`npm run lint`、`npm run build` を実行する。

## CI切り分け

- mainのGitHub Actions `CI` は成功している。
- PR #2のHEADは、CI workflow追加前のmainから分岐しているため、PR側GitHub Actionsが発火していない。
- PR #2は現在のmainより1 commit古い。PR #2を最新mainへ同期すれば、既存の `pull_request` トリガーでCIが発火する設計になっている。
- Vercelの3件の失敗はコード失敗ではなく重複プロジェクトによるbuild rate limitであり、GitHub Actionsの品質結果とは分離して扱う。

## PR準備状態

想定ブランチ: `feat/phase-2b1-ai-pm-requirements`

想定タイトル: `feat: operationalize AI PM requirements step`

PR本文には次を明記する。

- DB migrationなし
- Secret・Environment変更なし
- 外部dispatchなし
- 人間承認ガードとSTEP遷移RPCの変更なし
- ローカルのtest / lint / build結果
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

現在のAI実行は、複数ブラウザや重複リクエストをDB上で原子的にclaimしていない。二重実行防止はPhase 2-B1の要件整理品質とは分離し、既存テーブル定義と本番データを確認したうえで専用RPCとmigrationを別PRにする。Preview開始を止める課題ではないが、本格的な自動リレー運用前には対応する。
