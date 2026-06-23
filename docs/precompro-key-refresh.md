# Rotación Automática De API Key Precompro

Precompro requiere refrescar la API key de Ritwal cada 20 días. Este proceso no debe depender de OpenClaw ni del Mac mini.

## Diseño

El refresh vive en el mismo repo, pero como job separado del servidor HTTP:

```text
scripts/refresh-precompro-key.mjs
```

Comando:

```sh
npm run precompro:refresh-key
```

El job:

1. Revisa `PRECOMPRO_API_KEY_REFRESHED_AT`.
2. Si han pasado menos de `PRECOMPRO_REFRESH_INTERVAL_DAYS`, sale sin hacer nada.
3. Si ya toca refresh, llama:

```http
GET https://servicewebservice.precompro.com/api/refresh
apiKey: <PRECOMPRO_API_KEY_ACTUAL>
```

4. Lee `apiKey` de la respuesta de Precompro.
5. Actualiza `PRECOMPRO_API_KEY` en el env de la app Dokploy.
6. Actualiza `PRECOMPRO_API_KEY_REFRESHED_AT`.
7. Encola redeploy de la API.
8. Opcionalmente espera el redeploy y corre `/tools/diagnostics/precompro`.

## Variables Requeridas

Estas variables deben existir en Dokploy:

```text
PRECOMPRO_API_KEY
PRECOMPRO_WEBSERVICE_BASE=https://servicewebservice.precompro.com/api
PRECOMPRO_API_KEY_REFRESHED_AT=<ISO date>
PRECOMPRO_REFRESH_INTERVAL_DAYS=20
DOKPLOY_BASE_URL=https://grupomistico.cloud/api
DOKPLOY_API_KEY=<secret>
DOKPLOY_APPLICATION_ID=FFR0FNIFiNvdEKv7cpq-a
PUBLIC_MIDDLEWARE_URL=https://ritwal-precompro-api.grupomistico.cloud
TOOL_SECRET=<secret>
```

`DOKPLOY_API_KEY` permite que el job actualice las variables de la propia app y encole el redeploy.

## Schedule Recomendado En Dokploy

Crear un schedule tipo `application` que corra diariamente a las 4am Colombia:

```text
0 4 * * *
```

Comando:

```sh
npm run precompro:refresh-key -- --skip-diagnostics
```

El schedule puede correr a diario porque el script solo rota cuando han pasado `PRECOMPRO_REFRESH_INTERVAL_DAYS`.

Usamos `--skip-diagnostics` para evitar que el job se quede esperando mientras redeploya la misma aplicación desde donde corre. El diagnóstico puede verificarse con:

```sh
curl -H "x-tool-secret: $TOOL_SECRET" \
  https://ritwal-precompro-api.grupomistico.cloud/tools/diagnostics/precompro
```

## Comandos Manuales

Verificar si ya toca, sin rotar:

```sh
npm run precompro:refresh-key -- --dry-run
```

Forzar refresh manual:

```sh
npm run precompro:refresh-key -- --force --skip-diagnostics
```

Forzar refresh y saltar redeploy:

```sh
npm run precompro:refresh-key -- --force --skip-redeploy
```

## Seguridad

- No entregar `PRECOMPRO_API_KEY` a OpenClaw.
- No entregar `DOKPLOY_API_KEY` a OpenClaw.
- No ejecutar `/refresh` desde una herramienta de agente.
- No guardar keys rotadas en commits ni documentación.
- El job solo imprime fingerprints, nunca tokens completos.
