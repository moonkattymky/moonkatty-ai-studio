# Editorial fact-check — 20 October 2026

Checked for the corrected edition. The release date of that edition is 20 October 2026. It is not published.

The first file in this folder, `script.txt`, was an extractive draft. It copied headlines from two media outlets and treated that as confirmation. Two outlets echoing each other is not confirmation. This note keeps a claim only when a primary statement says it.

Primary pages were fetched again on 20 October 2026. The WHO Africa page named in search results timed out and is not a source. The Alberta results page was fetched again the same day. Its count cells are empty.

The corrected narration is `news-launch/artifacts/corrected-episode/script.txt`. It was written by the news-launch editor from the statements below. Ollama was not used for that script.

## 1. Alberta referendum — outcome dropped

**Exact headline used in the extractive draft:** "Alberta voters overwhelmingly reject plan to leave Canada in referendum" (The Guardian), paired with "Voters reject separation of Alberta from Canada in referendum" (CBS News).

**Verdict:** the winner, the percentages, and the vote totals in secondary copy are **not confirmed**. They are removed. The story that replaces them is the Elections Alberta process, which is confirmed, and an explicit line that this edition does not call a winner.

### What the extractive draft used

| Outlet | Headline | Publication time stored from RSS |
| --- | --- | --- |
| The Guardian | Alberta voters overwhelmingly reject plan to leave Canada in referendum | 2026-10-20T16:24:05Z |
| CBS News | Voters reject separation of Alberta from Canada in referendum | 2026-10-20T06:11:00Z |

Guardian URL: https://www.theguardian.com/world/2026/oct/20/canada-alberta-rejects-independence-succession-referendum

The Guardian article, re-read on 20 October 2026, says that with nearly 1.9 million votes counted, roughly 76 percent supported remaining in Canada and 24 percent backed beginning a process toward separation, "according to unofficial results from Elections Alberta." The page timestamp is Tuesday 20 October 2026, 12.24 EDT, first published 01.50 EDT. That is one newsroom's account of an unofficial count.

CBS was not re-read beyond the stored headline. A second media article is not a count. The NPR Alberta story was not retrieved in this pass (the fetch timed out), so no NPR figure is used.

### Primary sources

1. Elections Alberta, "Unofficial Referendum Results Reporting Process", 19 October 2026.
   https://www.elections.ab.ca/resources/media/news-releases/2026-10-19-2/
2. Elections Alberta, "Referendum".
   https://www.elections.ab.ca/elections/referendum/
3. Elections Alberta unofficial results, fetched 20 October 2026. Count cells empty. The page still says "Loading...".
   https://results.elections.ab.ca/8400

### Confirmed, and used

- A referendum was set for 19 October 2026. The script says Elections Alberta held it that day. Voting locations were scheduled to close at 8:00pm and could stay open longer.
- Question 10 asks whether Alberta should remain a province of Canada, or whether the government should commence the legal process for a binding provincial referendum on separation. The script compresses that to "remain in Canada or start the legal process for a separation vote." It does not say a separation vote has been ordered.
- Official results are published on 29 October 2026. The script says they are due that day and that no winner is called.

Confirmed and **not spoken**, to keep the bulletin inside 60 seconds:

- O.C. 160/2026 says the results on question 10 are not binding. The script does not call them binding.
- Option 1 is remain. Option 2 is to commence the legal process.
- Advance and special-ballot turnout was 43.1 percent: 837,791 votes in the five-day in-person advance period and 519,082 special ballots. Those are turnout components, not a result.
- Question 10 is counted and reported first. Voting locations could stay open past 8:00pm.

### Not confirmed — dropped

- Any winner. The results site has no numbers in the static page.
- 76 percent / 24 percent, and "nearly 1.9 million" votes. One newspaper attributed them to unofficial results. Elections Alberta has not published them on the pages above.
- Quotes from Mark Carney, Danielle Smith, Keith Wilson, and others in the Guardian piece. They are not in an Elections Alberta statement.
- The Guardian photographs (Canadian Press / Shutterstock, Reuters). Not used.

### Still current on 20 October 2026

Yes, for the process facts. Official results are not due until 29 October 2026, so a winner line cannot be added before that primary publication.

## 2. Ebola case in the Federal Capital Territory — confirmed

**Exact headline of the primary statement:** "FG CONFIRMS EBOLA DISEASE CASE IN FCT, ACTIVATES PUBLIC HEALTH RESPONSE".

**Dateline:** Abuja, Nigeria | 20 October 2026.

**Verdict:** confirmed by the ministry statement. Spoken facts are limited to that statement.

### Primary source

Federal Ministry of Health and Social Welfare of Nigeria, press statement PDF, 2 pages.

https://health.gov.ng/wp-content/uploads/2026/10/Immediate-Press-statememnt_confirmed-Ebola-in-Nigeria-1.pdf

The filename contains the typo "statememnt". That is the file that was downloaded. `file` reported a PDF 1.7, 2 pages. Text extracted with `pdftotext` on 20 October 2026.

Issued under the name **Prof. Muhammad Ali Pate, CON, Coordinating Minister**.

### What the extractive draft used (secondary, not the confirmation)

| Outlet | Headline | Publication time stored from RSS |
| --- | --- | --- |
| NPR | Nigeria confirms an Ebola case in Abuja as a woman arriving from Uganda tests positive | 2026-10-20T20:19:16Z |
| ABC News | Nigeria confirms Ebola case in Abuja as woman who arrived from Uganda tests positive | 2026-10-20T20:02:27Z |

Those headlines agree with the ministry on the existence of a case, Abuja, and a woman who arrived from Uganda. They are not the source of the numbers in the corrected script.

### Confirmed, and used

- One case of Ebola disease in the Federal Capital Territory, after laboratory confirmation on 20 October 2026. The script says "in the FCT". The on-screen heading is Abuja, which is the statement's dateline.
- The patient is a woman who recently arrived from Uganda. The script says "a woman from Uganda". The PDF also says the arrival was an international flight. The word "flight" is not spoken.
- She is currently in isolation.
- **44** close contacts identified presently. The script says officials list forty-four.
- Coordinating Minister Muhammad Ali Pate issued the statement. The PDF places his name and title at the end. It does not contain a separate signature image, so the script says "issued", not "signed".

### Confirmed, and not spoken (time)

- She was admitted to a private hospital in the FCT and received care for several days before confirmation.
- Contacts include healthcare workers, patients, caregivers, and travel contacts.
- The statement says Nigeria contained Ebola in 2014.
- NCDC toll-free number 6232, 24 hours.

### Not in the ministry PDF — dropped

- The virus strain. A WHO Africa URL that mentions Bundibugyo in the slug timed out. The strain is not spoken and is not treated as confirmed.
- "First case", symptom-onset dates, and admission dates that appear in wire copy. They are not in the PDF.
- Any photograph. None is used.

### Still current on 20 October 2026

The statement is dated the same day as this edition. "Forty-four close contacts identified presently" is the figure at the time of the statement. It can change. The script reports it as the figure officials had identified in that statement.

## 3. UK Typhoon jets and Saudi Arabia — confirmed

**Exact headline of the primary statement:** "Operational update 20 October – UK military support to the Kingdom of Saudi Arabia".

**Verdict:** confirmed by the Ministry of Defence page. Spoken facts are limited to that page.

### Primary source

UK Ministry of Defence and The Rt Hon Wes Streeting MP. Published 20 October 2026.

https://www.gov.uk/government/news/operational-update-20-october-uk-military-support-to-the-kingdom-of-saudi-arabia

The page's photograph of the Ministry of Defence building was **not** downloaded and is **not** in the video.

### What the extractive draft used (secondary)

| Outlet | Headline | Publication time stored from RSS |
| --- | --- | --- |
| BBC News | UK to deploy jets to defend Saudi Arabia from Houthi attacks | 2026-10-20T13:54:35Z |
| The Guardian | UK to deploy fighter jets to protect Saudi Arabia from Houthi attacks | 2026-10-20T18:30:16Z |
| Al Jazeera | UK to deploy fighter jets to defend Saudi Arabia | 2026-10-20T18:55:52Z |

BBC article re-read on 20 October 2026: https://www.bbc.co.uk/news/articles/ckr5yqe1r1llo — page time 20 October 2026, 12:09 BST, updated later the same day. The headline matches the deployment. Several sentences in the body are **not** in the MoD page and are dropped (below).

### Confirmed, and used

- RAF Typhoon jets will fly defensive counter-air missions to support the protection of Saudi cities and critical national infrastructure. The script says "Typhoon jets will defend Saudi cities." "Infrastructure" and the words "Royal Air Force" are not spoken. The ministry is named.
- "These aircraft will operate in a defensive role and will not conduct offensive strikes against the Houthis." The script keeps "will not conduct offensive strikes against the Houthis."
- Wes Streeting: "That's why today I have approved further UK military support." The page is published 20 October 2026. The script says he approved that on October twentieth. His title, Defence Secretary, is on the page and is not spoken.

### Confirmed, and not spoken (time, or easy to mishear)

- An RAF A400M will move defence materiel inside Saudi Arabia, with UK military advisers to support Saudi staff officers.
- The page also extends air-to-air refuelling for Saudi defensive air operations, "including to degrade Houthi military targets in Yemen". That clause is about refuelling support for Saudi operations. It is not a statement that the Typhoons will strike. It is left out of the narration so the two roles are not blurred.
- The page condemns attacks on civilian targets "like King Khalid International Airport" and quotes Streeting on the airport in Riyadh. Those sentences are confirmed and not spoken.

### In the BBC article, not in the MoD page — dropped

- "A move authorised by Prime Minister Andy Burnham." The MoD page does not name him.
- "The refuelling has now been extended by 90 days." The MoD page says the refuelling support is extended. It does not say 90 days.
- "They will also free up the country's own aircraft to carry out offensive strikes." That is the BBC's wording. The MoD page says the Typhoons will not conduct offensive strikes.
- Casualty counts, the 10 October strike, and file video. Not in the MoD page that was fetched, and no image from the BBC page is used.

### Still current on 20 October 2026

The MoD statement is dated the same day. No later official update was found in this pass. The corrected script does not add one.

## Visual match

Every frame in the corrected edition is a generated colour card plus the scene heading: MOONKATTY NEWS, Alberta, Abuja, Saudi Arabia, Sources. No still from Elections Alberta, the health ministry, GOV.UK, the Guardian, or the BBC is in the file. Rights for those images were not cleared.

## Pronunciation

Written names in the script and the SRT stay as published. Pronunciations live in `media-automation/assets/lexicon.json` and are applied by `SpeechComposer` only to audio. See `news-launch/VOICE_REPORT.md`. "Muhammad Ali Pate" is spoken as an editorial hint (Moo-hah-mud Ah-lee Pah-tay). That pronunciation was not verified with the minister's office.
