#!/usr/bin/env bash
# 1回だけ実行:1ページ構成から、シリーズ構成(/ = 目次、/shopee/ = Shopee編)に移行する
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f site/shopee/index.html ]]; then
  echo "すでにシリーズ構成に移行済みです。"; exit 0
fi
if ! git diff --quiet -- site || ! git diff --cached --quiet -- site; then
  echo "site/ にコミットしていない変更があります。先に git commit してください。"; exit 1
fi

mkdir -p site/shopee
git mv site/index.html site/shopee/index.html

python3 - <<'PY'
p = "site/shopee/index.html"
s = open(p, encoding="utf-8").read()

def rep(a, b):
    global s
    if a not in s:
        raise SystemExit(f"想定した記述が見つかりません: {a[:50]}")
    s = s.replace(a, b, 1)

# 別のフォルダに移ってもスクリプトが読み込めるよう、絶対パスにする
rep('<script src="config.js"></script>', '<script src="/config.js"></script>')
rep('<script src="comments.js" defer></script>', '<script src="/comments.js" defer></script>')
# コメントをこのページに紐づける
rep('<section aria-labelledby="cm-title">', '<section aria-labelledby="cm-title" data-page="shopee">')
# トップへ戻るリンク
rep('<header>\n', '<header>\n  <a class="back" href="/">← はじめての INTI Subang 留学 トップ</a>\n')
rep('</style>', '''
/* シリーズ共通 */
.back{font-size:.85rem;color:var(--muted);text-decoration:none;display:inline-flex;gap:6px;align-items:center}
.back:hover{color:var(--teal)}
</style>''')
open(p, "w", encoding="utf-8").write(s)
PY

cp templates/top.html site/index.html
git add site
echo "移行しました。"
echo "  /         → シリーズの目次(site/index.html)"
echo "  /shopee/  → Shopee編(site/shopee/index.html)"
echo
echo "次に実行:"
echo "  git commit -m \"シリーズ構成に移行\""
echo "  ./deploy.sh"
