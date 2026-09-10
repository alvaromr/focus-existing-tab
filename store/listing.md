# Chrome Web Store listing copy

Not published there (it requires a paid developer account and a public privacy policy URL); kept
ready in case it ever is. Paste into the developer dashboard. Screenshots are generated with
`pnpm screenshots` (1280×800, in `store/screenshots/`).

## Name

Focus Existing Tab

## Short description (max. 132 characters)

- en: `When you open a URL that is already open in another tab, focus that tab instead of loading it again.`
- es: `Si abres una URL que ya está en otra pestaña, enfoca esa pestaña en vez de cargarla de nuevo.`

## Detailed description

### English

Ever ended up with three tabs of the same page? Focus Existing Tab prevents it: when you open a
URL that is already open in any window, it jumps to that tab and closes the new one before it
loads.

Features:
• Catches the navigation at the earliest possible event so the page is not loaded twice.
• Whitelist and blacklist with glob patterns and regular expressions.
• Configurable query-parameter comparison: ignore utm_*, fbclid, gclid… or mark the ones that
matter, globally or per site.
• Normalization: ignore #fragment, www., http/https, trailing slash, port, letter case and
parameter order, as you choose.
• Protected pinned tabs, per-window or global scope, tab groups, incognito, app windows,
"focus only" mode.
• Configurable priority to pick which tab to focus (same window, active, pinned…).
• "Deduplicate all tabs" from the popup or with Alt+Shift+D.
• Counter of avoided duplicates on the icon.
• Import and export the configuration as JSON.
• No servers, no analytics, no remote code. Open source (MIT).

### Español

¿Cuántas veces has acabado con tres pestañas de la misma página? Focus Existing Tab lo evita:
cuando abres una URL que ya tienes abierta en cualquier ventana, salta a esa pestaña y cierra la
nueva antes de que cargue.

Funciones:
• Detecta la navegación en el evento más temprano posible para no cargar la página dos veces.
• Lista blanca y lista negra con patrones glob y expresiones regulares.
• Comparación de parámetros de URL configurable: ignora utm_*, fbclid, gclid… o indica los que sí
importan, globalmente o por sitio.
• Normalización: ignora #fragmento, www., http/https, barra final, puerto, mayúsculas y orden de
parámetros, según elijas.
• Pestañas fijadas protegidas, ámbito por ventana o global, grupos, incógnito, ventanas de apps,
modo «solo enfocar».
• Prioridad configurable para elegir qué pestaña enfocar (misma ventana, activa, fijada…).
• «Desduplicar todas las pestañas» desde el popup o con Alt+Mayús+D.
• Contador de duplicados evitados en el icono.
• Importar y exportar la configuración en JSON.
• Sin servidores, sin analítica, sin código remoto. Código abierto (MIT).

## Category

Productivity → Tools

## Languages

English, Spanish

## Privacy practices (Web Store form)

- Single purpose: avoid duplicate tabs by focusing the one already open.
- `tabs` justification: read the URLs of open tabs to find the one already open, activate it, close
  the duplicate and go back in the originating tab.
- `webNavigation` justification: learn about every navigation before it loads
  (`onBeforeNavigate`) and about the final URL after redirects.
- `storage` justification: save the user's configuration and the counter.
- Remote code: no.
- Data collected: none. Certify that no data is sold, used for purposes unrelated to the core
  functionality, or used for creditworthiness or lending.
- Privacy policy URL: `PRIVACY.md` published at a public URL.

## Before uploading

1. `pnpm check && pnpm test:e2e`
2. `pnpm release` (bumps `manifest.json` and `package.json`).
3. `pnpm package` → `dist/focus-existing-tab-<version>.zip`.
4. `pnpm screenshots` if the UI changed.
