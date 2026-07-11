# Gotenberg — Vault preview conversion service

A standalone [Gotenberg](https://gotenberg.dev) instance that converts Office
documents (`.docx/.xlsx/.pptx`, and legacy `.doc/.xls/.ppt`) to PDF for the
Vault preview pipeline. It is a **separate Railway service** from the main API
— the API never bundles LibreOffice; it just POSTs documents here over HTTP.

## Deploy on Railway (one-time)

1. In the same Railway project as the backend, **New → Service → Deploy from
   repo**, pointing at this repository.
2. Set that service's **Root Directory / config path** to use
   `deploy/gotenberg/railway.json` (or set the Dockerfile path to
   `deploy/gotenberg/Dockerfile` in the service's build settings). It builds
   from the pinned `gotenberg/gotenberg:8` image.
3. No env vars are required on the Gotenberg service itself. Railway injects
   `PORT`; the Dockerfile's `CMD` binds Gotenberg to it.
4. After it deploys, copy its URL (private networking is fine —
   e.g. `http://gotenberg.railway.internal:PORT`, or the public
   `https://<svc>.up.railway.app`).

## Wire it into the main API

On the **backend** service, set:

```
GOTENBERG_URL=<the Gotenberg service URL, no trailing slash>
# optional; default 60000
GOTENBERG_TIMEOUT_MS=60000
```

That's all the API needs — `VaultPreviewService` calls
`POST {GOTENBERG_URL}/forms/libreoffice/convert`.

## Verify

- Gotenberg health: `GET {GOTENBERG_URL}/health` → `200`.
- End-to-end: upload a `.docx` via the Vault API, confirm the upload, then
  poll `GET /vault/files/:id/view-url` — `previewStatus` should move
  `PENDING → READY` and return a `viewUrl` pointing at the converted PDF.

## Notes

- If `GOTENBERG_URL` is unset on the API, PDF/image previews still work
  (they need no conversion); Office-doc conversions fail gracefully to
  `previewStatus = FAILED` instead of hanging at `PENDING`.
- Conversion runs per **version**, fire-and-forget after confirm-upload, so
  the API response isn't blocked on LibreOffice.
