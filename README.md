# モンソニ！楽曲マイランキング

モンスターストライク「モンソニ！」の楽曲から2曲ずつ選んで、TOP10を決める非公式ファンメイドのソートゲーム。
ビルド不要の静的サイト（HTML / CSS / JS のみ）。

## ローカルで動かす

```bash
python -m http.server 8765
```

http://localhost:8765 を開く。

## 公開する（GitHub Pages の例）

1. このフォルダを GitHub リポジトリに push
2. リポジトリの Settings → Pages → Branch を `main` / `(root)` にして保存
3. 公開URLが決まったら `index.html` の `og:image` を絶対URLに書き換える
   （例: `https://<ユーザー名>.github.io/<リポジトリ名>/og.png`）。X のカード画像に必要です

Cloudflare Pages / Netlify でも、このフォルダをそのままアップロードすれば動きます。

## ファイル

| ファイル | 内容 |
| --- | --- |
| `js/songs.js` | 楽曲データ。曲の追加・削除はここだけ |
| `js/engine.js` | ソートの仕組み（第1ステージ: 勝ち抜きでTOP10を確定、第2ステージ: 残りの順位を決定） |
| `js/app.js` | 画面と操作。ユニットのペンライト色もここ |
| `js/share.js` | X 投稿テキストと結果画像の生成 |
| `og.png` | SNS カード画像（1200×630） |

曲データを変えると、保存済みの途中経過は自動で破棄されます。
