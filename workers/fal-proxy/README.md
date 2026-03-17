# SceneHF Fal Proxy

Cloudflare Worker proxy for Fal background removal with BYOK.

## What it does

- Accepts an image upload from the frontend
- Accepts the user's Fal key via `x-fal-api-key`
- Uploads the file to Fal
- Runs the configured Fal background-removal model
- Returns the generated image back to the frontend

## Local dev

```bash
cd workers/fal-proxy
npm install
npm run dev
```

## Deploy

```bash
cd workers/fal-proxy
npm install
npm run deploy
```

After deploy, copy the Worker URL into the frontend `Fal Proxy URL` setting.

## Route contract

- `POST /bg-remove`
- multipart form-data fields:
  - `image`: file
  - `model`: optional Fal model id
- header:
  - `x-fal-api-key`: required user-provided Fal API key

- `POST /upscale`
- multipart form-data fields:
  - `image`: file
  - `model`: optional Fal model id
  - `factor`: optional upscale factor
- header:
  - `x-fal-api-key`: required user-provided Fal API key
