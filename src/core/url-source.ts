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
