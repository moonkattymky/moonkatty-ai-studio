# Azure Speech — Andrew, licensing, price, and region

Access date for every page below: **21 October 2026**.

This note uses Microsoft's own pages and the public Retail Prices API. It does not create an Azure account, call the speech-synthesis endpoint, or use a subscription key. Dollar amounts that the pricing page rendered as `$-` are not copied from that page; the figures below are the Retail Prices API responses, with the query named.

The listened candidate is **`en-US-AndrewMultilingualNeural`**. It is not locked, and it is not `en-US-AndrewNeural` or a Dragon HD voice.

## Voice ids

Source: [Language and voice support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts), accessed 21 October 2026.

Standard voices are one locale. Each standard voice model is available at 24 kHz and 48 kHz. Names containing `MultilingualNeural`, `DragonHDLatestNeural`, or `DragonHDOmniLatestNeural` support multiple languages. Dragon HD voices are LLM-based: they use the semantic content of the text, detect emotion cues, and adjust style and tone. The page says they keep a consistent persona with their non-HD counterparts and have more contextual awareness. `MultilingualNeural` is an earlier multilingual generation: high naturalness, less contextual awareness than HD. The locale prefix of `en-US-AndrewMultilingualNeural` is `en-US`.

Rows in the en-US table (type, and the voice-conversion column):

| Voice id | Type | Styles / roles on that row | Voice conversion |
| --- | --- | --- | --- |
| `en-US-AndrewNeural` | Standard, male | none listed | no |
| `en-US-AndrewMultilingualNeural` | Multilingual, male, superscript 2 | styles `empathetic`, `relieved`; roles not supported | yes |
| `en-US-Andrew:DragonHDLatestNeural` | Neural HD, male, superscripts 2 and 4 | none listed | no |
| `en-US-Andrew:DragonHDOmniLatestNeural` | Neural HD Omni, male, superscripts 1 and 2 | none listed | no |
| `en-US-Andrew2:DragonHDLatestNeural` | Neural HD, superscripts 2 and 4 | none listed | no |
| `en-US-Andrew3:DragonHDLatestNeural` | Neural HD, superscripts 1 and 2 | none listed | no |
| `en-US-Andrew-Preview:DragonHDLatestNeural` | Neural HD, superscripts 1 and 2 | none listed | no |

The rendered page showed those superscripts and did **not** include the footnote definitions. This note does not guess what 1, 2, or 4 mean. The pronunciation article says phoneme support is indicated by footnotes in that table, which is why the missing legend matters.

Source: [HD voices](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/high-definition-voices), accessed 21 October 2026.

The voice value format is `voicename:DragonHD:version`. `LatestNeural` means the latest base model Microsoft provides. On that page the ids are written in lowercase locale form. Status rows:

- `en-us-Andrew:DragonHDLatestNeural` — male, GA
- `en-us-Andrew2:DragonHDLatestNeural` — male, GA, "Optimized for conversational content"
- `en-us-Andrew3:DragonHDLatestNeural` — male, Preview, "Optimized for podcast content"
- `en-us-MultiTalker-Ava-Andrew:DragonHDLatestNeural` — male, Preview

DragonHD is described as 30+ fine-tuned voices. DragonHDOmni is described as 500+ voices. Compared with non-HD Speech voices, HD SSML is a subset, deployment is cloud only, synthesis is real-time only, latency is under 300 ms, and sample rates are 8, 16, 24, and 48 kHz. Non-HD voices get the full SSML set, cloud/embedded/hybrid/containers, and both real-time and batch, also under 300 ms. HD Flash is a separate optimized variant, currently `zh-CN` and `en-US`, in `eastus`, `westeurope`, `southeastasia`, and `chinanorth3`. The Flash table lists Tiana, Tyler, and Jimmie for en-US. It does not list an Andrew Flash voice. Advanced style control is described as initially available for `en-US-Ava` and `en-US-Andrew`.

HD is a different id and a different price meter from the multilingual voice the owner heard. The candidate id in this integration is `en-US-AndrewMultilingualNeural`.

## SSML used by the provider

Source: [Pronunciation with SSML](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-pronunciation), accessed 21 October 2026.

`phoneme` takes `alphabet` (`ipa`, `sapi`, `ups`, `x-sampa`) and required `ph`. The enclosed text is the human-readable fallback. Unrecognized phones return HTTP 400. `sub` pronounces the `alias` instead of the enclosed text. The documented example is `<sub alias="World Wide Web Consortium">W3C</sub>`. The speak element in those examples is `version="1.0"` with `xmlns="http://www.w3.org/2001/10/synthesis"`.

The HD article says non-HD voices support the full SSML set, and that SSML can define a break or a pause. Its element table rendered with empty tag-name cells, so this note does not invent those tag names from that table. The descriptions that survived include phonetic pronunciation (DragonHD yes, Dragon HD Omni no) and alias-only reading of entities (both HD families yes, "only supports alias").

This provider therefore targets the non-HD multilingual voice, where the full SSML set applies. It writes `<sub alias="moon-KAT-ee">` around `MOONKATTY` and around the lexicon form `Moon Katty`, optional `<phoneme>`, `<break time="…ms"/>` for local `[pause N]` / `[pause Nms]` markup, and `<prosody rate="95%">` when the configured rate is the number `0.95`.

## Commercial use, YouTube, TikTok, disclosure

Source: [Microsoft Azure Product Terms, Microsoft Customer Agreement](https://www.microsoft.com/licensing/terms/productoffering/MicrosoftAzure/MCA), Foundry Tools section, accessed 21 October 2026.

The output sentence is:

> TTS Service output use rights: For Customers of the paid tier TTS Service only, Customer may use the audio output of prebuilt neural voices generated using the TTS Service, including for commercial purposes.

The same section requires the customer to have the rights to data submitted to the TTS service, and it forbids using Foundry Tools output to create, train, or improve a similar or competing product or service. Custom / synthetic-voice terms (voice-talent permission, `aka.ms/disclosure-voice-talent`, the Enterprise AI Services Code of Conduct) are a different paragraph. They apply to a synthetic voice the customer creates. They are not the terms for prebuilt Andrew.

Translation attribution, in the next subsection, is also different. It requires a notice when displaying automatic translations of text. It does not mention TTS audio.

The Product Terms do **not** name YouTube or TikTok. The paid-tier grant is general commercial use of prebuilt neural output. It is not a platform-by-platform permission. F0 is not "the paid tier" in that sentence. The 0.5 million free characters are an allowance on the Free (F0) price row. This note does not treat that allowance as the paid-tier output grant.

Source: [Text to speech transparency note](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/speech-service/text-to-speech/transparency-note), accessed 21 October 2026.

Microsoft requires customers to disclose that TTS voices are synthetic. The note says to provide adequate disclosure, especially when using a well-known person's voice, and gives a verbal disclosure at the start of a broadcast as an example. It also requires disclosure for avatar video. Prebuilt neural voice: no registration or pre-approval for additional use cases that meet the applicable terms, including the Azure Acceptable Use Policy and the TTS code of conduct. Microsoft gives 12 months' notice before removing a prebuilt neural voice, except for security, legal, or system performance, and this does not apply to previews. Each prebuilt neural voice model is available at 24 kHz and 48 kHz.

The transparency note's disclosure requirement is a product requirement. It is not an attribution line of the kind the translation clause uses, and the Product Terms sentence quoted above does not itself say "no attribution." What is clear: synthetic disclosure is required. What is not in these pages: a special YouTube or TikTok credit line.

## Free tier and paid prices

Source: [Azure Speech pricing](https://azure.microsoft.com/en-us/pricing/details/speech/), accessed 21 October 2026.

Free (F0), Text to Speech (per character billing), Neural: **0.5 million characters free per month**. That row does not mention Neural HD or HD Flash. No separate F0 HD allowance is printed there.

The same page's Standard Voice table lists "Neural/Neural HD Flash (real-time and batch)" and "Neural HD (real-time and batch)" as separate lines. The fetched HTML showed those prices as `$-`, so this note does not take a dollar figure from that table. Footnote 4 says selected voices are available as Neural and NeuralHD. The pricing FAQ says text-to-speech usage is billed per character and says to check the definition of a character in the pricing note. That definition was not in the fetched page.

A deprecated table on the same page, "Free - Web/Container", lists Text to Speech Standard at **5 million characters free per month**. That is the deprecated row. The local cap uses the current F0 neural figure, 0.5 million, not 5 million.

Source: [Quotas and limits](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits), accessed 21 October 2026.

F0 monthly allowances are on the pricing page. F0 quotas are not adjustable. Switching a Speech resource from F0 to Standard (S0) can take several hours to update quotas. Real-time TTS, "standard voices and custom voices":

- F0: **20 transactions per 60 seconds**. Not adjustable. This is not a per-second quota.
- S0: **30 transactions per second** default, adjustable up to **1,000 TPS**.

Maximum audio length is 10 minutes on both tiers. Maximum SSML message size per WebSocket turn is 64 KB on both. The same table lists a maximum of 50 distinct tags of two SSML element types; the element names were blank in the rendered markdown, so they are not named here. Batch synthesis REST is "Not available for F0" (S0: 100 requests per 10 seconds). The Audio Content Creation tool, which is a separate limit from the API quota: F0 plain text in SSML 3,000 characters per file (tags excluded) and 15,000 billable characters per file; S0 20,000 and 100,000. Lexicon file characters are not charged. Lexicon elements in SSML count as billable characters. The worked example on that page says to multiply by **$15 per million characters**. That matches the neural retail meter below. It is not the HD meter.

The real-time row says "standard voices and custom voices." It does not say whether HD transactions draw on the F0 allowance or on that 20-per-60-seconds limit. Whether an F0 resource can call an HD voice at all is not stated. The provider refuses F0 plus an HD voice id because that price class is unknown.

Source: [Retail Prices API](https://prices.azure.com/api/retail/prices), queried 21 October 2026. `serviceName` is `Foundry Tools`, `productName` is `Azure Speech`, currency USD, type Consumption.

| Query | skuName | meterName | unitPrice | unit | effectiveStartDate |
| --- | --- | --- | --- | --- | --- |
| `armRegionName eq 'eastus'` and `meterName eq 'S1 Neural Text To Speech Characters'` | S1 | S1 Neural Text To Speech Characters | 15.0 | 1M | 2024-02-01 |
| same meter, `westeurope` | S1 | S1 Neural Text To Speech Characters | 15.0 | 1M | 2024-02-01 |
| same meter, `uaenorth` | S1 | S1 Neural Text To Speech Characters | 15.0 | 1M | 2024-02-01 |
| `eastus` and `meterName eq 'Neural HD Text to Speech Characters'` | Neural HD Text to Speech | Neural HD Text to Speech Characters | 22.0 | 1M | 2026-03-01 |
| same HD meter, `westeurope` | Neural HD Text to Speech | Neural HD Text to Speech Characters | 22.0 | 1M | 2026-03-01 |

These are retail list prices in USD. The pricing page says actual prices can vary by agreement, date, and currency. The quotas article calls the paid tier **Standard (S0)**. The retail meter above is labeled **S1**. None of these queries returned a sku named S0. An exhaustive list of every Speech meter was not pulled. Whether the portal's S0 resource bills on the meter named S1 is **not stated** by either page. The code accepts only the portal tier strings `F0` and `S0`, and it refuses `S1` as a config value so an unrecognized label cannot run.

HD at $22 per 1M is a different meter from neural at $15 per 1M. A paid cap in this repo counts characters. It does not convert HD characters into the $15 meter.

## Israel: account, billing, and where Andrew can be called

Account and billing, accessed 21 October 2026:

- [Supported payment methods](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/supported-payment-methods). Israel is listed with American Express, Mastercard, and Visa. Discover, JCB, and UnionPay are not marked for Israel. Prepaid cards are not accepted.
- [Microsoft Customer Agreement FAQ](https://learn.microsoft.com/en-us/azure/cost-management-billing/microsoft-customer-agreement/microsoft-customer-agreement-faq). Israel is in the list of countries where a **new Azure.com customer** can purchase under the Microsoft Customer Agreement, in the paragraph that says those countries are transacted in US dollars. Israel is also in the list of countries where a customer who has an Azure EA billed through a partner can purchase directly from a Microsoft seller. Israel is **not** in the shorter list of countries where the agreement is "currently available" if you work through a Microsoft seller (that list runs Argentina through Uruguay and does not include Israel). Under "in which currency is my payment processed?", the legal address selects the currency, and the Israel row is **US Dollar ($)**. Azure is priced in USD worldwide under the MCA; users are charged in the billing currency from that table.

This work did not open an account, and it did not check the live Azure signup form's country dropdown. The signup marketing page was not used as a source.

Regions, accessed 21 October 2026:

- [Azure regions list](https://learn.microsoft.com/en-us/azure/reliability/regions-list). Israel Central is a public region: 3 availability zones, paired region N/A, physical location Israel, geography Israel, programmatic name `israelcentral`. The page legend describes preview and restricted-region icons. The extracted table text for Israel Central did not include either marker. This note does not add one.
- [Speech service regions](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions?tabs=tts). The text-to-speech table does **not** list `israelcentral`. It does list `uaenorth` with neural text to speech checked and HD voices not checked, and `qatarcentral` with neural text to speech checked and HD voices not checked. `westeurope`, `francecentral`, and `swedencentral` have both neural text to speech and HD voices checked, as do `eastus`, `eastus2`, `southeastasia`, `centralindia`, `canadacentral`, and `westus2`. The page does not list individual voice names, and it does not name a nearest region to Israel. It also does not say that every neural region serves `en-US-AndrewMultilingualNeural` specifically.
- Retail Prices API, `armRegionName eq 'israelcentral'` and `serviceName eq 'Foundry Tools'` and `contains(productName, 'Speech')`: **Count 0**.

For the non-HD candidate, the Middle East rows that show neural text to speech are UAE North (`uaenorth`, Dubai) and Qatar Central (`qatarcentral`, Doha). The REST reference lists `https://uaenorth.tts.speech.microsoft.com/cognitiveservices/v1` and `https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1`. It does not list an Israel host. The example config uses `uaenorth` because that region is on the neural TTS table and on the REST host list. West Europe is the documented region to use if the owner later switches to a Dragon HD Andrew voice. No latency figure is claimed.

## edge-tts and the official API

Source: [Text to speech REST API](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech), accessed 21 October 2026.

The official call is an Azure Speech resource in a region. `POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1` with `Ocp-Apim-Subscription-Key` (or a Bearer token), `Content-Type: application/ssml+xml`, and `X-Microsoft-OutputFormat`. The documented PCM example is `riff-24khz-16bit-mono-pcm`. The key is a resource key. The page says a key sent as `Ocp-Apim-Subscription-Key` works with the regional endpoints.

`edge-tts` is not that API. It is a third-party client. The voice lab used it to reach Microsoft Edge read-aloud **without** an Azure resource, key, or region. The REST article does not mention Edge read-aloud or `edge-tts`. The Product Terms sentence above grants paid-tier use of audio from **the TTS Service**. These pages do not extend that sentence to Edge read-aloud, and they do not say that the Edge voice and the Azure voice that share the id `en-US-AndrewMultilingualNeural` are the same model. The id string matches the catalog. Acoustic identity is not documented.

## What the local counter does, and what is still unclear

The counter stores UTC `YYYY-MM` and the caller's JavaScript string length (UTF-16 code units) in `news-launch/azure-tts/state/`. It adds that length **before** the HTTP call. It is a guard so a run stops at the configured cap. It is not a claim that the number equals the invoice.

Unclear on the pages fetched 21 October 2026:

- The billable-character definition (the pricing FAQ points at a pricing note that was not in the fetched pricing page). SSML tags, `sub` alias text, and breaks may or may not be billed differently from the script length.
- What language-table footnotes 1, 2, and 4 mean.
- Whether portal tier S0 is the retail sku labeled S1.
- Whether F0 includes HD voices, and whether HD calls count against the F0 20-transactions-per-60-seconds row.
- Whether every neural-TTS region serves `en-US-AndrewMultilingualNeural`, and which region is nearest to Israel.
- Whether Edge read-aloud audio for that voice id is the Azure voice.
- YouTube and TikTok are not named. Commercial distribution of prebuilt neural output is stated for paid-tier TTS customers. Synthetic disclosure is a separate requirement.
