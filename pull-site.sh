#!/usr/bin/env bash
# 編集モードで公開中のページに加えた変更を、手元の site/ に取り込む
set -euo pipefail

STACK="${STACK:-inti-subang-shopee}"
REGION="${REGION:-ap-southeast-1}"
STATE=".last-deploy"
cd "$(dirname "$0")"

if ! git diff --quiet -- site; then
  echo "site/ にコミットしていない変更があります。上書きしないよう中止しました。"
  echo "先に git commit するか、git stash で退避してから実行してください。"
  exit 1
fi

BUCKET="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)"

: > "$STATE.tmp"
while IFS= read -r f; do
  key="${f#site/}"
  aws s3 cp "s3://$BUCKET/$key" "site/$key" --region "$REGION" --only-show-errors
  etag="$(aws s3api head-object --bucket "$BUCKET" --key "$key" --region "$REGION" --query ETag --output text)"
  echo "$key $etag" >> "$STATE.tmp"
done < <(find site -name index.html | sort)
mv "$STATE.tmp" "$STATE"

if git diff --quiet -- site; then
  echo "公開中のページと手元のファイルは同じです。"
else
  echo "公開中のページを取り込みました。変更点:"
  git --no-pager diff --stat -- site
  echo
  echo "内容を確認して、問題なければコミットしてください:"
  echo "  git commit -am \"編集モードでの変更を取り込み\""
fi
