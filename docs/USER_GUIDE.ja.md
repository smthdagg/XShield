# XShield ユーザーガイド

## 1. インストール

1. Chrome で `chrome://extensions` を開きます。
2. **Developer mode** を有効にします。
3. **Load unpacked** をクリックします。
4. `apps/extension/dist` を選択します。
5. XShield を Chrome ツールバーに固定します。

ソースからビルドする場合：

```bash
corepack enable
pnpm install
pnpm build
```

その後、`apps/extension/dist` を読み込みます。

## 2. ルール作成

Dashboard の **Rules** で検出ルールを作成します。

- `keyword`: 通常のキーワード。一行に一つ。
- `regex`: 正規表現。一行に一つ。
- 対象フィールド: username、displayName、bio、content。
- Score: 一致したときに加算されるリスクスコア。

一致した投稿は淡い黄色でハイライトされ、ユーザーは候補一覧に追加されます。

## 3. 候補ユーザーの確認

**Candidate Users** で、アイコン、プロフィールリンク、自己紹介、フォロワー情報、検出理由を確認します。誤検出はホワイトリストへ、対象ユーザーはブロックキューへ追加します。

## 4. ブロックキューの実行

- **Run Batch**: 設定されたバッチサイズ、間隔、モードに従って実行します。
- **Manual Block Now**: 間隔制限を無視して手動実行します。短時間で大量に実行するとアカウントに影響する可能性があります。
- **Start/Stop**: 自動キューを一時停止または再開します。

## 5. ブロック済みユーザーのエクスポート

**Blocked Users** から TXT、CSV、JSON、NDJSON、SQL 形式でエクスポートできます。

## 6. 実ブロックモードの注意

実ブロックモードは Chrome 内の X/Twitter ログイン状態に依存します。X の Web API、ログイン状態、CSRF 処理、ページ構造が変更されると動作しない場合があります。少量のバッチと長めの間隔を推奨します。
