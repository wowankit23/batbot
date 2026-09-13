# WhatsApp Cloud API — Render Starter

A minimal webhook server for Meta's WhatsApp Cloud API, ready to deploy on [Render](https://render.com).

## What it does

- `GET /webhook` — handles Meta's one-time webhook verification handshake.
- `POST /webhook` — receives incoming messages and status updates, and echoes
  back any text message it receives (as a demo).
- `POST /send-template` — manually trigger an outbound template message
  (needed to start a conversation outside the 24-hour service window).

## 1. Local setup (optional, for testing before deploying)

```bash
npm install
cp .env.example .env   # then fill in your real values
npm start
```

Use a tool like [ngrok](https://ngrok.com) to expose your local server with a
public HTTPS URL if you want to test the webhook before deploying:

```bash
ngrok http 3000
```

## 2. Deploy to Render

1. Push this folder to a GitHub repository.
2. In the Render dashboard, click **New +** → **Web Service**.
3. Connect your repo.
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Under **Environment**, add the variables from `.env.example`:
   - `VERIFY_TOKEN`
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `GRAPH_API_VERSION` (optional)
6. Deploy. Render will give you a public URL like:
   `https://your-app.onrender.com`

## 3. Connect it in Meta's dashboard

1. Go to your app in [Meta for Developers](https://developers.facebook.com/apps)
   → **WhatsApp** → **Configuration**.
2. Set the **Callback URL** to:
   `https://your-app.onrender.com/webhook`
3. Set the **Verify Token** to the same value you used for `VERIFY_TOKEN`.
4. Click **Verify and save**.
5. Subscribe to the `messages` webhook field.

## 4. Test it

Send a WhatsApp message to your test number — you should see it logged in
Render's logs and receive an automatic echo reply back.

To send an outbound template message manually:

```bash
curl -X POST https://your-app.onrender.com/send-template \
  -H "Content-Type: application/json" \
  -d '{"to": "15551234567"}'
```

## Notes

- Non-template text messages only work inside an open 24-hour customer
  service window (i.e. after the user has messaged you first).
- Render's free tier spins down after inactivity, which can delay the first
  webhook response after idle periods — use a paid instance for production.
- Never commit your `.env` file or access token to version control.
