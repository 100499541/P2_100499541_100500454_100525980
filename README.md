# Guía de uso de la aplicacion

Esta guía servirá como ayuda para iniciar correctamente la aplicación y para poder probarla en varios dispositivos.

Como requisitos previos necesitaremos node.js, express y ngrok.

## Iniciar la aplicación localmente

Para poder utilizar la aplicación desde el dispositivo donde se encuentra instalado debemos introducir lo siguiente en un terminal dentro del directorio del proyecto:
```
node server.js
```
Una vez ejecutado recibiremos el siguiente mensaje:
```
Servidor corriendo en http://localhost:3000
```
Ahora al acceder a ese enlace podremos ejecutar localmente la aplicación. Se puede abrir varias veces el enlace para simular varios usuarios diferentes, cada uno en una pestaña nueva del navegador.

## Uso de ngrok para utilziar la aplicación en otros dispositivos.

Para probar la aplicación en diferentes dispositivos se utiliza ngrok. Para ello, podemos descargar la version de ejecutable standalone en https://ngrok.com/download/windows?tab=download.
