# Guía de uso de la aplicacion

Esta guía servirá como ayuda para iniciar correctamente la aplicación y para poder probarla en varios dispositivos.

Como requisitos necesitaremos node.js, express y ngrok.

## Iniciar la aplicación localmente

Una vez tengamos node.js vamos a necesitar express.

Para descargar express se puede hacer ejecutando este comando por consola:
```
npm install express
```

Para poder utilizar la aplicación desde el dispositivo donde se encuentra instalado debemos introducir lo siguiente en un terminal dentro del directorio del proyecto:
```
node server.js
```
Cuando lo ejecutemos recibiremos el siguiente mensaje:
```
Servidor corriendo en http://localhost:3000
```
Ahora al acceder a ese enlace podremos ejecutar localmente la aplicación. Se puede abrir varias veces el enlace para simular varios usuarios diferentes, cada uno en una pestaña nueva del navegador.

## Uso de ngrok para utilizar la aplicación en otros dispositivos.

Para probar la aplicación en diferentes dispositivos se utiliza ngrok. Podemos descargar la version de ejecutable standalone en https://ngrok.com/download/windows?tab=download. Alternativamente, también se puede descargar mediante el siguiente comando:
```
winget install ngrok -s msstore
```

Una vez descargado necesitamos un token personal. Para ello, debemos registrarnos gratuitamente en la página web oficial de ngrok y obtener nuestro token en el apartado llamado
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
*Nótese que el puerto es el 3000, que es el mismo que utilizamos para abrir la aplicación localmente.*

Ngrok nos generará un enlace, que es el que usaremos para abrir la aplicación desde otros dispositivos. Para acceder desde el mismo dispositivo seguimos usando localhost.

## Gestos y comandos de voz disponibles

### Comandos de voz (solo presentador)

| Acción | Comando |
|---|---|
| Iniciar presentación | "Iniciar presentación" |
| Finalizar presentación | "Finalizar presentación" |
| Activar cámara | "Activar cámara" |
| Desactivar cámara | "Desactivar cámara" |
| Activar modo dibujo | "Dibujar" |
| Desactivar modo dibujo | "Desactivar dibujar" |
| Activar subtítulos | "Activar subtítulos/subtitulos" |
| Desactivar subtítulos | "Desactivar subtítulos/subtitulos" |
| Borrar dibujos | "Borrar" / "Limpiar" |
| Lanzar encuesta | "Lanzar encuesta [pregunta]" |
| Añadir primera opción | "Opciones [A/1] [respuesta]" |
| Añadir siguientes opciones | "[B/2] [respuesta]", "[C/3] [respuesta]"... |
| Cerrar encuesta | "Finalizar encuesta" |
| Avanzar diapositiva | "Siguiente / Avanzar diapositiva" |
| Retroceder diapositiva | "Anterior / Retroceder diapositiva" |

### Gestos del presentador

| Acción | Gesto |
|---|---|
| Avanzar diapositiva | Mover dedo índice hacia la derecha |
| Retroceder diapositiva | Mover dedo índice hacia la izquierda |
| Dibujar | Mover dedo índice sobre la pantalla con el modo dibujo activo |
| Zoom in | Pellizco hacia fuera con pulgar e índice |
| Quitar zoom | Cerrar el puño |

### Gestos del espectador

| Acción | Gesto |
|---|---|
| Levantar la mano para turno de palabra | Mostrar la palma abierta hacia la cámara |
| Responder encuesta | Levantar el número de dedos correspondiente a la opción (1 dedo = A, 2 dedos = B, 3 dedos = C...) |