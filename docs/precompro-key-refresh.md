# Rotación segura de la API key Precompro

El job vive en la aplicación **Ritwal Precompro API**, proyecto **Ritwal Precompro**, entorno **production** de Dokploy. No depende de OpenClaw ni del Mac.

## Plazo y schedules

Se renueva cuando han transcurrido **20 días completos desde la última renovación/adopción confirmada**, no el día 20 o 21 de cada mes. El cron diario corre a las 04:00, zona America/Bogota; puede ejecutar la renovación algunas horas después de cumplir el plazo.

- Renovación: `0 4 * * *`, `npm run precompro:refresh-key -- --skip-diagnostics`.
- Comprobación y recuperación: `*/15 * * * *`, `npm run precompro:verify-key`.

El segundo job **nunca pide una clave nueva**. Revisa Dokploy y la integración; si ya existe una clave recibida en el diario, puede terminar su guardado y redeploy. El flag histórico `--skip-diagnostics` se acepta por compatibilidad: ya no se espera al redeploy dentro del proceso que va a ser reemplazado. La comprobación posterior es separada.

## Orden seguro

1. Validar fecha/intervalo, credenciales de lectura de Dokploy y volumen persistente.
2. Tomar un bloqueo del sistema operativo (`flock`) compartido entre contenedores.
3. Si toca renovar, probar el permiso de guardar el entorno de Dokploy **antes** de invalidar la clave actual.
4. Escribir y sincronizar a disco el estado `refresh_requested` antes de llamar una sola vez a `/refresh`.
5. Escribir de forma atómica y sincronizar a disco la clave recibida (`key_received`) **antes** de cualquier otra llamada a Dokploy.
6. Guardar el entorno conservando variables, comentarios, buildArgs, buildSecrets y createEnvFile. Reintentar únicamente este guardado idempotente, hasta tres veces, y leerlo de vuelta.
7. Registrar `redeploy_requested` antes de encolar el redeploy.
8. El verificador confirma restaurante y disponibilidad con la aplicación ya desplegada; solo entonces registra `verified`.

Si hay un timeout, respuesta ilegible, un 5xx o falta la clave en la respuesta de /refresh, el resultado es **desconocido**: el diario bloquea otra renovación. No existe una garantía absoluta si el proveedor rota y la respuesta se pierde antes de llegar. No volver a llamar /refresh a ciegas; recuperar la clave con Precompro.

## Configuración

Variables requeridas: `PRECOMPRO_API_KEY`, `PRECOMPRO_WEBSERVICE_BASE`, `PRECOMPRO_API_KEY_REFRESHED_AT` (ISO válido, no futuro), `PRECOMPRO_REFRESH_INTERVAL_DAYS=20`, `DOKPLOY_BASE_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_APPLICATION_ID`, `PUBLIC_MIDDLEWARE_URL`, `TOOL_SECRET`.

Volumen Dokploy: `ritwal-precompro-key-state`, montado en `/var/lib/precompro-key-refresh`. Variable `PRECOMPRO_REFRESH_STATE_DIR` con esa misma ruta. Se comprueba que sea un mount real de Linux; si falta, está lleno, no se puede escribir/sincronizar o no existe flock, se aborta antes de renovar. Timeout configurable `PRECOMPRO_REFRESH_TIMEOUT_MS`: 20 segundos por defecto.

El diario privado es `rotation.json`; `history/<rotationId>.json` mantiene un respaldo por operación. Directorios 0700, archivos 0600, fuera del repositorio y del servidor HTTP. Contienen credenciales: no publicarlos, pegarlos en chats, logs o tickets. Incluir el volumen en los backups seguros del servidor; un volumen persistente por sí solo no protege contra pérdida de todo el servidor.

No entregar estas credenciales a OpenClaw ni exponer /refresh como herramienta del agente. No guardar claves en commits o documentación. La adopción manual reinicia nuestro contador; no cambia ni extiende la vigencia real de una clave ya emitida por Precompro.

## Recuperación

- `key_received` / `env_saved`: ejecutar el verificador; reutiliza la clave guardada, no rota otra.
- `redeploy_requested`: esperar a que la aplicación use la clave guardada; si no sucede en 20 minutos, revisar el despliegue. No forzar otra renovación.
- `refresh_requested`: resultado desconocido. Detenerse y recuperar la clave con el proveedor. No editar ni borrar el diario para eludir la protección.
- Clave confirmada obtenida manualmente: respaldar el entorno, instalarla por Dokploy con fecha de adopción y `PRECOMPRO_API_KEY_REFRESH_SOURCE=manual-confirmed`, redeployar y comprobar que funciona. Entonces ejecutar dentro del contenedor `npm run precompro:refresh-key -- --adopt-current` para reconciliar el diario conservando su historial.
- Diagnóstico fallido: no significa que haya que renovar. Revisar credenciales, permisos, allowlist de IP, red y despliegue.

`--dry-run` consulta sin guardar/renovar. `--force` fuerza el plazo, pero no elude la validación, el volumen, el bloqueo ni un resultado desconocido. `--skip-redeploy` guarda sin encolar despliegue: usar solo conscientemente y completar luego.

## Incidente y adopción del 6 de octubre de 2026

El flujo anterior pedía /refresh antes de comprobar Dokploy y no respaldaba la respuesta. Una credencial de Dokploy inválida dejó la renovación sin guardado recuperable. La clave vigente suministrada por Helena fue **adoptada manualmente**, no generada por este cambio, con fecha base `2026-10-06T15:51:08.498Z` (10:51 Colombia). El siguiente intento diario elegible es el **27 de octubre a las 04:00 Colombia**, si se mantiene esta fecha base y no hay una renovación/adopción intermedia. No confundir esta fecha de adopción con una fecha de emisión del proveedor.

Las pruebas automatizadas simulan fallos de autenticación/escritura, timeout, respuesta ambigua, recuperación, drift de claves, redeploy y permisos. No llaman /refresh real. Los logs del job solo contienen estados e identificadores, nunca claves completas.

## Alertas y límites

Los fallos salen con código no cero y quedan en los despliegues/logs de schedules de Dokploy. El verificador detecta problemas cada 15 minutos; esto no equivale a una notificación externa garantizada. Revisar canales de notificación y backups del servidor por separado. No registrar secretos ni conceder permisos nuevos para crear alertas sin aprobación.
