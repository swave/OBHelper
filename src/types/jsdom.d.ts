declare module "jsdom" {
  export class JSDOM {
    public constructor(html?: string, options?: { url?: string });
    public window: any;
  }
}
