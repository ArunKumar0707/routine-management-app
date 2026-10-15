# DayFlow background alerts — setup (about 10 minutes, free)

This adds a tiny "push server" so DayFlow can notify you at each start time **even when the app is closed**.
It runs on Cloudflare Workers' free plan (no credit card). Your GitHub Pages site stays exactly as it is.

You need: a Cloudflare account (email only), Node.js (only to run the key generator once), and your GitHub Pages URL.

---

## 1. Generate your keys (once)

```
node push/generate-vapid-keys.js
```

It prints a **PUBLIC KEY** and a **PRIVATE KEY**. Keep this window open.
The private key is a secret: never put it in GitHub or in `push-config.js`.

## 2. Create the worker

1. Go to <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Create Worker**.
2. Name it `dayflow-push` → **Deploy** (the sample "Hello World" is fine for now).
3. Click **Edit code**, delete everything, paste the entire contents of `push/worker.js`, then **Deploy**.

## 3. Add storage

1. Dashboard → **Storage & Databases** → **KV** → **Create a namespace** → name it `dayflow`.
2. Open your worker → **Settings** → **Bindings** → **Add** → **KV namespace**.
   - Variable name: `DAYFLOW` (exactly, capitals)
   - KV namespace: `dayflow`

## 4. Add the settings

Worker → **Settings** → **Variables and Secrets** → **Add**:

| Type | Name | Value |
|---|---|---|
| Text | `VAPID_PUBLIC` | the PUBLIC KEY from step 1 |
| Text | `VAPID_SUBJECT` | `mailto:you@example.com` (your email) |
| Text | `ALLOWED_ORIGIN` | your site's origin, e.g. `https://your-name.github.io` (no path, no trailing slash). Add `,http://localhost:8000` if you test locally. |
| **Secret** | `VAPID_PRIVATE_JWK` | the whole PRIVATE KEY line from step 1 (the `{"kty":...}` text) |

Then **Deploy** again if the dashboard asks.

## 5. Turn on the every-minute timer

Worker → **Settings** → **Trigger Events** (or **Triggers**) → **Cron Triggers** → **Add** → enter `* * * * *`.

## 6. Connect DayFlow to it

Copy your worker's URL (looks like `https://dayflow-push.your-name.workers.dev`; opening it in a browser should say
"DayFlow push worker is running."). Edit `push-config.js` in your DayFlow folder:

```js
window.DAYFLOW_PUSH = {
  server: 'https://dayflow-push.your-name.workers.dev',
  vapidPublicKey: 'PASTE_THE_PUBLIC_KEY_HERE'
};
```

Commit and push to GitHub (the public key is safe to commit).

## 7. Turn it on, on your phone

1. Open your GitHub Pages link in Chrome. Add it to the home screen (menu → **Install app**) and open it from there.
2. In the **Alerts** card: switch on **Alert when an activity starts**, then **Background alerts**, and **Allow** notifications.
3. Press **Send test push**. A notification should appear within a few seconds.
4. Close the app completely and press **Send test push** from another device, or just wait for your next activity.

DayFlow automatically re-sends your schedule to the worker whenever you edit activities, change the reminder time,
or switch routine, so there is nothing else to maintain. Alerts follow the routine that is selected when you last opened DayFlow.

---

## If something doesn't work

- **"Not set up yet"** under Background alerts: `push-config.js` is empty or not deployed yet.
- **Test fails / 404:** switch Background alerts off and on again to re-register.
- **Nothing on the phone, test said OK:** Android → Settings → Apps → Chrome → Battery → **Unrestricted**, and make sure
  Chrome notifications and the "DayFlow" site notifications are allowed. Phones in battery-saver mode can delay pushes.
- **Notification arrives a minute late:** the timer runs once a minute, so alerts are accurate to about a minute.
- **See what the worker is doing:** worker → **Logs** (or `wrangler tail`).
- **Custom tones** only play inside the open app. A closed-app notification uses your phone's normal notification sound.

## Good to know

- Free plan limits are far above what this needs (one worker run + one storage read per minute).
- Your activity names and times are stored in **your own** Cloudflare account (KV) so the worker can send alerts. Nobody else can read them, and removing
  yourself is one click: switch Background alerts off.
- The worker only pushes to genuine browser push services, and only accepts requests from your site's origin.
- iPhone: works only for the installed home-screen app on iOS 16.4 or newer.
