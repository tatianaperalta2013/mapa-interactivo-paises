# Mapa Interactivo de Países

## Ejecutar localmente

Se necesita Node.js 18 o superior. Desde la carpeta del proyecto, ejecutá:

```powershell
npm start
```

Luego abrí <http://localhost:3000>. No abras `index.html` directamente ni uses
un servidor estático: `server.js` sirve la aplicación y consulta las API del
Banco Mundial y DBnomics para que funcionen los datos y el historial.

## Inicio de sesión

El login y el registro usan Firebase Authentication. Habilitá el método
Email/Password en Firebase y verificá la configuración de `firebase-config.js`.
Los permisos premium y el correo receptor de sugerencias se configuran en
`auth.js`.

## Proxy de vulnerabilidad soberana

Los datos avanzados incluyen una estimación anual propia de 0 a 100 basada en
percentiles entre países: deuda del gobierno central, inflación, crecimiento
del PBI y reservas (con igual peso). Solo se calcula para los países y años con
los cuatro indicadores disponibles; un valor mayor representa mayor
vulnerabilidad relativa. No es el EMBI, un spread de mercado ni una calificación
oficial. Sus series provienen de estos indicadores de la API del Banco Mundial:
`GC.DOD.TOTL.GD.ZS`, `FP.CPI.TOTL.ZG`, `NY.GDP.MKTP.KD.ZG` y `FI.RES.TOTL.MO`.
