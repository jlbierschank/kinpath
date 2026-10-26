# Sharing a live demo of Pumpkin

A link the people you choose can open on a computer or phone: the real app, with made-up patients only.

- `https://<your-demo-address>/` — the clinic side (pick a test person: Maria the nurse, Maya the patient, Jordan her partner…)
- `https://<your-demo-address>/phone` — the patient phone app, in any phone or computer browser

A passcode you choose keeps it to the people you give it to.

**Never put real patient information in the demo.** It has no BAA, demo sign-in is on, and everyone with the passcode shares the same made-up data.

## Where it runs: DigitalOcean App Platform

App Platform builds the app straight from the GitHub repo using the `Dockerfile` and redeploys on every push. The demo needs about 0.5 GB of memory, so use the **1 GiB** size: **$10/month** (fixed size, one container; checked on digitalocean.com/pricing/app-platform, October 2026). The 512 MiB size is too small.

(Railway was the first choice, but it has paused new sign-ups as of late October 2026.)

## Set it up (about 15 minutes)

1. Go to **cloud.digitalocean.com** and create an account (it asks for a card).
2. Click **Create → App Platform**. Choose **GitHub**, allow DigitalOcean to see the **jlbierschank/kinpath** repo, pick branch **main**, and keep **Autodeploy** on.
3. It finds the `Dockerfile` and shows one web service. Set its size to **1 GiB RAM** (the $10 fixed size) and the instance count to **1**.
4. Add these environment variables to the web service (run time):

   | Name | Value |
   | --- | --- |
   | `KINPATH_DEV_LOGIN` | `1` |
   | `KINPATH_DEMO_PASSCODE` | a passcode you choose, e.g. `orange-pumpkin-27` |
   | `PORT` | `8080` (App Platform sends visitors to port 8080 by default) |

   Optional, to turn on AI drafting in the demo (uses your Anthropic credits; tick **Encrypt** on the key):

   | Name | Value |
   | --- | --- |
   | `KINPATH_AI_PROVIDER` | `anthropic` |
   | `ANTHROPIC_API_KEY` | your key |

5. Pick a region near you (New York) and click **Create Resources**. The first build takes several minutes.
6. When it says it's live, open the address it shows (ending in `.ondigitalocean.app`), enter the passcode, and you're in.
7. Send Tiffany the address, the same address with `/phone` on the end, and the passcode.

## Optional: demo.thepumpkin.ai

In the app's **Settings → Domains**, add `demo.thepumpkin.ai`. DigitalOcean shows the DNS record to add (a CNAME) where you bought thepumpkin.ai. It can take a little while to start working.

## Good to know

- **The data resets** on every redeploy and whenever someone clicks **Reset demo data**. Everyone with the passcode sees the same made-up patients, so what one person sends, the others can see.
- **Sign-in codes** for "Sign in for real" appear on the **Dev outbox** page; no real texts or emails are sent.
- **The first visit after a redeploy** takes a few extra seconds while the demo data is set up.
- **Phone app changes** reach the demo after the web build is refreshed: `bash scripts/build-phone-web.sh`, then commit and push.
