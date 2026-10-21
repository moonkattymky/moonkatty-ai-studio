// iPhone 16 Pro (owner's phone): 402×874 CSS px @3x = 1206×2622. Playwright 1.56 has no built-in descriptor → custom, iOS 18 Safari UA.
// Full-screen viewport = standalone PWA (no Safari toolbars). Dynamic Island: 126×37 at top 11 px; safe area top 62 px, bottom 34 px.
export const IPHONE_16_PRO = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, defaultBrowserType: 'webkit',
};
export const DEVICE_NAME = 'iphone16pro';
