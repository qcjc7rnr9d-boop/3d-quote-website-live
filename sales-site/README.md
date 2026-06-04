# Trennen Sales Site

This is the standalone local server for the public marketing website.

It serves `sales-site/public` without running the software backend on port
`3000`. Signup and walkthrough API calls are proxied to the software app, which
should run separately on port `3003`.

## Local URLs

- Sales site: `http://localhost:3000`
- Product: `http://localhost:3000/product.html`
- Pricing: `http://localhost:3000/pricing.html`
- How it works: `http://localhost:3000/how-it-works.html`
- FAQ: `http://localhost:3000/faq.html`
- Software app: `http://localhost:3003`

## Page Map

Homepage stays intentionally concise: hero, short workflow map, compact pricing,
live widget, FAQ preview, and final CTA.

- `/` - concise sales homepage for the first decision: understand Trennen,
  choose pricing, and try the live widget.
- `/product.html` - product overview page for intake, pricing, quote review,
  approval, and job tracking.
- `/pricing.html` - detailed plan comparison for quote limits, extra quote
  charges, trial details, and payment fee notes.
- `/how-it-works.html` - deeper workflow and SEO page for the full request to
  approved-job explanation.
- `/faq.html` - full FAQ and SEO page for workflow, pricing, and payment
  questions.
- `/terms.html` and `/privacy.html` - public legal pages.
- `/signup-success.html` and `/404.html` - noindex support pages.

If you want to run the sales site from the main project folder, copy this
separate unit across first:

```bash
cp -R /Users/daniel/.codex/worktrees/ad2d/3d-quote-website/sales-site /Users/daniel/3d-quote-website/
```

Then start the two units in separate terminals:

```bash
cd /Users/daniel/.codex/worktrees/ad2d/3d-quote-website/backend
PORT=3003 npm start
```

```bash
cd /Users/daniel/.codex/worktrees/ad2d/3d-quote-website/sales-site
PORT=3000 npm start
```

If Codex reports `EPERM` while starting the server, start it from your normal
Mac Terminal. This Codex sandbox cannot bind local ports, but the same command
works from an ordinary terminal session.

Use `SOFTWARE_BASE_URL` if the software app is not running on
`http://localhost:3003`.

Keep marketing website changes in `sales-site/public`. Keep the quote flow,
admin, customer portal, checkout, and billing logic in the software app.

## Checks

Run the static sales-site checks before browser review:

```bash
cd /Users/daniel/.codex/worktrees/ad2d/3d-quote-website/sales-site
npm run smoke
```

`npm run smoke` includes design-quality checks for focused navigation, concise
copy, SEO metadata, parsed JSON-LD, accessibility/content structure, widget
placement, form labels, link integrity, reduced-motion support, and asset
budgets. It also checks the approved homepage information architecture so the
first screen does not drift back into a crowded explainer, and it guards the
Trennen brand/copy system against placeholder names, generic hype copy, and
off-brand palette drift. Responsive layout checks cover the desktop, laptop,
tablet, mobile, and reduced-motion CSS rules that keep the page readable.
