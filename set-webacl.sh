#!/usr/bin/env bash
# CloudFrontの定額プランで自動的に付いたWAF(Web ACL)のARNを調べ、samconfig.toml に書き込む
# (書き込まないと、sam deploy がWAFを外そうとして失敗する)
set -euo pipefail
STACK="${STACK:-inti-subang-shopee}"
REGION="${REGION:-ap-southeast-1}"
cd "$(dirname "$0")"

[[ -f samconfig.toml ]] || { echo "samconfig.toml がありません。先に sam deploy --guided を実行してください。"; exit 1; }

DIST="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)"
ARN="$(aws cloudfront get-distribution-config --id "$DIST" --query 'DistributionConfig.WebACLId' --output text)"
if [[ -z "$ARN" || "$ARN" == "None" ]]; then
  echo "このディストリビューションにはWAFが付いていません。設定は不要です。"; exit 0
fi
echo "WAF: $ARN"

ARN="$ARN" python3 - <<'PY'
import os, re
arn = os.environ["ARN"]
p = "samconfig.toml"
s = open(p, encoding="utf-8").read()
m = re.search(r'^parameter_overrides = "(.*)"$', s, re.M)
if not m:
    raise SystemExit("samconfig.toml に parameter_overrides が見つかりません。")
body = re.sub(r'\s*WebAclArn=\\"[^"\\]*\\"', "", m.group(1))
body += f' WebAclArn=\\"{arn}\\"'
s = s[:m.start(1)] + body + s[m.end(1):]
open(p, "w", encoding="utf-8").write(s)
print("samconfig.toml に WebAclArn を設定しました。")
PY
