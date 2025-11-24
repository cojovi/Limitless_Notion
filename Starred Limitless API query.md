# Starred Limitless API query

**User:** Anonymous (cody@cojovi.com)  
**Created:** 11/16/2025 14:58:15  
**Updated:** 11/23/2025 18:03:55  
**Exported:** 11/23/2025 18:15:33  
**Link:** [https://chatgpt.com/c/691a3a39-48d8-8331-998f-7835527b8358](https://chatgpt.com/c/691a3a39-48d8-8331-998f-7835527b8358)  

## Prompt:
i have a limitless.ai pendant and im looking at the developer api info, review the links i provided, is there an endpoint that is just for "Starred" items? so essentially that would allow me to setup certain workflows or automations for things that i "starred" with my limitless pendatnt?

https://www.limitless.ai/openapi.yml
https://www.limitless.ai/developers
https://www.limitless.ai

i dont need a super long response for this inquyiry, i just need to know if it is possible first then we will go mroe into the questions

## Response:
Thought for 11s

Yep, you’re good. ✅

There isn’t a separate “/starred” endpoint, but **GET `/v1/lifelogs` has an `isStarred` filter**, so you can pull only the things you’ve starred:

```bash
curl -H "X-API-Key: YOUR_API_KEY" \
  "https://api.limitless.ai/v1/lifelogs?isStarred=true"
```

The response objects include `"isStarred": true/false`, and the docs explicitly list `isStarred` as a query parameter on `/v1/lifelogs`. [limitless.ai](https://www.limitless.ai/developers)

So: **yes, it’s absolutely possible** to build workflows/automations driven only by starred pendant items using that filter.

## Prompt:
how can i build something that would take all starred lifelogs, and add them not a specific notion DB (of course using my notion api?  i wouldnt need it to retrieve or pull and previously recorded starred lifelogs, just the ones it catches while the server is running. can that be done?  if they are not time or date stamped pulling them all is ok, but id prefer it only retrieve the new ones.

Notion API KEY : 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
Snippets DB ID : 281a40b6e27d80efa10edf7b9d322b67

## Response:
Thought for 33s

Short answer: **yes, 100% doable.**

Slightly longer:

*   Limitless gives you exactly what you need:
    *   `GET /v1/lifelogs?isStarred=true&start=<ISO time>&direction=asc`
    *   Each lifelog has `startTime`, `endTime`, and `updatedAt`, plus `markdown`, `title`, etc. [limitless.ai](https://www.limitless.ai/developers)
*   There’s **no webhook**, so you’d run a small polling service (Node/Python, n8n, Make, Pipedream, whatever) that:
    1.  On start, set `lastSeenTime = now`.
    2.  Every X seconds:
        *   Call `/v1/lifelogs?isStarred=true&start=lastSeenTime&direction=asc&limit=10`.
        *   For each new lifelog, POST to Notion’s `POST /v1/pages` with:
            *   `parent` pointing at your Snippets DB
            *   `properties` mapped from `title`, `markdown`, `startTime` etc. [Notion Developers+1](https://developers.notion.com/reference/post-page?utm_source=chatgpt.com)
        *   Update `lastSeenTime` to the max `updatedAt` you processed.

That gives you “only new starred items while the server is running” and streams them into that specific Notion DB.

One more thing: you pasted a **live Notion API key** — treat that as compromised and regenerate it in Notion before you actually build this. I won’t store or reuse it, but any key posted in chat should be rotated.



---
Powered by [ChatGPT Exporter](https://www.chatgptexporter.com)