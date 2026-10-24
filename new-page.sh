#!/usr/bin/env bash
# 新しい記事を作る
#   ./new-page.sh bank "銀行口座 編" "マレーシアの銀行口座を開設するまでの手順。"
# site/bank/index.html を作り、トップの記事一覧に追加します(まだ公開はしません)
set -euo pipefail
cd "$(dirname "$0")"

SLUG="${1:-}"; TITLE="${2:-}"; DESC="${3:-}"
if [[ -z "$SLUG" || -z "$TITLE" ]]; then
  echo "使い方: ./new-page.sh <フォルダ名> \"<タイトル>\" \"<説明>\""
  echo "  例:   ./new-page.sh bank \"銀行口座 編\" \"マレーシアの銀行口座を開設するまでの手順。\""
  exit 1
fi
if [[ ! "$SLUG" =~ ^[a-z0-9-]{1,40}$ ]]; then
  echo "フォルダ名は半角の小文字・数字・ハイフンだけにしてください(例: bank, phone-sim)"; exit 1
fi
if [[ -e "site/$SLUG" ]]; then
  echo "site/$SLUG はすでにあります。"; exit 1
fi
if [[ ! -f site/shopee/index.html ]]; then
  echo "先に ./migrate-to-series.sh でシリーズ構成に移行してください。"; exit 1
fi

SLUG="$SLUG" TITLE="$TITLE" DESC="${DESC:-説明を書きます。}" python3 - <<'PY'
import os, html, datetime
slug, title, desc = os.environ["SLUG"], os.environ["TITLE"], os.environ["DESC"]
t, d = html.escape(title), html.escape(desc)
asof = f"{datetime.date.today().year}年{datetime.date.today().month}月"

s = open("templates/article.html", encoding="utf-8").read()
s = s.replace("{{SLUG}}", slug).replace("{{TITLE}}", t).replace("{{DESC}}", d).replace("{{ASOF}}", asof)
os.makedirs(f"site/{slug}", exist_ok=True)
open(f"site/{slug}/index.html", "w", encoding="utf-8").write(s)

top = open("site/index.html", encoding="utf-8").read()
marker = "<!-- ARTICLES:"
if marker not in top:
    print("注意: トップページに記事一覧の目印がないため、一覧には追加しませんでした。手で追加してください。")
else:
    short = title.replace(" 編", "").replace("編", "")[:6]
    card = (f'<li class="article"><a href="/{slug}/"><span class="no" aria-hidden="true">{html.escape(short)}</span>'
            f'<span class="txt"><b>{t}</b><small>{d}</small></span></a></li>\n    ')
    i = top.index(marker)
    top = top[:i] + card + top[i:]
    open("site/index.html", "w", encoding="utf-8").write(top)
print(f"作成しました: site/{slug}/index.html")
PY

echo
echo "次の手順:"
echo "  1. site/$SLUG/index.html の本文を書く(Claude Codeに頼むか、公開後に編集モードで)"
echo "  2. python3 -m http.server 8000 --directory site で http://localhost:8000/$SLUG/ を確認"
echo "  3. git add . && git commit -m \"$TITLE を追加\""
echo "  4. ./deploy.sh --site-only"
