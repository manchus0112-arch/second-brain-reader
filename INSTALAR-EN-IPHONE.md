# Instalar Second Brain en tu iPhone desde tu Mac

Tiempo: unos 20 minutos la primera vez. Es gratis: solo necesitas tu Apple ID.

## Lo que necesitas

- Tu Mac con **Xcode** (gratis en la App Store; pesa bastante, déjalo descargando primero).
- **Node.js**: descarga la versión "LTS" de [nodejs.org](https://nodejs.org) e instálala.
- Tu iPhone y su cable.

## 1. Descargar el proyecto

Abre la app **Terminal** (búscala con Cmd + Espacio) y pega estas líneas, una por una, pulsando Enter:

```
git clone https://github.com/manchus0112-arch/second-brain-reader.git
cd second-brain-reader
npm install
npm run ios
```

Si al escribir `git` el Mac te ofrece instalar las "herramientas de línea de comandos", acepta y vuelve a pegar la línea.

El último comando abre el proyecto en Xcode. La primera vez Xcode tarda un par de minutos en descargar sus piezas (verás "Resolving Package Graph" arriba); espera a que termine.

## 2. Poner tu firma

1. En la columna izquierda de Xcode, haz clic en **App** (el icono azul de arriba del todo).
2. En el centro, en "TARGETS", elige **App** y abre la pestaña **Signing & Capabilities**.
3. En **Team**, elige **Add an Account…** e inicia sesión con tu Apple ID. Luego selecciona tu nombre con "(Personal Team)".
4. Si aparece un error rojo sobre el "Bundle Identifier", cámbialo por algo tuyo, por ejemplo `com.esteban.secondbrain2`.

## 3. Preparar el iPhone

1. Conecta el iPhone al Mac con el cable y, en el iPhone, toca **Confiar**.
2. En el iPhone ve a **Ajustes → Privacidad y seguridad → Modo de desarrollador**, actívalo y deja que se reinicie. (Esta opción aparece después de conectar el iPhone con Xcode abierto.)

## 4. Instalar

1. Arriba en Xcode, junto al botón ▶, elige tu iPhone como destino.
2. Pulsa **▶** (o Cmd + R).
3. La primera vez el iPhone dirá que el desarrollador no es de confianza. Ve a **Ajustes → General → VPN y gestión de dispositivos**, toca tu Apple ID y luego **Confiar**. Vuelve a pulsar ▶ en Xcode.

Listo: el icono de Second Brain queda en tu pantalla de inicio.

## Bueno saber

- **Cada 7 días** Apple caduca las apps instaladas con una cuenta gratuita. Cuando deje de abrir, conecta el iPhone y pulsa ▶ otra vez en Xcode. **Tus libros y notas no se borran.**
- **Para actualizar** a una versión nueva, en Terminal dentro de la carpeta del proyecto:
  ```
  git pull
  npm install
  npm run ios
  ```
  y pulsa ▶ en Xcode.
- La app nativa y la versión de Safari guardan sus datos por separado. Para pasar tus libros y notas de una a otra usa **Más → Crear copia completa** y luego **Restaurar una copia** en la otra.
