// コメント欄:承認済みコメントの表示と投稿
(function () {
  const API = "/api/comments";
  const cfg = window.SITE_CONFIG || {};
  const section = document.querySelector("[data-page]");
  if (!section) return; // コメント欄のないページ
  // ページの識別名(フォルダ名)。<section data-page="shopee"> のように書く
  const PAGE = section.getAttribute("data-page");
  const list = document.getElementById("cm-list");
  const count = document.getElementById("cm-count");
  const form = document.getElementById("cm-form");
  const msg = document.getElementById("cm-msg");
  const btn = document.getElementById("cm-submit");
  const bodyEl = document.getElementById("cm-body");
  const lenEl = document.getElementById("cm-len");
  let turnstileToken = "";

  const fmt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "numeric", day: "numeric",
  });

  function setMsg(text, kind) {
    msg.textContent = text;
    msg.className = "cm-msg" + (kind ? " " + kind : "");
    msg.hidden = !text;
  }

  function render(comments) {
    list.textContent = "";
    count.textContent = comments.length ? comments.length + "件" : "";
    if (!comments.length) {
      const p = document.createElement("p");
      p.className = "cm-empty";
      p.textContent = "まだコメントはありません。最初の体験談をお寄せください。";
      list.appendChild(p);
      return;
    }
    for (const c of comments) {
      const art = document.createElement("article");
      art.className = "cm-item";
      const head = document.createElement("div");
      head.className = "cm-head";
      const name = document.createElement("b");
      name.textContent = c.name || "匿名";
      head.appendChild(name);
      if (c.role) {
        const area = document.createElement("span");
        area.className = "cm-area";
        area.textContent = c.role;
        head.appendChild(area);
      }
      const date = document.createElement("time");
      date.dateTime = c.createdAt;
      date.textContent = fmt.format(new Date(c.createdAt));
      head.appendChild(date);
      const body = document.createElement("p");
      body.textContent = c.body;
      art.append(head, body);
      list.appendChild(art);
    }
  }

  async function load() {
    try {
      const res = await fetch(API + "?page=" + encodeURIComponent(PAGE), { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      render(data.comments || []);
    } catch (e) {
      list.textContent = "";
      const p = document.createElement("p");
      p.className = "cm-empty";
      p.textContent = "コメントを読み込めませんでした。時間をおいて再読み込みしてください。";
      list.appendChild(p);
    }
  }

  // Turnstile(設定されている場合のみ)
  window.onTurnstileOk = (t) => { turnstileToken = t; };
  window.onTurnstileExpired = () => { turnstileToken = ""; };
  if (cfg.turnstileSiteKey) {
    const box = document.getElementById("cm-turnstile");
    box.className = "cf-turnstile";
    box.dataset.sitekey = cfg.turnstileSiteKey;
    box.dataset.callback = "onTurnstileOk";
    box.dataset.expiredCallback = "onTurnstileExpired";
    box.dataset.language = "ja";
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }

  bodyEl.addEventListener("input", () => {
    lenEl.textContent = bodyEl.value.length + " / 1000";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg("");
    if (cfg.turnstileSiteKey && !turnstileToken) {
      setMsg("ボット確認が終わるまでお待ちください。", "err");
      return;
    }
    btn.disabled = true;
    btn.textContent = "送信中…";
    const fd = new FormData(form);
    const payload = {
      page: PAGE,
      name: fd.get("name"), role: fd.get("role"), body: fd.get("body"),
      website: fd.get("website"), token: turnstileToken,
    };
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 202) {
        form.reset();
        lenEl.textContent = "0 / 1000";
        setMsg("送信しました。管理人が確認したあとに表示されます。", "ok");
      } else {
        setMsg(data.error || "送信できませんでした。時間をおいてもう一度お試しください。", "err");
      }
    } catch (err) {
      setMsg("通信できませんでした。電波の良い場所でもう一度お試しください。", "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "コメントを送る";
      if (window.turnstile && cfg.turnstileSiteKey) { window.turnstile.reset(); turnstileToken = ""; }
    }
  });

  load();
})();
