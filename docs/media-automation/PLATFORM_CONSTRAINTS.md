# Platform constraints (publishing is dry-run; nothing was run live)

- **YouTube** (Data API v3): OAuth 2.0 (loopback + PKCE, implemented). `videos.insert` costs 1600 units out of a default 10k/day quota, so about 6 uploads/day. Videos uploaded by **unverified API projects are locked private** until the app passes an audit. Shorts: vertical, ≤60 s (now up to 3 min), auto-detected. Disclose altered/synthetic content (AI voice) via the "altered content" setting.
- **Telegram**: Bot API, the bot must be a channel admin with post rights. `sendVideo` limit is 50 MB via the cloud Bot API (2 GB with a local Bot API server). Caption ≤1024 chars. Free.
- **X (Twitter)**: API v2 posting needs a paid tier for practical volume. Free tier is ~500 posts/month (write-only, app-level), Basic ~$200/mo. Media upload uses v1.1/v2 media endpoints with OAuth 1.0a user context. Not enabled.
- **TikTok**: Content Posting API needs an app review. Unaudited clients can post **only private (SELF_ONLY)** videos. Direct post requires audit plus user consent per post. Not enabled.
- **Meta (Facebook/Instagram)**: Graph API, needs a Business account, a Page linked to IG, and app review for `instagram_content_publish` / `pages_manage_posts`. IG Reels requires a **public video URL** (no direct upload of local files), so public hosting is needed. Not enabled.
All targets are routed through the Approval Center. Live mode needs `MA_PUBLISH_LIVE_<PLATFORM>=owner-approved` plus credentials in Keychain.
