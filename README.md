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
