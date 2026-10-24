# はじめての INTI Subang 留学(ガイドサイト)

INTI International College Subang に留学する日本人(留学生・保護者)向けの、生活立ち上げガイドのシリーズ。
1テーマ=1記事で、AWS(S3 + CloudFront)で公開している。コメント欄と編集モードあり。

## フォルダ構成

```
site/index.html          シリーズの目次(トップページ)
site/<slug>/index.html   各記事(例: site/shopee/index.html → /shopee/)
site/comments.js         コメント欄(全記事共通)
site/edit.js             編集モード(管理者がブラウザで直接書き換える)
site/admin.html          管理画面(コメント承認、各ページの編集入口)
templates/article.html   新しい記事のひな形
templates/top.html       目次ページのひな形(移行時のみ使用)
src/app.mjs              API(Lambda):コメント、ページ一覧、編集モードの保存
template.yaml            AWS構成(SAM)
```

## 新しい記事を作るとき

1. まず `./new-page.sh <slug> "<タイトル> 編" "<1文の説明>"` でひな形を作る(目次への追加も自動)
   - slug は半角小文字・数字・ハイフン(例: `bank`, `phone-sim`)。URLとコメントの保存先になるので、公開後は変えない
2. `site/<slug>/index.html` の本文を書く。構成は既存の `site/shopee/index.html` に合わせる
   - header(戻るリンク、eyebrow、h1、lead、chip)→ STEP 0 準備チェックリスト → 手順(ol.steps)→ 必要なら比較表 → よくある質問 → コメント欄 → footer
   - CSS は各ページ内の `<style>` にある既存のクラスとトークン(`--teal` など)だけを使う。新しい色やフォントを足さない
   - チェックリストの `id`(c1, c2...)はページ内で重複させない。`#progress` の数(0 / N)を項目数に合わせる
   - コメント欄の `<section ... data-page="<slug>">` はフォルダ名と一致させる。コメント欄の中身は変えない
3. 手元で確認: `python3 -m http.server 8000 --directory site` → `http://localhost:8000/<slug>/`
   (手元ではコメント欄が「読み込めませんでした」になるのは正常)

## 文章のルール

- 日本語のみ。です・ます調。短い文で、専門用語には説明を添える
- 読者は日本から来たばかりの留学生と、その保護者。現地の口座やSIMがまだない前提で書く
- 手続き・料金・必要書類などの事実は、必ずWeb検索で最新の公式情報を確認してから書く。確認できないことは断定しない(「〜の場合があります」「窓口で確認してください」)
- 実在の住所・電話番号・個人名を例に使わない。例は「Jalan Contoh」のように架空と分かるものにし、「実在の住所ではありません」と添える
- footer の「INTIや各サービスの公式ページではありません」と「○年○月時点」の注記は必ず残す。内容を見直したら日付を更新する
- 絵文字は使わない

## 公開(デプロイ)

- 事前に `aws login` が必要(12時間で切れる)。`aws sts get-caller-identity` のアカウントが **末尾 3840** であることを確認。末尾 1409 のアカウントには絶対にデプロイしない
- ページだけの変更: `./deploy.sh --site-only`
- `src/` や `template.yaml` を変えたとき: `./deploy.sh`(確認で `y`)
- 管理者が編集モードで公開中のページを直接直していることがある。手元で記事を編集する前に、必ず `./pull-site.sh` で取り込む
- `deploy.sh` が「編集モードで変更されています」で止まったら `--force` を付けず、`./pull-site.sh` で取り込んでから再実行する。`--force` はユーザーが明示的に頼んだときだけ使う
- 公開する前に、何を変えたかをユーザーに説明して確認を取る

## 触らないもの

- `samconfig.toml`(合言葉などの秘密が入っている。Gitに入れない、中身を表示しない)
- `template.yaml` の `PageId`(Shopee編のコメントの保存先。変えるとコメントが消えたように見える)
- CloudFront の料金プランはコンソールで Free に設定済み。`template.yaml` の Distribution を変更したら、Free のままか確認するようユーザーに伝える
