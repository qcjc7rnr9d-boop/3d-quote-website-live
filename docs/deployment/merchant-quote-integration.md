# Merchant Quote Integration

This guide covers the two supported ways to add the Trennen quote flow to a merchant website.

## Recommended Path: Custom Quote Subdomain

Use this when the merchant can edit DNS.

1. Create a quote page/link in the website navigation, usually `Get a Quote`.
2. In DNS, create:
   ```text
   quote.example.com CNAME quotes.trennen.co.nz
   ```
3. In Trennen Admin -> Settings:
   - Add the merchant website origin, for example `https://example.com`.
   - Enter the custom quote subdomain, for example `quote.example.com`.
   - Keep status pending until DNS and TLS are verified.
4. Link the site header/footer `Get a Quote` button to `https://quote.example.com`.

## Fallback Path: Script Embed

Use this when the merchant cannot edit DNS.

```html
<div id="trennen-quote-widget"></div>
<script src="https://embed.trennen.co.nz/widget.js" data-tenant-id="TENANT123"></script>
```

Optional theme parameters:

```html
<script
  src="https://embed.trennen.co.nz/widget.js"
  data-tenant-id="TENANT123"
  data-theme-primary="#0077c8"
  data-theme-font="Inter"
  data-min-height="760"
  data-max-height="8000">
</script>
```

Raw iframe fallback:

```html
<iframe src="https://app.trennen.co.nz/embed/quote?tenant=TENANT123&embed=1" style="width:100%;border:0;min-height:760px;"></iframe>
```

## WordPress

1. Create a new page named `Quote`.
2. Add a Custom HTML block.
3. Paste the Trennen script snippet.
4. Publish the page and add it to the header/footer menu.

## Wix

1. Add a new page named `Quote`.
2. Add an Embed -> HTML element.
3. Paste the raw iframe fallback or script snippet.
4. Set the element width to 100% and a minimum height around 760 px.

## Squarespace

1. Create a new page named `Quote`.
2. Add a Code Block.
3. Paste the Trennen script snippet.
4. Disable automatic code formatting if Squarespace offers that option.

## Registrar DNS Steps

- Cloudflare: DNS -> Add record -> CNAME -> Name `quote` -> Target `quotes.trennen.co.nz` -> DNS only while issuing TLS if needed.
- GoDaddy: DNS -> Add New Record -> CNAME -> Host `quote` -> Points to `quotes.trennen.co.nz`.
- Namecheap: Advanced DNS -> Add New Record -> CNAME -> Host `quote` -> Value `quotes.trennen.co.nz`.
- Squarespace Domains: Domains -> DNS Settings -> Add CNAME -> Host `quote` -> Value `quotes.trennen.co.nz`.
- Wix Domains: Domain Settings -> DNS Records -> CNAME -> Host `quote` -> Value `quotes.trennen.co.nz`.
- Shopify-managed domains: Settings -> Domains -> Manage -> DNS settings -> Add CNAME -> Name `quote` -> Value `quotes.trennen.co.nz`.

## Testing

Test Chrome, Firefox, and Safari with third-party cookies disabled.

Verify:

- The quote page loads the upload screen first.
- Upload, materials, options, quote review, shipping, and checkout work end to end.
- The merchant dashboard receives the order.
- The browser console has no CORS, CSP, mixed-content, or frame-blocking errors.
