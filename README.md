# 🏠 Bola de Nieve

Planificador de deudas e hipoteca variable con estrategia de riqueza.

## Instalación

```bash
npm install
```

## Desarrollo local

```bash
npm run dev
```

Abre http://localhost:5173

## Build para producción

```bash
npm run build
```

La carpeta `dist/` contiene la app lista para subir a Cloudflare Pages.

## Iconos

Coloca tus iconos en la carpeta `public/`:
- `icon-192.png` — icono 192×192 px (Android / PWA)
- `icon-512.png` — icono 512×512 px (PWA splash)
- `apple-touch-icon.png` — icono 180×180 px (iPhone/iPad)
- `favicon.ico` — favicon del navegador (opcional)

## Despliegue en Cloudflare Pages

1. Ejecuta `npm run build`
2. Ve a Cloudflare Dashboard → Workers & Pages → Create → Pages
3. Elige "Upload assets" y sube la carpeta `dist/`
