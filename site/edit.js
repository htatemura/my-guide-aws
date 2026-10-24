// 編集モード:公開中のページを直接書き換えて保存する
// 管理画面の「ページを編集」から、ページのURLの末尾に #edit を付けて開く
(function () {
  const API = "/api/admin/page";
  const path = location.pathname.replace(/^\//, "");
  const key = path === "" ? "index.html" : path.endsWith("/") ? path + "index.html" : path;

  let token = "";
  try { token = sessionStorage.getItem("adminToken") || ""; } catch (e) {}
  let doc = null, etag = "", dirty = false, wrap = null, originalComments = null;

  // ---------- 見た目 ----------
  const css = document.createElement("style");
  css.textContent = `
  .ed-bar{position:fixed;left:0;right:0;bottom:0;z-index:50;background:var(--ink);color:var(--bg);
    padding:10px max(16px,env(safe-area-inset-left,0px)) calc(10px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-right,0px));
    display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:.9rem;box-shadow:0 -4px 16px rgba(0,0,0,.2)}
  .ed-bar .ed-status{flex:1;min-width:12em}
  .ed-bar button{font:inherit;font-weight:700;border:0;border-radius:999px;padding:8px 16px;cursor:pointer;background:var(--bg);color:var(--ink)}
  .ed-bar button.ed-primary{background:var(--gold);color:#1d1606}
  .ed-bar button:disabled{opacity:.5;cursor:wait}
  .ed-bar input{font:inherit;font-size:16px;padding:7px 10px;border-radius:8px;border:0;min-width:0;flex:1}
  body.ed-on{padding-bottom:120px}
  body.ed-on .wrap[contenteditable="true"] :is(h1,h2,h3,p,li,td,th,summary,.chip,.eyebrow,.note,.addr,small,b){outline:1px dashed color-mix(in srgb,var(--teal) 45%,transparent);outline-offset:2px}
  body.ed-on .wrap[contenteditable="true"] :is(h1,h2,h3,p,li,td,th,summary,.chip,.eyebrow,.note,.addr,small,b):focus{outline:2px solid var(--gold)}
  body.ed-on .ed-locked{opacity:.45;pointer-events:none}
  body.ed-on .wrap input[type=checkbox]{pointer-events:none;opacity:.5}
  body.ed-on .wrap label{cursor:text}
  `;
  document.head.appendChild(css);

  const bar = document.createElement("div");
  bar.className = "ed-bar";
  bar.setAttribute("role", "toolbar");
  bar.innerHTML = `
    <span class="ed-status" id="ed-status">編集モードを準備しています…</span>
    <input id="ed-token" type="password" placeholder="合言葉" autocomplete="current-password" hidden>
    <button type="button" id="ed-login" hidden>開く</button>
    <button type="button" id="ed-bold" hidden>太字</button>
    <button type="button" id="ed-undo" hidden>元に戻す</button>
    <button type="button" id="ed-save" class="ed-primary" hidden>保存して公開</button>
    <button type="button" id="ed-exit">編集をやめる</button>`;
  document.body.appendChild(bar);
  const $ = (id) => document.getElementById(id);
  const status = (t) => { $("ed-status").textContent = t; };

  async function api(method, body) {
    const opt = { method, headers: { "x-admin-token": token } };
    if (body) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
    const url = method === "GET" ? API + "?key=" + encodeURIComponent(key) : API;
    const res = await fetch(url, opt);
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function askToken(msg) {
    status(msg || "管理画面の合言葉を入力してください。");
    $("ed-token").hidden = false; $("ed-login").hidden = false;
    $("ed-token").focus();
  }
  $("ed-login").onclick = () => {
    token = $("ed-token").value.trim();
    try { sessionStorage.setItem("adminToken", token); } catch (e) {}
    start();
  };
  $("ed-token").addEventListener("keydown", (e) => { if (e.key === "Enter") $("ed-login").click(); });

  async function start() {
    if (!token) return askToken();
    status("ページを読み込んでいます…");
    const { res, data } = await api("GET");
    if (res.status === 401) return askToken("合言葉が違います。もう一度入力してください。");
    if (!res.ok) return status(data.error || "ページを読み込めませんでした。");
    $("ed-token").hidden = true; $("ed-login").hidden = true;

    // 公開中の元ファイルを読み込んで、その中身を編集対象にする
    // (ページ上のスクリプトが書き換えた表示ではなく、保存されている元の文章を編集するため)
    etag = data.etag;
    doc = new DOMParser().parseFromString(data.html, "text/html");
    const srcWrap = doc.querySelector(".wrap");
    wrap = document.querySelector(".wrap");
    if (!srcWrap || !wrap) return status("このページは編集モードに対応していません。");

    wrap.innerHTML = srcWrap.innerHTML;
    wrap.setAttribute("contenteditable", "true");
    wrap.spellcheck = false;
    wrap.querySelectorAll("details").forEach((d) => { d.open = true; });

    // コメント欄は編集できないようにする
    const cm = wrap.querySelector('section[aria-labelledby="cm-title"]');
    originalComments = srcWrap.querySelector('section[aria-labelledby="cm-title"]');
    if (cm) { cm.setAttribute("contenteditable", "false"); cm.classList.add("ed-locked"); }

    // チェックリストの文字はチェックボックスのラベルなので、クリックするとチェックボックスに
    // カーソルが移ってしまう。編集中だけラベルとのつながり(for属性)を外し、保存時に戻す
    wrap.querySelectorAll("label[for]").forEach((l) => {
      l.setAttribute("data-ed-for", l.getAttribute("for"));
      l.removeAttribute("for");
    });

    // summaryをクリックしても開閉しないようにする(文字を編集できるように)
    wrap.addEventListener("click", (e) => { if (e.target.closest("summary")) e.preventDefault(); });

    // 貼り付けは書式なしの文字だけ
    wrap.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });
    wrap.addEventListener("input", () => { if (!dirty) { dirty = true; status("変更あり(まだ公開されていません)"); } });

    ["ed-bold", "ed-undo", "ed-save"].forEach((id) => { $(id).hidden = false; });
    document.body.classList.add("ed-on");
    status("編集できます。文字をクリックして書き換えてください。");
  }

  $("ed-bold").onmousedown = (e) => e.preventDefault(); // 選択範囲を保ったまま押せるように
  $("ed-bold").onclick = () => document.execCommand("bold");
  $("ed-undo").onmousedown = (e) => e.preventDefault();
  $("ed-undo").onclick = () => document.execCommand("undo");

  // 編集した内容から、保存用のHTMLを組み立てる
  function buildHtml() {
    const clone = wrap.cloneNode(true);
    clone.removeAttribute("contenteditable");
    clone.removeAttribute("spellcheck");
    clone.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
    clone.querySelectorAll(".ed-locked").forEach((el) => el.classList.remove("ed-locked"));
    clone.querySelectorAll("label[data-ed-for]").forEach((l) => {
      l.setAttribute("for", l.getAttribute("data-ed-for"));
      l.removeAttribute("data-ed-for");
    });
    clone.querySelectorAll('[class=""]').forEach((el) => el.removeAttribute("class"));
    // 編集中に開いた「よくある質問」は、元どおり閉じた状態で保存する
    clone.querySelectorAll("details[open]").forEach((d) => d.removeAttribute("open"));
    // コメント欄は元の状態に戻す(読み込んだコメントなどを保存しない)
    const cm = clone.querySelector('section[aria-labelledby="cm-title"]');
    if (cm && originalComments) cm.replaceWith(doc.importNode(originalComments, true));
    // チェックリストのチェック状態は保存しない
    clone.querySelectorAll("input[type=checkbox]").forEach((c) => c.removeAttribute("checked"));

    const target = doc.querySelector(".wrap");
    target.innerHTML = clone.innerHTML;
    return "<!doctype html>\n" + doc.documentElement.outerHTML + "\n";
  }

  $("ed-save").onclick = async () => {
    if (!dirty) { status("変更はありません。"); return; }
    $("ed-save").disabled = true; status("保存しています…");
    try {
      const { res, data } = await api("PUT", { key, html: buildHtml(), etag });
      if (res.ok) {
        etag = data.etag; dirty = false;
        status("公開しました。数分で全員の画面に反映されます。");
      } else if (res.status === 401) {
        askToken("合言葉の確認が必要です。入力してから、もう一度「保存して公開」を押してください。");
      } else {
        status(data.error || "保存できませんでした。");
      }
    } catch (e) {
      status("通信できませんでした。もう一度お試しください。");
    } finally {
      $("ed-save").disabled = false;
    }
  };

  $("ed-exit").onclick = () => {
    if (dirty && !window.confirm("保存していない変更があります。編集をやめますか?")) return;
    dirty = false;
    location.href = location.pathname;
  };
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  start();
})();
