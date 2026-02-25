import type { SourcePlatform } from "./types.js";

const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com"
]);

const WEIXIN_HOSTS = new Set(["mp.weixin.qq.com"]);

const WEIBO_HOSTS = new Set([
  "weibo.com",
  "www.weibo.com",
  "m.weibo.cn",
  "weibo.cn"
]);

export function detectSourcePlatform(url: URL): SourcePlatform {
  const host = url.hostname.toLowerCase();

  if (X_HOSTS.has(host)) {
    return "x";
  }

  if (WEIXIN_HOSTS.has(host)) {
    return "weixin";
  }

  if (WEIBO_HOSTS.has(host)) {
    return "weibo";
  }

  return "generic";
}

export interface XStatusRef {
  statusId: string;
  authorHandle?: string;
}

export function parseXStatusRef(url: URL): XStatusRef | undefined {
  const path = url.pathname.replace(/\/+$/, "");
  const userStatusMatch = path.match(/^\/([^/]+)\/status\/([0-9A-Za-z_]+)$/i);
  if (userStatusMatch) {
    return {
      authorHandle: userStatusMatch[1],
      statusId: userStatusMatch[2]
    };
  }

  const webStatusMatch = path.match(/^\/i\/web\/status\/([0-9A-Za-z_]+)$/i);
  if (webStatusMatch) {
    return {
      statusId: webStatusMatch[1]
    };
  }

  return undefined;
}

export function isXStatusUrl(url: URL): boolean {
  return parseXStatusRef(url) !== undefined;
}

export interface WeixinArticleRef {
  biz?: string;
  mid?: string;
  idx?: string;
  sn?: string;
}

function parseWeixinArticleRefFromUrl(url: URL): WeixinArticleRef | undefined {
  if (!WEIXIN_HOSTS.has(url.hostname.toLowerCase())) {
    return undefined;
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (path !== "/s") {
    return undefined;
  }

  return {
    biz: url.searchParams.get("__biz") ?? undefined,
    mid: url.searchParams.get("mid") ?? undefined,
    idx: url.searchParams.get("idx") ?? undefined,
    sn: url.searchParams.get("sn") ?? undefined
  };
}

function hasWeixinArticleIdentity(ref: WeixinArticleRef): boolean {
  return Boolean(ref.biz || ref.mid || ref.idx || ref.sn);
}

export function parseWeixinArticleRef(url: URL): WeixinArticleRef | undefined {
  const parsed = parseWeixinArticleRefFromUrl(url);
  if (!parsed || !hasWeixinArticleIdentity(parsed)) {
    return undefined;
  }

  return parsed;
}

export function isWeixinArticleUrl(url: URL): boolean {
  return parseWeixinArticleRef(url) !== undefined;
}
