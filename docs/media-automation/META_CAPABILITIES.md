# Meta (Facebook + Instagram) capabilities — official docs research

**Checked on:** 2026-10-21 (Asia/Jerusalem). **Sources:** developers.facebook.com only (pages fetched on that date; "Updated" dates are from each page).
Machine-readable copy of this table: `media-automation/src/platforms/capabilities.js` (served by `getCapabilities('facebook'|'instagram')`).

| Doc (URL) | Page "Updated" |
|---|---|
| https://developers.facebook.com/docs/instagram-platform/overview/ | n/a |
| https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/ | n/a |
| https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/ | n/a |
| https://developers.facebook.com/docs/instagram-platform/content-publishing/ | 2026-10-20 |
| https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/ | 2026-09-28 |
| https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit/ | 2024-07-23 |
| https://developers.facebook.com/docs/instagram-platform/insights/ | n/a |
| https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ | n/a |
| https://developers.facebook.com/docs/pages-api/posts/ | n/a |
| https://developers.facebook.com/docs/graph-api/reference/page/feed/ | n/a |
| https://developers.facebook.com/docs/video-api/guides/reels-publishing/ | n/a |
| https://developers.facebook.com/docs/graph-api/reference/page/insights/ | n/a |
| https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | n/a |
| https://developers.facebook.com/docs/marketing-api/overview/ | n/a |
| https://developers.facebook.com/docs/permissions/ | n/a |

## Access, App Review, Business Verification
- **Standard Access** is the default. It is enough when the app only serves accounts we own or manage, where the users have a role on the app or on the business portfolio. That is MOONKATTY's case.
- **Advanced Access** is needed only to serve accounts we don't own or manage. It **requires App Review plus Business Verification** (Instagram Platform overview).
- **Marketing API:** `ads_management` covers ad accounts the app owns or has been granted. Advanced Access for higher BUC quota goes through App Review ("Ads Management Standard Access" per the rate-limiting doc).
- **Account types:**
  - Instagram needs a **professional account** (Business or Creator).
    - *Instagram API with Facebook Login:* the account must be linked to a Facebook **Page** (host graph.facebook.com).
    - *Instagram API with Instagram Login:* no Page needed (host graph.instagram.com).
    - **Personal IG accounts are not supported.**
  - Facebook publishing is to **Pages** only, not profiles. The user needs the CREATE_CONTENT task, plus MANAGE/MODERATE for feed posts. If the Page requires Page Publishing Authorization, it must be completed.

## Capability table
App Review means "required only if Advanced Access is needed" unless the row says otherwise.

| Capability | Available | Endpoint | Permissions | App Review / BV |
|---|---|---|---|---|
| IG Reels publish | yes | `POST /{ig}/media` media_type=REELS (video_url or upload_type=resumable plus rupload) → `GET /{container}?fields=status_code` → `POST /{ig}/media_publish` | FB Login: instagram_basic, instagram_content_publish, pages_read_engagement (ads_management/ads_read if the Page role comes via Business Manager). IG Login: instagram_business_basic, instagram_business_content_publish | Advanced only |
| IG feed image | yes | `/{ig}/media` image_url (JPEG only), alt_text → media_publish | same | Advanced only |
| IG carousel | yes | children with is_carousel_item, then CAROUSEL | same | Advanced only |
| IG Stories | yes | media_type=STORIES | same | Advanced only |
| IG native scheduling | **no** | — | — | — |
| IG publishing quota | yes | `GET /{ig}/content_publishing_limit?fields=quota_usage,config` | instagram_basic, instagram_content_publish | — |
| IG media insights | yes | `GET /{media}/insights?metric=views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time` | instagram_basic, instagram_manage_insights, pages_read_engagement (IG Login: instagram_business_manage_insights) | Advanced only |
| IG account insights | yes | `GET /{ig}/insights?metric=reach,views,accounts_engaged,follower_demographics&metric_type=total_value` | same | Advanced only |
| IG earnings / payouts (Reels bonus, gifts, subscriptions, branded content) | **no** | none documented | — | — |
| FB Page post | yes | `POST /{page}/feed` (message, link), `/{page}/photos` | pages_manage_posts, pages_read_engagement, pages_show_list, pages_manage_engagement, pages_read_user_engagement | Advanced only |
| FB video | yes | `POST /{page}/videos` (file_url or resumable) | plus publish_video | Advanced only |
| FB Reels | yes | `POST /{page}/video_reels` upload_phase=start → `rupload.facebook.com/video-upload/{v}/{video_id}` → finish (video_state PUBLISHED/SCHEDULED) | pages_show_list, pages_read_engagement, pages_manage_posts | Advanced only |
| FB native scheduling | yes | `published=false` + `scheduled_publish_time` (feed); Reels use `video_state=SCHEDULED` | pages_manage_posts | — |
| FB Page/post/video insights | yes | `GET /{page}/insights/{metric}`, `/{post}/insights`, `/{video}/video_insights` | read_insights, pages_read_engagement (ANALYZE task) | Advanced only |
| FB monetization **estimates** | yes (estimates) | Page insights metrics: `monetization_approximate_earnings`, `content_monetization_earnings` ("in development"), `page_daily_video_ad_break_earnings_by_crosspost_status`, `post_video_ad_break_earnings`, `creator_monetization_qualified_views` | read_insights, pages_read_engagement | Advanced only |
| FB actual payouts / payout ids | **no** | none documented; docs say "actual payments may differ" | — | — |
| FB Stars, fan subscriptions, branded-content revenue | **no** (no official endpoint found) | — | — | — |
| Boost / promotion | yes | Marketing API `/act_{id}/campaigns, adsets, adcreatives, ads` (object_story_id or source_instagram_media_id) | ads_management (+ pages_manage_ads, pages_read_engagement) | App Review for Advanced; BV for third parties. **We draft only.** |

## Rate limits
- **IG API-published posts:**
  - The Content Publishing guide (updated 2026-10-20) says "**100** API-published posts within a 24-hour moving period". A carousel counts as 1, and the limit is enforced on `media_publish`.
  - The `content_publishing_limit` reference (updated 2024-07-23) still says `quota_total` is "currently **50**".
  - → **The 50/24h figure could NOT be confirmed as current.** The newer guide says 100.
  - Our code defaults to 50 (conservative) and replaces it with the live `config.quota_total` when queried (`IgScheduler.applyQuota`).
- **IG containers:** 400 per rolling 24 h. A container expires after 24 h.
- **IG Platform API calls:** BUC limit of 4800 × impressions per rolling 24 h, per app-user pair.
- **FB Reels:** 30 API-published Reels per rolling 24 h per Page.
- **Pages API rate limits:**
  - Page or system-user tokens use BUC: 4800 × engaged users per 24 h.
  - User or app tokens use Platform limits: 200 × users per hour.
  - Read the headers `x-app-usage`, `x-business-use-case-usage` and `x-page-usage`; meta.js already captures them.
- **Error codes:** 4, 17, 32 and 613 are rate limits. 80001 is the Page limit. 190 is an invalid token.

## Media constraints
- **IG Reels:**
  - Container: MP4/MOV with the moov atom at the front and no edit lists.
  - Video: H.264/HEVC, progressive, closed GOP, 4:2:0, VBR ≤ 25 Mbps, 23–60 fps, max width 1920.
  - Audio: AAC ≤ 48 kHz mono/stereo, 128 kbps.
  - Aspect ratio from 0.01:1 to 10:1, **9:16 recommended**. Duration **3 s – 15 min**, max **300 MB**.
  - Cover: JPEG ≤ 8 MB.
  - Reels cannot go in carousels. Music tagging works only with original audio.
  - Our pipeline enforces 9:16.
- **IG images:**
  - JPEG only, ≤ 8 MB, aspect ratio 4:5 to 1.91:1, width 320–1440.
  - Caption ≤ **2200** characters, **30** hashtags and **20** @-mentions.
  - Carousel: the IG User Media reference now says up to **20** children. Root meta.js uses 10, and **we cap at 10** to stay conservative.
- **FB Reels:**
  - .mp4, 9:16, 1080×1920 recommended (minimum 540×960), 24–60 fps, **3–90 s**.
  - A Reel shared as a story is ≤ 60 s.
  - H.264/H.265 (VP9/AV1 also supported), closed GOP of 2–5 s.
- **FB video:** aspect ratio between 16:9 and 9:16 (error 1363040).
- **FB scheduling:** 10 minutes to 75 days ahead.

## NOT available / constraints we design around
- Personal Instagram accounts and personal Facebook profiles.
- **Any native scheduling on Instagram**, including Stories. We run our own scheduler and publish at the slot. Stories expire after 24 h, and stickers, shopping tags and filters are not supported.
- **Payout data via API on both IG and FB.** FB exposes only *estimates*, and IG exposes nothing. Confirmed revenue must be entered by the owner from Meta payout statements, with a payout id.
- Stars, subscriptions, branded-content and Reels-bonus revenue via API. No official endpoint was found in the pages above.
- IG user metrics are kept 90 days. Some need ≥ 100 followers. FB insights queries cover at most 90 days per since/until, with a lifetime of 2 years. `page_impressions_unique` is deprecated above v25.

## How we use this
The live publishing path keeps using the existing `src/publish/adapters/meta.js` and the repo-root **meta.js** OAuth, which we read but never modify. Everything stays **DRY-RUN** until the owner sets the platform flag **and** approves a `live_mode:<platform>` item in the Approval Center. Promotion is a draft only, and there is no spend path.
