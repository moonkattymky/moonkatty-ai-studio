# Platform Read API — v1.0.0 (stable)

`media-automation/src/platforms/read-api.js` is a read-only interface for Studio 4: CEO, Marketing Director and Revenue Director.

- **Stability:** `stable` for v1.x. Fields are only ever added. A breaking change bumps `READ_API_VERSION` to 2.0.0.
- **Version:** `READ_API_VERSION = '1.0.0'`. The snapshot `schemaVersion` is `'1.0.0'`.
- **Guarantees:**
  - Every result is a deep-frozen copy.
  - No function publishes, spends, approves or writes.
  - No network calls are made.

```js
const api = require('media-automation/src/platforms/read-api');
api.getPlatforms()                 // -> Platform[]
api.getPlatformStatus(id)          // -> Status   (mode LIVE|DRY-RUN, liveGate, postCounts)
api.getContentPipeline(id)         // -> Pipeline (items[] with status + reviewStatus)
api.getAnalytics(id, { since, until }) // -> Analytics (totals, unavailable[])
api.getRevenue(id)                 // -> Revenue  { confirmed:{totals,entries}, unconfirmed:{totals,entries}, viewsAreRevenue:false }
api.getCapabilities(id)            // -> Capabilities (from META_CAPABILITIES.md research)
api.createReadApi({ snapshot | snapshotPath | publisher, ledger, approvals, analytics, liveFlags, env }) // custom/real sources, same 6 methods
```

## Platform ids
`youtube-news`, `youtube-project`, `tiktok`, `x`, `telegram`, `moonkatty-web` (not implemented yet), `instagram`, `facebook`.

## Data mode
Every payload carries a `dataMode` field:

- **`mock`**: the sample snapshot. This is the default today, because no accounts are connected.
- **`real`**: live read-only providers.
- **`static-docs`**: capabilities.

## Revenue rules
- Views are never counted as revenue.
- `confirmed` entries always have a `payoutId`.
- `unconfirmed` holds `estimated` entries only, such as Meta `monetization_approximate_earnings`.
- Totals are kept per currency and are never mixed.

## Files
- JSON Schema: `media-automation/schemas/platforms/read-api.schema.json`. Its `$defs` are platform, status, pipeline, analytics, revenue, revenueEntry, capabilities and snapshot.
- Sample snapshot, all mock: `media-automation/data/platforms-snapshot.sample.json`. Regenerate it with `node media-automation/bin/build-platform-snapshot.js`.
- Validator with no dependencies: `media-automation/src/platforms/schema-check.js`.
