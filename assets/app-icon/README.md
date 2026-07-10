# G-FEST 2026 — App Icon ("Spine · Showa")

Drop-in icon set for the PWA at gfest.phils.pics. Minus One palette:
void #07090C · atomic blue #56C7EC · ember #EA8A3C. Dorsal-spine mark, atomic→ember.

## Files
| File | Size | Use |
| --- | --- | --- |
| icon.svg | vector | Master — scales to anything; use for <link rel="icon" type="image/svg+xml"> |
| icon-1024.png | 1024 | High-res master / stores |
| icon-512.png | 512 | manifest "any" |
| icon-192.png | 192 | manifest "any" |
| maskable-512.png | 512 | manifest "maskable" (extra safe-zone padding) |
| maskable-192.png | 192 | manifest "maskable" |
| apple-touch-icon.png | 180 | iOS home screen |
| favicon-32.png / favicon-16.png | 32 / 16 | Browser tab |
| icon-rounded-preview.png | 512 | Preview/marketing ONLY — do not ship; the OS rounds corners itself |

All shippable icons are full-bleed squares on the void background (no baked-in
rounded corners), so iOS/Android mask them cleanly.

## manifest.webmanifest
```json
{
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "theme_color": "#07090C",
  "background_color": "#07090C"
}
```

## <head>
```html
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```
