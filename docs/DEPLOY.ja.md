# デプロイと運用の手順(日本語)

日本人留学生向けの生活立ち上げガイドのシリーズを、コメント欄・編集モードつきでAWSに公開するための一式です。
Claude Code で作業するときの決まりは `CLAUDE.md` にまとめています。
以下のコマンドは、リポジトリのルート(`my-guide-aws/`)で実行します。

```
site/
  index.html         シリーズの目次(トップページ)
  shopee/index.html  Shopee編
  <slug>/index.html  そのほかの記事
  comments.js        コメント欄(全記事共通)
  edit.js            編集モード
  config.js          Turnstileの設定(任意)
  admin.html         管理画面(コメント承認、各ページの編集)
templates/           新しい記事・目次のひな形
src/app.mjs          API(Lambda)
template.yaml        AWS構成(SAM)
deploy.sh            公開用スクリプト
pull-site.sh         編集モードでの変更を手元に取り込む
new-page.sh          新しい記事を作る
migrate-to-series.sh 1ページ構成からシリーズ構成への移行(1回だけ)
CLAUDE.md            Claude Code向けの作業ルール
```

## 構成

```
閲覧者 ──> CloudFront ──┬─ /*     ──> S3(ページ)
                        └─ /api/* ──> Lambda関数URL ──> DynamoDB(コメント)
                                                    └─> SNS(新着通知メール)
```

- コメントは「承認待ち」で保存され、管理画面で承認したものだけが表示されます。
- 新しいコメントが届くとメールで通知されます。
- Lambdaの関数URLは、CloudFrontが付ける秘密ヘッダーがないリクエストを拒否します。
- AWS Budgetsで月1ドルを超えたらメールが届きます。

## 費用の目安

| 項目 | 見込み |
|---|---|
| CloudFront(定額プラン Free)、S3 | 0円 |
| Lambda、DynamoDB(プロビジョンド)、SNSメール通知 | 無料枠内で0円 |
| AWS Budgets(予算アラート) | 2個まで無料 |
| 独自ドメインを付ける場合 | Route 53 月0.5ドル+.com年15ドル前後 |

## 必要なもの

- AWSアカウントとAWS CLI(`aws configure` 済み)
- AWS SAM CLI
- Node.js 22

## 初回デプロイ

### 1. 秘密の文字列を2つ作る

```bash
openssl rand -hex 24   # → AdminToken(管理画面の合言葉)
openssl rand -hex 24   # → OriginSecret(CloudFront用)
```

どちらもパスワード管理ツールなどに保存しておいてください。

### 2. AWSに構築する

```bash
sam build
sam deploy --guided
```

質問にはこう答えます。

| 質問 | 入力 |
|---|---|
| Stack Name | `inti-subang-shopee` |
| AWS Region | `ap-southeast-1`(シンガポール。マレーシアから近い) |
| AdminToken / OriginSecret | 手順1で作った文字列 |
| TurnstileSecret | 空欄でOK(あとで設定可) |
| NotifyEmail | 通知を受け取るメールアドレス |
| BudgetLimitUsd / PageId | そのままEnter |
| Allow SAM CLI IAM role creation | `Y` |
| CommentsFunction Function Url has no authentication | `y`(秘密ヘッダーで保護しているため) |
| Save arguments to configuration file | `Y` |

### 3. 通知メールを有効にする

`AWS Notification - Subscription Confirmation` というメールが届くので、本文の「Confirm subscription」を開きます。これをしないと新着通知が届きません。

### 4. ページをアップロードする

```bash
chmod +x deploy.sh
./deploy.sh --site-only
```

最後に表示されるURLでサイトと管理画面を開けます。

### 5. CloudFrontを定額プラン(Free)にする

AWSコンソールのCloudFrontで、作成されたディストリビューションを開き、料金プランを定額プランの「Free」に切り替えます。超過料金が発生しないので、アクセスが急増しても請求が増えません。

画面の名前は変わることがあるので、見つからない場合はCloudFrontのドキュメントで「flat-rate pricing plans」を確認してください。

### 6. WAFの設定をsamconfigに書き込む

Freeプランに切り替えると、AWSが自動でWAF(Web ACL)を付けます。テンプレートにその指定がないと、次の `sam deploy` が「WAFを外す変更」として拒否されるため、今付いているWAFを設定に書き込みます。

```bash
./set-webacl.sh
```

### 7. デプロイ先アカウントを固定する(推奨)

```bash
aws sts get-caller-identity --query Account --output text > .expected-account
```

以後、`deploy.sh` は別のAWSアカウントにログインしているときは止まります(`.expected-account` はGitに入りません)。

## 新しい記事を作る

```bash
./pull-site.sh                       # 編集モードでの変更を先に取り込む
./new-page.sh bank "銀行口座 編" "マレーシアの銀行口座を開設するまでの手順。"
```

`site/bank/index.html` がひな形から作られ、トップの記事一覧にも追加されます。本文を書いたら公開します。

```bash
python3 -m http.server 8000 --directory site   # http://localhost:8000/bank/ で確認
git add . && git commit -m "銀行口座 編を追加"
./deploy.sh --site-only
```

本文は、Claude Code に「site/bank/index.html に銀行口座編の本文を書いて」と頼むか、公開してから編集モードで書き込めます。
フォルダ名(上の例の `bank`)はURLとコメントの保存先になるので、公開後は変えないでください。

## 日々の使い方

- **コメントの承認**:通知メールが来たら `https://(サイトのURL)/admin.html` を開き、合言葉を入れて「承認して公開」または「削除」。
- **ページの修正(ブラウザで)**:下の「編集モード」を参照。
- **ページの修正(手元で)**:`./pull-site.sh` で最新を取り込み、`site/index.html` を編集して `./deploy.sh --site-only`。
- **Lambdaや構成の変更**:`./deploy.sh`(ビルドとデプロイも実行)。

## 編集モード(ブラウザでページを直接直す)

1. 管理画面 `https://(サイトのURL)/admin.html` を開き、合言葉を入れる
2. 「ページを編集」を押す
3. 点線で囲まれた文字をクリックして書き換える
   - 項目を増やす:箇条書きの行末でEnter
   - 太字:文字を選んで「太字」
   - 貼り付けは書式なしの文字だけになります
4. 「保存して公開」を押す(数分で全員の画面に反映)
5. 「編集をやめる」で通常の表示に戻る

コメント欄は編集モードでは触れないようになっています。保存のたびに前の版がS3に残るので(90日間)、失敗してもAWSコンソールのS3 → バケット → `index.html` →「バージョン」から戻せます。

### 編集モードと手元のファイルの関係

編集モードで直した内容は公開中のページにだけ入り、手元の `site/index.html` には入りません。手元で作業する前に、必ず取り込んでください。

```bash
./pull-site.sh
git commit -am "編集モードでの変更を取り込み"
```

取り込みを忘れたまま `./deploy.sh` を実行すると、編集モードでの変更を上書きしないよう、自動で止まります。

## ボット対策を強くしたいとき(任意・無料)

スパムが増えてきたら Cloudflare Turnstile を有効にします。

1. Cloudflareのダッシュボードで Turnstile のサイトを追加し、ドメインに `xxxx.cloudfront.net`(または独自ドメイン)を登録
2. Site Key を `site/config.js` の `turnstileSiteKey` に入れる
3. `sam deploy --parameter-overrides TurnstileSecret=(Secret Key)` を実行
4. `./deploy.sh --site-only`

## 困ったとき

- **コメント欄が「読み込めませんでした」になる**:
  CloudWatch Logsの `/aws/lambda/(関数名)` を確認してください。
- **管理画面で「合言葉が違います」**:AdminTokenの前後に空白が入っていないか確認してください。

## 片付け

```bash
aws s3 rm s3://(BucketName) --recursive
sam delete --stack-name inti-subang-shopee
```

DynamoDBのコメントも消えるので、残したい場合は先にエクスポートしてください。
