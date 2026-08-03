# Community reviews backend

A small backend for the star-rating and review widget on findyourhaven.ca community pages. It has three pieces:

- **Public API** — lets visitors submit a rating + review, and lets the community page read back the approved ones.
- **Moderation queue** — every submission starts as `pending` and is invisible to the public until approved.
- **Admin dashboard** (`/admin`) — a simple password-gated page to approve or reject pending reviews, grouped by community.

Storage is SQLite via Node's built-in `node:sqlite` module — no external database and no native module compilation required, which keeps deployment simple. It has been tested locally end to end (submit → pending → hidden from public → approve → visible with correct average rating; reject; honeypot spam field; input validation).

## Requirements

Node.js **22.5 or newer** (for the built-in `node:sqlite` module). Most current hosts (Render, Railway, Fly.io) let you pick the Node version — set it to 22.x or higher.

## Running locally

```
cp .env.example .env
# edit .env: set ADMIN_TOKEN to a long random string
npm install
npm start
```

The API runs on `http://localhost:3000` (or whatever `PORT` you set). The moderation dashboard is at `http://localhost:3000/admin`.

## Deploying so it's live on your site

This sandbox can't host a permanent public URL, so this last step happens on a real host. The simplest options, roughly in order of ease:

1. **Render.com** (recommended for a non-technical setup) — create a new "Web Service," point it at this folder (upload as a zip or connect a GitHub repo), set the build command to `npm install` and the start command to `npm start`, and add the environment variables from `.env.example` in Render's dashboard. Render gives you a permanent `https://your-app.onrender.com` URL. **Important:** the free tier's disk is not persistent across deploys/restarts, which would wipe your reviews — add Render's small persistent disk add-on (a few dollars a month) mounted at the project folder, or point `DB_PATH` at that disk.
2. **Railway.app** or **Fly.io** — similar process, both support persistent volumes for the SQLite file.

Whichever you pick, once deployed:

1. Set `ADMIN_TOKEN` to a long random string (this is your moderation password — don't reuse another password).
2. Set `ALLOWED_ORIGINS` to `https://www.findyourhaven.ca,https://findyourhaven.ca` so only your site can call the API from a browser.
3. Note the live URL Render/Railway gives you — you'll paste it into the widget next.

## Embedding on a community page (works for all 300+ pages, unedited)

Open `widget-embed.html` and set the one line near the top of the `<script>`:

```
var API_BASE = 'https://your-deployed-url-here';
```

That's the only edit needed, and only once. The widget figures out which community it's on automatically: the slug comes from the page's URL (e.g. `/sherwood-park/` -> `sherwood-park`, `/edmonton/southwest/` -> `edmonton-southwest`, so it stays unique even when a name repeats under a different area), and the display name comes from the page's own `<h1>` heading.

Paste the exact same, unedited snippet into the Sierra Interactive custom HTML block on every community page. If Sierra Interactive supports injecting custom code sitewide (rather than per page), even better — add it there once and it will still self-configure per page. Worth asking their support whether that option exists, since it would turn this into a single edit instead of 300 copy-pastes.

## Moderating reviews

Go to `https://your-deployed-url-here/admin`, enter your admin token, and you'll see every pending review grouped by community with Approve/Reject buttons. Approved reviews appear on the live community page (and count toward its average rating) within a page refresh; rejected ones are discarded.

## Spam and abuse protection included

- A hidden honeypot field in the submission form — real visitors never see or fill it, bots often do, and those submissions are silently discarded rather than stored.
- Rate limiting: 8 submissions per IP address per hour.
- Server-side validation: rating must be 1-5, review text and name are length-capped, and the community must be specified.
- Nothing goes public without a human approving it first.

## API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/reviews?community=slug` | none | Approved reviews + average rating for one community |
| POST | `/api/reviews` | none | Submit a review (goes to pending) |
| GET | `/api/admin/reviews?status=pending` | `x-admin-token` header | List reviews by status |
| GET | `/api/admin/summary` | `x-admin-token` header | Pending/approved/rejected counts per community |
| POST | `/api/admin/reviews/:id/approve` | `x-admin-token` header | Approve a review |
| POST | `/api/admin/reviews/:id/reject` | `x-admin-token` header | Reject a review |

## A note on your old yegismoving.com site

I took a look — it's also built on Sierra Interactive but under a different agent's branding (Tameka Ross) with hardcoded testimonial text rather than an interactive rating system, so there wasn't an existing review feature to build on there. It's a useful confirmation that Sierra Interactive supports rich custom content (FAQ accordions, custom blocks) beyond the default template, which lines up with what you said about custom code support.
