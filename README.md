# Guía de uso de la aplicacion

Esta guía servirá como ayuda para iniciar correctamente la aplicación y para poder probarla en varios dispositivos.

Como requisitos previos necesitaremos node.js, express y ngrok.

## Iniciar la aplicación localmente

Para poder utilizar la aplicación desde el dispositivo donde se encuentra instalado debemos introducir lo siguiente en un terminal dentro del directorio del proyecto:
```
node server.js
```
Cuando lo ejecutemos recibiremos el siguiente mensaje:
```
Servidor corriendo en http://localhost:3000
```
Ahora al acceder a ese enlace podremos ejecutar localmente la aplicación. Se puede abrir varias veces el enlace para simular varios usuarios diferentes, cada uno en una pestaña nueva del navegador.

## Uso de ngrok para utilziar la aplicación en otros dispositivos.

Para probar la aplicación en diferentes dispositivos se utiliza ngrok. Podemos descargar la version de ejecutable standalone en https://ngrok.com/download/windows?tab=download.

Una vez descargado y extraído el zip necesitamos un token personal. Para ello, debemos registrarnos gratuitamente en la página web oficial de ngrok y obtener nuestro token en el apartado llamado
"Your Authtoken" (https://dashboard.ngrok.com/get-started/your-authtoken). Generamos un token si no tenemos uno ya y lo copiamos.

Entonces, abrimos el ejecutable que hemos descargado e introducimos el siguiente comando:
```
ngrok config add-authtoken $YOUR_AUTHTOKEN
```
siendo $YOUR_AUTHTOKEN el token que hemos obtenido.

Por último, con la aplicación ejecutandose localmente, introducimos este comando:
```
ngrok http 3000
```
Nótese que el puerto es el 3000, que es el mismo que utilizamos para abrir la aplicación localmente.
