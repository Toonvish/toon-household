/**
 * The `webcal:` form of a feed URL (plan m9 P16): iOS and macOS open a `webcal://` link straight in the Calendar
 * app's "subscribe" dialog (ICSx5 on Android registers the scheme too). Only the scheme changes; host, port, path
 * and query are kept. A value that is not an `http(s)` URL is returned unchanged.
 */
export function webcalUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "webcal://");
}
