// コメントAPI
//   GET    /api/comments?page={slug}                承認済みコメント一覧(公開)
//   POST   /api/comments                            コメント投稿(承認待ちで保存)
//   GET    /api/admin/comments                      全ページのコメント一覧(要 x-admin-token)
//   POST   /api/admin/comments/{slug}/{id}/approve  承認
//   DELETE /api/admin/comments/{slug}/{id}          削除
//   GET    /api/admin/pages                         ページ一覧
//   GET    /api/admin/page?key=...                  編集モード:ページ取得
//   PUT    /api/admin/page                          編集モード:ページ保存
// {slug} はページのフォルダ名(例: shopee → /shopee/)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import {
  S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import {
  CloudFrontClient, ListDistributionsCommand, CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";

const {
  TABLE_NAME, PAGE_ID = "inti-subang-shopee", ADMIN_TOKEN = "", ORIGIN_SECRET = "",
  TURNSTILE_SECRET = "", TOPIC_ARN = "", SITE_BUCKET = "", DIST_COMMENT = "",
} = process.env;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sns = new SNSClient({});
const s3 = new S3Client({});
const cf = new CloudFrontClient({ region: "us-east-1" });

export const ROLES = ["在学中の留学生", "これから留学する人", "保護者", "卒業生", "その他"];

const json = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

function safeEq(a, b) {
  if (!a || !b) return false;
  const x = createHash("sha256").update(String(a)).digest();
  const y = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(x, y);
}

function readBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try { return JSON.parse(raw); } catch { return null; }
}

// 入力チェック。問題があればエラーメッセージ(日本語)を返す
export function validate(input) {
  if (!input || typeof input !== "object") return { error: "送信内容を読み取れませんでした。" };
  if (input.website) return { error: "送信できませんでした。" }; // ボット用のおとり欄
  const name = String(input.name ?? "").trim().slice(0, 30) || "匿名";
  const role = ROLES.includes(input.role) ? input.role : "";
  const body = String(input.body ?? "").replace(/\r\n/g, "\n").trim();
  if (body.length < 5) return { error: "コメントは5文字以上で入力してください。" };
  if (body.length > 1000) return { error: "コメントは1000文字以内で入力してください。" };
  const links = (body.match(/https?:\/\//gi) || []).length;
  if (links > 2) return { error: "リンクは2つまでにしてください。" };
  return { value: { name, role, body } };
}

async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET || TURNSTILE_SECRET === "none") return true; // 未設定なら検証しない
  if (!token) return false;
  const form = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
  if (ip) form.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", body: form,
  });
  const data = await res.json().catch(() => ({}));
  return data.success === true;
}

// ---------- ページ ----------
// コメントはページ(フォルダ名 = slug)ごとに保存する。
// Shopee編は最初に1ページだけで公開していたので、保存先のIDは当時のもの(PAGE_ID)を使い続ける
export const isSlug = (s) => typeof s === "string" && /^[a-z0-9-]{1,40}$/.test(s);
export const pkFor = (slug) => (slug === "shopee" ? PAGE_ID : `page:${slug}`);
export const slugFor = (pk) => (pk === PAGE_ID ? "shopee" : String(pk).replace(/^page:/, ""));

// 実在するページにだけコメントできるようにする(存在しないページ名でのスパムを防ぐ)
const pageCache = new Map();
async function pageExists(slug) {
  const hit = pageCache.get(slug);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = false;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: SITE_BUCKET, Key: `${slug}/index.html` }));
    ok = true;
  } catch (e) {
    if (e.name !== "NotFound" && e.name !== "NoSuchKey" && e?.$metadata?.httpStatusCode !== 404) throw e;
  }
  pageCache.set(slug, { ok, until: Date.now() + 10 * 60 * 1000 });
  return ok;
}

async function listPages() {
  const out = await s3.send(new ListObjectsV2Command({ Bucket: SITE_BUCKET, MaxKeys: 1000 }));
  const keys = (out.Contents || []).map((o) => o.Key).filter(isEditableKey).sort();
  const pages = [];
  for (const key of keys) {
    let title = "";
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: SITE_BUCKET, Key: key, Range: "bytes=0-4095" }));
      const head = await obj.Body.transformToString("utf-8");
      title = (head.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
    } catch (e) { console.error("title read failed", key, e); }
    const slug = key === "index.html" ? "" : key.replace(/\/index\.html$/, "");
    pages.push({ key, slug, path: "/" + key.replace(/index\.html$/, ""), title });
  }
  return pages;
}

const newId = () => `${new Date().toISOString().replace(/[-:.]/g, "")}_${randomBytes(4).toString("hex")}`;

// 公開用:1ページ分の承認済みコメント
async function listApproved(slug) {
  const out = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "pk = :p",
    FilterExpression: "#s = :a",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":p": pkFor(slug), ":a": "approved" },
    ScanIndexForward: false,
    Limit: 300,
  }));
  return (out.Items || []).map(({ id, name, role, body, createdAt }) => ({ id, name, role, body, createdAt }));
}

// 管理用:全ページのコメント(件数が少ない前提で全件を読む)
async function listAll() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const out = await ddb.send(new ScanCommand({ TableName: TABLE_NAME, ExclusiveStartKey }));
    items.push(...(out.Items || []));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey && items.length < 2000);
  return items
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(({ pk, id, name, role, body, createdAt, status }) =>
      ({ page: slugFor(pk), id, name, role, body, createdAt, status }));
}

async function createComment(event, headers) {
  const input = readBody(event);
  const { value, error } = validate(input);
  if (error) return json(400, { error });

  const ip = (headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (!(await verifyTurnstile(input.token, ip))) {
    return json(400, { error: "ボット確認に失敗しました。ページを再読み込みしてもう一度お試しください。" });
  }

  const slug = input.page === undefined ? "shopee" : input.page;
  if (!isSlug(slug) || !(await pageExists(slug))) return json(400, { error: "このページにはコメントできません。" });

  const id = newId();
  const item = {
    pk: pkFor(slug), sk: id, id, ...value, status: "pending", createdAt: new Date().toISOString(),
    ipHash: ip ? createHash("sha256").update(ip + ORIGIN_SECRET).digest("hex").slice(0, 16) : "",
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  if (TOPIC_ARN) {
    await sns.send(new PublishCommand({
      TopicArn: TOPIC_ARN,
      Subject: "New comment pending approval",
      Message: `新しいコメントが届きました(承認待ち)\n\nページ: /${slug}/\n名前: ${item.name}\n立場: ${item.role || "-"}\n\n${item.body}\n\n管理画面で承認してください。`,
    })).catch((e) => console.error("notify failed", e));
  }
  return json(202, { ok: true });
}

async function setApproved(slug, id) {
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: pkFor(slug), sk: id },
      UpdateExpression: "SET #s = :a, approvedAt = :t",
      ConditionExpression: "attribute_exists(sk)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":a": "approved", ":t": new Date().toISOString() },
    }));
    return json(200, { ok: true });
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return json(404, { error: "見つかりません。" });
    throw e;
  }
}

// ---------- 編集モード:ページの取得と保存 ----------
// 編集できるのは index.html(サブフォルダの index.html を含む)だけ
export const isEditableKey = (key) =>
  typeof key === "string" && /^([a-z0-9-]+\/)*index\.html$/.test(key) && !key.includes("..");

let distIdCache = "";
async function distributionId() {
  if (distIdCache) return distIdCache;
  let Marker;
  do {
    const out = await cf.send(new ListDistributionsCommand({ Marker }));
    const list = out.DistributionList || {};
    const hit = (list.Items || []).find((d) => d.Comment === DIST_COMMENT);
    if (hit) { distIdCache = hit.Id; return hit.Id; }
    Marker = list.IsTruncated ? list.NextMarker : undefined;
  } while (Marker);
  throw new Error("distribution not found: " + DIST_COMMENT);
}

// 保存されるHTMLとして最低限の形になっているか
export function validatePageHtml(html) {
  if (typeof html !== "string") return "ページの内容を読み取れませんでした。";
  if (html.length > 1_000_000) return "ページが大きすぎます(1MBまで)。";
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html) || !/<title>/i.test(html)) {
    return "ページの形が壊れているため保存できません。編集をやめて、やり直してください。";
  }
  return "";
}

async function getPage(key) {
  if (!isEditableKey(key)) return json(400, { error: "このページは編集できません。" });
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: SITE_BUCKET, Key: key }));
    return json(200, { key, html: await out.Body.transformToString("utf-8"), etag: out.ETag });
  } catch (e) {
    if (e.name === "NoSuchKey") return json(404, { error: "ページが見つかりません。" });
    throw e;
  }
}

async function putPage(event) {
  const input = readBody(event);
  if (!input) return json(400, { error: "送信内容を読み取れませんでした。" });
  const { key, html, etag } = input;
  if (!isEditableKey(key)) return json(400, { error: "このページは編集できません。" });
  const problem = validatePageHtml(html);
  if (problem) return json(400, { error: problem });

  // ほかの場所(別の端末やdeploy.sh)で更新されていないか確認
  const head = await s3.send(new HeadObjectCommand({ Bucket: SITE_BUCKET, Key: key }));
  if (etag && head.ETag !== etag) {
    return json(409, { error: "編集中にページがほかの場所で更新されました。変更内容を控えてから、ページを再読み込みしてください。" });
  }

  const put = await s3.send(new PutObjectCommand({
    Bucket: SITE_BUCKET, Key: key, Body: html,
    ContentType: "text/html; charset=utf-8",
    CacheControl: "public, max-age=300",
  }));

  const dir = key.replace(/index\.html$/, "");
  await cf.send(new CreateInvalidationCommand({
    DistributionId: await distributionId(),
    InvalidationBatch: {
      CallerReference: `edit-${Date.now()}`,
      Paths: { Quantity: 2, Items: ["/" + key, "/" + dir] },
    },
  }));
  return json(200, { ok: true, etag: put.ETag });
}

export const handler = async (event) => {
  const headers = Object.fromEntries(
    Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  if (!safeEq(headers["x-origin-verify"], ORIGIN_SECRET)) return json(403, { error: "forbidden" });

  const method = event.requestContext?.http?.method || "GET";
  const path = (event.rawPath || "/").replace(/\/+$/, "");

  try {
    if (path === "/api/comments") {
      if (method === "GET") {
        const slug = new URLSearchParams(event.rawQueryString || "").get("page") || "shopee";
        if (!isSlug(slug)) return json(400, { error: "ページの指定が正しくありません。" });
        return json(200, { comments: await listApproved(slug) });
      }
      if (method === "POST") return await createComment(event, headers);
      return json(405, { error: "method not allowed" });
    }

    if (path.startsWith("/api/admin/")) {
      if (!safeEq(headers["x-admin-token"], ADMIN_TOKEN)) return json(401, { error: "合言葉が違います。" });
      if (path === "/api/admin/page") {
        if (method === "GET") {
          const key = new URLSearchParams(event.rawQueryString || "").get("key") || "index.html";
          return await getPage(key);
        }
        if (method === "PUT") return await putPage(event);
        return json(405, { error: "method not allowed" });
      }
      if (path === "/api/admin/pages" && method === "GET") {
        return json(200, { pages: await listPages() });
      }
      if (path === "/api/admin/comments" && method === "GET") {
        return json(200, { comments: await listAll() });
      }
      const m = path.match(/^\/api\/admin\/comments\/([a-z0-9-]{1,40})\/([A-Za-z0-9_]+)(\/approve)?$/);
      if (m && m[3] && method === "POST") return await setApproved(m[1], m[2]);
      if (m && !m[3] && method === "DELETE") {
        await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { pk: pkFor(m[1]), sk: m[2] } }));
        return json(200, { ok: true });
      }
    }
    return json(404, { error: "not found" });
  } catch (e) {
    console.error(e);
    return json(500, { error: "サーバーでエラーが起きました。時間をおいてもう一度お試しください。" });
  }
};
