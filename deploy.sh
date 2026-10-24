#!/usr/bin/env bash
# サイトのファイルをS3に上げて、CloudFrontのキャッシュを消す
#   ./deploy.sh              Lambdaや構成も含めてデプロイ
#   ./deploy.sh --site-only  ページだけ更新
#   --force                  編集モードでの変更を上書きしてでも公開する
# 初回は先に `sam build && sam deploy --guided` を実行しておくこと
set -euo pipefail

STACK="${STACK:-inti-subang-shopee}"
REGION="${REGION:-ap-southeast-1}"
STATE=".last-deploy"   # 最後に公開したページの版(ETag)を記録する
cd "$(dirname "$0")"

SITE_ONLY=0; FORCE=0
for a in "$@"; do
  case "$a" in
    --site-only) SITE_ONLY=1 ;;
    --force) FORCE=1 ;;
    *) echo "不明なオプション: $a"; exit 1 ;;
  esac
done

out() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
etag_of() {
  aws s3api head-object --bucket "$BUCKET" --key "$1" --region "$REGION" \
    --query ETag --output text 2>/dev/null || echo "missing"
}

if [[ $SITE_ONLY -eq 0 ]]; then
  sam build
  sam deploy --stack-name "$STACK" --region "$REGION"
fi

BUCKET="$(out BucketName)"
DIST="$(out DistributionId)"

# 編集モードで公開中のページが変わっていたら、手元の古いファイルで上書きしないよう止める
if [[ -f "$STATE" && $FORCE -eq 0 ]]; then
  changed=()
  while read -r key etag; do
    [[ -z "$key" ]] && continue
    [[ "$(etag_of "$key")" != "$etag" ]] && changed+=("$key")
  done < "$STATE"
  if (( ${#changed[@]} )); then
    echo "公開中のページが編集モードで変更されています: ${changed[*]}"
    echo "先に ./pull-site.sh で手元に取り込んでから、もう一度実行してください。"
    echo "(編集モードでの変更を捨てて上書きする場合は --force を付けて実行)"
    exit 1
  fi
fi

aws s3 sync site/ "s3://$BUCKET/" --delete --region "$REGION" \
  --cache-control "public, max-age=300"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" >/dev/null

# 今回公開したページの版を記録
: > "$STATE"
while IFS= read -r f; do
  key="${f#site/}"
  echo "$key $(etag_of "$key")" >> "$STATE"
done < <(find site -name index.html | sort)

echo "公開しました: $(out SiteUrl)"
echo "管理画面:     $(out AdminUrl)"
