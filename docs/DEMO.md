# Sharing a live demo of Pumpkin

A link anyone you choose can open on a computer or phone: the real app, with made-up patients only.

- `https://<your-demo-address>/` — the clinic side (pick a test person: Maria the nurse, Maya the patient, Jordan her partner…)
- `https://<your-demo-address>/phone` — the patient phone app, in any phone or computer browser

A passcode you choose keeps it to the people you give it to.

**Never put real patient information in the demo.** It has no BAA, demo sign-in is on, and everyone with the passcode shares the same made-up data.

## Where it runs: Railway

Railway builds the app straight from the GitHub repo using the `Dockerfile`, and redeploys on every push. It bills for what the app uses. The demo uses about 0.5 GB of memory, which is roughly $5–8 a month on the Hobby plan (checked on railway.com/pricing, October 2026). Railway's free trial allows up to 1 GB, so it also runs during the trial; after the trial it needs Hobby.

## Set it up (about 15 minutes)

1. Go to **railway.com** and sign in with GitHub.
2. Click **New Project → Deploy from GitHub repo** and choose **jlbierschank/kinpath** (allow Railway to see that repo if it asks). Railway finds the `Dockerfile` and starts building. The first build takes a few minutes. **It will fail to start until step 3 is done**; that's expected.
3. Open the service, go to **Variables**, and add:

   | Name | Value |
   | --- | --- |
   | `KINPATH_DEV_LOGIN` | `1` |
   | `KINPATH_DEMO_PASSCODE` | a passcode you choose, e.g. `orange-pumpkin-27` |

   Optional, to turn on AI drafting in the demo (uses your Anthropic credits):

   | Name | Value |
   | --- | --- |
   | `KINPATH_AI_PROVIDER` | `anthropic` |
   | `ANTHROPIC_API_KEY` | your key |

   Railway redeploys after you save.
4. Go to **Settings → Networking → Generate Domain**. Railway gives you an address ending in `.up.railway.app`. Open it, enter the passcode, and you're in.
5. Send Tiffany the address, the `/phone` address, and the passcode (send the passcode separately if you like).

## Optional: demo.thepumpkin.ai

In **Settings → Networking**, click **+ Custom Domain** and enter `demo.thepumpkin.ai`. Railway shows two DNS records, a **CNAME** and a **TXT**. Add both where you bought thepumpkin.ai (the domain won't verify with only one). It can take from a few minutes up to 72 hours.

## Good to know

- **The data resets** on every redeploy and whenever someone clicks **Reset demo data**. Everyone with the passcode sees the same made-up patients, so what one person sends, the others can see.
- **Sign-in codes** for "Sign in for real" appear on the **Dev outbox** page; no real texts or emails are sent.
- **The first visit after a redeploy** takes a few extra seconds while the demo data is set up.
- **Phone app changes** reach the demo after the web build is refreshed: `bash scripts/build-phone-web.sh`, then commit and push.
