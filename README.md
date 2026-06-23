# Ritwal Precompro Agentic API

Middleware HTTP para que agentes como OpenClaw consulten y gestionen reservas de Ritwal en Precompro sin exponer la credencial de Precompro al agente.

## Runtime

- `GET /health`: salud básica.
- `GET /`: discovery humano/agent-friendly.
- `GET /tools/schema`: contratos JSON de herramientas.
- `GET /tools/restaurant/profile`: perfil y secciones del restaurante.
- `POST /tools/availability`: consulta disponibilidad.
- `POST /tools/reservations/create`: crea reserva tras validar disponibilidad exacta.
- `POST /tools/reservations/search`: busca reservas activas por teléfono.
- `POST /tools/reservations/list-date`: reporte solo lectura de reservas por fecha.
- `POST /tools/reservations/list-range`: reporte solo lectura de reservas por rango, máximo 31 días.
- `POST /tools/reservations/report`: reporte agregado sin PII por fecha, hora, estado, zona/sección, mesa, fuente y otras dimensiones.
- `POST /tools/customers/lookup`: búsqueda interna de clientes por teléfono, email o nombre.
- `POST /tools/customers/segment`: segmentación interna de clientes con PII para insumos de marketing.
- `POST /tools/customers/export`: export CSV paginado de segmentos de clientes.
- `POST /tools/customers/demographics`: demografía interna agregada por país/código/localidad, sin PII por defecto.
- `POST /tools/reservations/update`: modifica reserva tras validar disponibilidad.
- `POST /tools/reservations/cancel`: cancela reserva.
- `POST /tools/reservations/confirm`: reconfirma reserva.
- `GET /tools/diagnostics/precompro`: diagnóstico protegido de IP de salida, bases y estado Precompro.

## OpenClaw

La guía completa para conectar un agente OpenClaw está en:

```text
docs/openclaw-agent-integration.md
```

La rotación automática de la API key de Precompro está documentada en:

```text
docs/precompro-key-refresh.md
```

## Agent Auth

Los endpoints `/tools/*` aceptan:

- `x-tool-secret: <TOOL_SECRET>`
- `Authorization: Bearer <TOOL_SECRET>`

El agente nunca debe llamar Precompro directamente ni conocer `PRECOMPRO_API_KEY`.

## Precompro

- Sandbox/staging: `*.precompro.co`
- Producción: `*.precompro.com`
- Header hacia Precompro: `apiKey`
- Las bases son configurables con `PRECOMPRO_*_BASE`.

## Agent-Friendly Payloads

El middleware normaliza JSON directo, query params, arrays de parámetros y wrappers comunes como `body`, `input`, `args`, `parameters`, `payload`, `toolInput` y `tool_payload`.

También normaliza entradas humanas frecuentes:

- `hoy`, `mañana`, `manana`, `pasado mañana`
- `3pm` a `15:00`
- `"5"` a `5`
- `zone: 0` u omitir zona para consultar disponibilidad sin zona específica

## Safety Rules

- Siempre valida disponibilidad antes de crear o actualizar.
- Bloquea duplicados activos por teléfono + fecha/hora.
- Usa locks e idempotencia para evitar reservas dobles.
- Escala grupos de 19+ personas.
- No expone mensajes técnicos de Precompro al agente.
- Los reportes agregados no exponen nombres ni teléfonos.
- Las herramientas `/tools/customers/*` sí devuelven PII y son solo para agente interno/admin.
- `confirm_reservation` queda reservado para recordatorios/reconfirmaciones, no se llama automáticamente después de crear.
