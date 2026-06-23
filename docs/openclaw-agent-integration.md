# Guía De Integración OpenClaw Para Ritwal Precompro

Esta guía explica cómo debe usar un agente OpenClaw la API agéntica de Ritwal para consultar y gestionar reservas en Precompro.

## Endpoint De Producción

Base URL:

```text
https://ritwal-precompro-api.grupomistico.cloud
```

Salud del servicio:

```http
GET /health
```

Descubrimiento de herramientas:

```http
GET /tools/schema
```

La API está desplegada en Dokploy y llama a Precompro saliendo desde:

```text
2.24.77.242
```

## Modelo De Seguridad

OpenClaw debe llamar este middleware. No debe llamar Precompro directamente.

No entregar al agente `PRECOMPRO_API_KEY`. El agente solo necesita `TOOL_SECRET`.

Para cada request a `/tools/*`, enviar una de estas dos formas:

```http
x-tool-secret: <TOOL_SECRET>
```

o:

```http
Authorization: Bearer <TOOL_SECRET>
```

El middleware llama a Precompro por el lado del servidor usando `PRECOMPRO_API_KEY`.

## Ambiente Precompro Actual

El middleware está configurado para Precompro producción:

```text
Reservation:  https://servicereservation.precompro.com/api/ws
Availability: https://serviceavailability.precompro.com/api
Vendor:       https://servicevendor.precompro.com/api
Webservice:   https://servicewebservice.precompro.com/api
```

Documentación Precompro:

```text
https://documentation.precompro.com/
https://documentation.precompro.com/docs-json
```

## Herramientas A Registrar En OpenClaw

Registrar estas herramientas HTTP.

| Tool | Método | Path | Uso |
| --- | --- | --- | --- |
| `restaurant_profile` | `GET` | `/tools/restaurant/profile` | Leer perfil, horarios y secciones del restaurante. |
| `check_availability` | `POST` | `/tools/availability` | Consultar horarios disponibles. |
| `create_reservation` | `POST` | `/tools/reservations/create` | Crear reserva tras validar disponibilidad exacta. |
| `search_reservations` | `POST` | `/tools/reservations/search` | Buscar reservas activas por teléfono. |
| `list_reservations_by_date` | `POST` | `/tools/reservations/list-date` | Reporte solo lectura de reservas de una fecha. |
| `list_reservations_range` | `POST` | `/tools/reservations/list-range` | Reporte solo lectura de reservas de un rango. |
| `reservation_report` | `POST` | `/tools/reservations/report` | Reporte agregado sin nombres ni teléfonos por fecha, hora, estado, zona/sección, mesa, fuente y más. |
| `customer_lookup` | `POST` | `/tools/customers/lookup` | Buscar clientes internos por teléfono, email o nombre. Devuelve PII. |
| `customer_segment` | `POST` | `/tools/customers/segment` | Crear segmentos/base de clientes con PII, métricas y preferencias. |
| `customer_export` | `POST` | `/tools/customers/export` | Exportar segmentos de clientes en CSV para usar en otra herramienta. |
| `customer_demographics` | `POST` | `/tools/customers/demographics` | Reportar demografía agregada por país/código/localidad, sin PII por defecto. |
| `update_reservation` | `POST` | `/tools/reservations/update` | Modificar una reserva activa tras revalidar disponibilidad. |
| `cancel_reservation` | `POST` | `/tools/reservations/cancel` | Cancelar una reserva. |
| `confirm_reservation` | `POST` | `/tools/reservations/confirm` | Reconfirmar una reserva existente. Solo para flujos de recordatorio. |

Los schemas JSON completos están disponibles en:

```http
GET https://ritwal-precompro-api.grupomistico.cloud/tools/schema
```

## Headers Comunes

Para herramientas `GET`:

```http
accept: application/json
x-tool-secret: <TOOL_SECRET>
```

Para herramientas `POST`:

```http
accept: application/json
content-type: application/json
x-tool-secret: <TOOL_SECRET>
```

## Inputs Tolerantes Para Agentes

El middleware acepta JSON directo, query params, arrays de parámetros y wrappers comunes como:

```text
body
input
inputs
args
arguments
parameters
params
data
payload
toolInput
tool_payload
```

OpenClaw puede enviar JSON directo:

```json
{
  "date": "mañana",
  "time": "7pm",
  "partySize": "2"
}
```

El middleware normaliza:

| Input humano | Significado normalizado |
| --- | --- |
| `hoy` | Fecha de hoy en `America/Bogota` |
| `mañana` / `manana` | Fecha de mañana en `America/Bogota` |
| `pasado mañana` | Fecha de pasado mañana |
| `3pm` | `15:00` |
| `"5"` | `5` |
| `zone: 0` | Sin zona específica |

## Contrato De Respuesta

Todas las herramientas devuelven JSON con:

```json
{
  "ok": true,
  "code": "SOME_CODE",
  "message": "Mensaje seguro para mostrar o adaptar"
}
```

o:

```json
{
  "ok": false,
  "code": "SOME_ERROR_CODE",
  "message": "Mensaje seguro para mostrar o adaptar",
  "details": {}
}
```

El agente debe tomar decisiones usando `ok` y `code`.

No mostrar `details` al cliente. Usar `message` y campos estructurados como `slots`, `reservations` o `alternatives`.

## Detalle De Herramientas

### `restaurant_profile`

Usar cuando el agente necesite datos oficiales del restaurante o sus zonas/secciones.

Request:

```http
GET /tools/restaurant/profile
```

Ejemplo:

```sh
curl -H "x-tool-secret: $TOOL_SECRET" \
  https://ritwal-precompro-api.grupomistico.cloud/tools/restaurant/profile
```

Uso esperado:

- Leer timezone del restaurante.
- Leer secciones/zonas reales.
- Evitar inventar horarios, zonas o políticas.

### `check_availability`

Usar antes de ofrecer horarios específicos y siempre antes de crear o modificar una reserva.

Request:

```http
POST /tools/availability
```

Input:

```json
{
  "date": "mañana",
  "time": "7pm",
  "partySize": "2",
  "zone": {
    "id": 1442,
    "name": "Salon"
  },
  "subzone": 0
}
```

Requeridos:

- `date`
- `partySize`

Opcionales:

- `time`
- `zone`
- `subzone`

Respuesta exitosa:

```json
{
  "ok": true,
  "code": "AVAILABILITY_FOUND",
  "message": "Encontré horarios disponibles.",
  "date": "2026-06-24",
  "requestedTime": "19:00",
  "exactTimeAvailable": false,
  "partySize": 2,
  "availableCount": 15,
  "slots": [
    {
      "epochMs": 1782320400000,
      "dateTime": "2026-06-24 12:00:00",
      "time": "12:00",
      "available": true,
      "validation": "checkDefault",
      "paymentInfo": null
    }
  ]
}
```

Comportamiento del agente:

- Si `exactTimeAvailable` es `true`, puede decir que la hora pedida está disponible.
- Si `exactTimeAvailable` es `false`, no debe decir que la hora pedida está disponible. Debe ofrecer 2-4 alternativas desde `slots`.
- Si `availableCount` es `0`, pedir otra fecha/hora o escalar con una frase humana.
- Si un slot trae `paymentInfo`, conservarlo. El middleware lo usará al crear la reserva.

### `create_reservation`

Usar solo después de reunir los datos requeridos y confirmar con el cliente.

Request:

```http
POST /tools/reservations/create
```

Input:

```json
{
  "displayName": "Maria Perez",
  "phone": "3142360112",
  "countryCode": 57,
  "email": "maria@example.com",
  "date": "2026-06-24",
  "time": "12:00",
  "partySize": 2,
  "comments": "Mesa tranquila",
  "allergies": "mani",
  "occasion": "cumpleaños",
  "requirements": "silla de bebe",
  "partyComposition": "2 adultos",
  "idempotencyKey": "openclaw-conversation-id-step-id"
}
```

Requeridos:

- `displayName`
- `phone`
- `date`
- `time`
- `partySize`

Opcionales:

- `countryCode`, por defecto `57`
- `email`
- `comments`
- `allergies`
- `occasion`
- `requirements`
- `pet`
- `preferredZoneName`
- `partyComposition`
- `birthday`
- `celebrationComment`
- `restaurantComment`
- `idempotencyKey`

Reglas de seguridad que aplica el middleware:

- Revalida disponibilidad exacta antes de llamar Precompro.
- Rechaza teléfonos inválidos.
- Rechaza grupos por encima del límite automático.
- Bloquea duplicados activos por teléfono + fecha/hora exacta.
- Usa locks e idempotencia para reducir dobles reservas.

Comportamiento del agente:

- Nunca llamar `create_reservation` si falta nombre, teléfono, fecha, hora o número de personas.
- Confirmar con el cliente antes de crear.
- No llamar `create_reservation` dos veces si una llamada previa sigue pendiente.
- Después de éxito, responder con resumen de fecha, hora, número de personas y nombre.
- No exponer IDs internos salvo que el flujo requiera elegir entre varias reservas.

### `search_reservations`

Usar cuando el cliente quiera consultar, modificar, cancelar o reconfirmar una reserva existente.

Request:

```http
POST /tools/reservations/search
```

Input:

```json
{
  "phone": "3142360112"
}
```

Comportamiento del agente:

- Si no hay reservas activas, pedir otro teléfono u ofrecer ayuda humana.
- Si hay una reserva activa, resumirla y continuar.
- Si hay varias reservas activas, pedir al cliente elegir por fecha y hora.

### `list_reservations_by_date`

Usar para preguntas internas o gerenciales sobre una fecha específica:

- "Cuántas reservas hubo el lunes?"
- "Cuántas personas trajo el 15 de junio?"
- "Muéstrame reservas canceladas de ayer."

Request:

```http
POST /tools/reservations/list-date
```

Input:

```json
{
  "date": "2026-06-15",
  "includeCancelled": true
}
```

Requerido:

- `date`

Opcional:

- `includeCancelled`, por defecto `true`

Respuesta relevante:

```json
{
  "ok": true,
  "code": "RESERVATIONS_BY_DATE_FOUND",
  "date": "2026-06-15",
  "summary": {
    "totalReservations": 10,
    "activeReservations": 8,
    "completedReservations": 7,
    "noShowReservations": 1,
    "pendingReservations": 0,
    "cancelledReservations": 2,
    "totalPeople": 34,
    "activePeople": 27,
    "completedPeople": 24,
    "noShowPeople": 3,
    "pendingPeople": 0,
    "cancelledPeople": 7,
    "statusCounts": {
      "Finalizada": 7,
      "No Llego": 1,
      "Cancelada": 2
    }
  },
  "reservations": []
}
```

Comportamiento del agente:

- Para "cuántas reservas hubo", responder con `summary.activeReservations`, salvo que pidan incluir canceladas.
- Para "cuántas personas trajo" o asistencia real, responder con `summary.completedPeople`.
- `summary.activePeople` significa personas en reservas no canceladas e incluye `No Llego`.
- Si el usuario pregunta por cancelaciones, usar `summary.cancelledReservations` y `summary.cancelledPeople`.
- Si el usuario pregunta por no-shows, usar `summary.noShowReservations` y `summary.noShowPeople`.
- Si necesita auditar, usar el arreglo `reservations`; si solo necesita totales, no listar nombres o teléfonos.

### `list_reservations_range`

Usar para preguntas internas o gerenciales por rango:

- "Cuántas reservas hubo la semana pasada de lunes a viernes?"
- "Cuántas personas trajo Ritwal del 15 al 19 de junio?"
- "Dame reservas por día de esta semana."

Request:

```http
POST /tools/reservations/list-range
```

Input:

```json
{
  "from": "2026-06-15",
  "to": "2026-06-19",
  "includeCancelled": true,
  "includeReservations": false
}
```

Requeridos:

- `from`
- `to`

Opcionales:

- `includeCancelled`, por defecto `true`
- `includeReservations`, por defecto `true`; usar `false` cuando solo se necesiten totales.

Respuesta relevante:

```json
{
  "ok": true,
  "code": "RESERVATIONS_RANGE_FOUND",
  "from": "2026-06-15",
  "to": "2026-06-19",
  "daysCount": 5,
  "summary": {
    "totalReservations": 42,
    "activeReservations": 35,
    "completedReservations": 30,
    "noShowReservations": 5,
    "pendingReservations": 0,
    "cancelledReservations": 7,
    "totalPeople": 126,
    "activePeople": 103,
    "completedPeople": 91,
    "noShowPeople": 12,
    "pendingPeople": 0,
    "cancelledPeople": 23
  },
  "days": [
    {
      "date": "2026-06-15",
      "summary": {
        "activeReservations": 8,
        "completedReservations": 7,
        "activePeople": 27,
        "completedPeople": 24
      }
    }
  ]
}
```

Comportamiento del agente:

- Convertir frases relativas a fechas exactas en `America/Bogota` antes de llamar. Ejemplo: si hoy es 2026-06-23, "semana pasada de lunes a viernes" es `from=2026-06-15`, `to=2026-06-19`.
- Para reservas no canceladas usar `summary.activeReservations`.
- Para asistencia o "personas que trajo" usar `summary.completedPeople`.
- Para no-shows usar `summary.noShowReservations` y `summary.noShowPeople`.
- Si el usuario pide desglose diario, leer `days[].summary`.
- Para reportes livianos usar `includeReservations=false`.
- El rango máximo es 31 días. Si el usuario pide más, dividir en rangos o pedir acotar.

### `reservation_report`

Usar para preguntas internas o gerenciales que pidan agregados, rankings o desglose por dimensión:

- "Reservas por hora de la semana pasada."
- "Personas que llegaron por zona."
- "No-shows por día y hora."
- "Canceladas por mesa o por usuario."
- "Qué día tuvo más personas finalizadas?"

Request:

```http
POST /tools/reservations/report
```

Input:

```json
{
  "from": "2026-06-15",
  "to": "2026-06-19",
  "includeCancelled": true,
  "groupBy": ["date", "hour", "lifecycle"],
  "filters": {
    "sectionName": "Salón"
  }
}
```

Requeridos:

- `from`
- `to`

Opcionales:

- `includeCancelled`, por defecto `true`
- `groupBy`, por defecto `["date"]`, máximo 4 dimensiones
- `filters`

Dimensiones permitidas en `groupBy`:

```text
date
weekday
hour
reservationHour
status
lifecycle
sectionName
tableName
partyBucket
source
provider
typeReservation
paymentType
createdBy
finishedBy
cancelledBy
noShowBy
```

Filtros principales:

```json
{
  "status": "Finalizada",
  "lifecycle": ["completed", "noShow"],
  "sectionName": "Salón",
  "tableName": "Mesa 1",
  "reservationHour": "20:00",
  "weekday": "viernes",
  "partyBucket": "5-8",
  "completed": true,
  "noShow": false,
  "cancelled": false,
  "minPartySize": 2,
  "maxPartySize": 8
}
```

Respuesta relevante:

```json
{
  "ok": true,
  "code": "RESERVATION_REPORT_READY",
  "summary": {
    "activeReservations": 243,
    "completedReservations": 217,
    "noShowReservations": 26,
    "cancelledReservations": 15,
    "completedPeople": 891,
    "noShowPeople": 99
  },
  "groups": [
    {
      "key": {
        "date": "2026-06-19",
        "hour": "20:00",
        "lifecycle": "completed"
      },
      "summary": {
        "completedReservations": 10,
        "completedPeople": 42
      }
    }
  ],
  "days": []
}
```

Comportamiento del agente:

- Usar esta herramienta cuando el usuario pida "por hora", "por zona", "por mesa", "por estado", "por fuente", "top", "ranking" o "comparar".
- No esperar nombres ni teléfonos en `reservation_report`; es intencionalmente agregado.
- Para comparar dos periodos, llamar `reservation_report` una vez por periodo y comparar `summary` o `groups`.
- Si `sectionName` aparece como `unknown`, explicar que Precompro no devolvió zona limpia para esas reservas.
- Para "fuente/origen", usar `source` o `provider` solo si vienen distintos de `unknown`.

### `customer_segment`

Usar solo para el agente interno/admin cuando pidan datos de clientes, bases o insumos para marketing. Esta herramienta devuelve PII.

Casos típicos:

- "Todos los clientes que reservaron y cancelaron."
- "Clientes con más de 10 reservas el último mes."
- "Clientes con no-shows."
- "Clientes frecuentes de Wine Garden."
- "Base CSV de clientes con email."

Request:

```http
POST /tools/customers/segment
```

Clientes que reservaron y cancelaron:

```json
{
  "from": "2026-06-01",
  "to": "2026-06-30",
  "criteria": {
    "minCancelledReservations": 1
  },
  "includeReservations": true,
  "outputFormat": "json",
  "limit": 100
}
```

Clientes con más de 10 reservas en el último mes:

```json
{
  "from": "2026-05-23",
  "to": "2026-06-23",
  "criteria": {
    "minTotalReservations": 11
  },
  "outputFormat": "json",
  "limit": 100
}
```

Export CSV:

```json
{
  "from": "2026-05-23",
  "to": "2026-06-23",
  "criteria": {
    "minTotalReservations": 11
  },
  "outputFormat": "csv",
  "limit": 5000
}
```

Clientes de un país reportado en Precompro:

```json
{
  "from": "2026-06-01",
  "to": "2026-06-30",
  "criteria": {
    "country": "Canada"
  },
  "outputFormat": "json",
  "limit": 100
}
```

Clientes internacionales:

```json
{
  "from": "2026-06-01",
  "to": "2026-06-30",
  "criteria": {
    "locality": "international"
  },
  "outputFormat": "csv",
  "limit": 5000
}
```

Campos clave de respuesta:

- `contact`: nombre, teléfonos, emails, documento, país y consentimiento asumido desde Precompro.
- `metrics`: reservas totales, finalizadas, canceladas, no-show, personas y tasas.
- `preferences`: días, horas, zonas/secciones, mesas, buckets de grupo, fuentes y ocasiones más frecuentes.
- `reservations`: historial resumido si `includeReservations=true`.
- `pagination.nextCursor`: usarlo para pedir la siguiente página.

Comportamiento del agente:

- No enviar campañas desde esta API. Solo entregar datos o CSV para que Ritwal lo use en otra herramienta.
- Si el usuario pide "base de datos", usar `customer_export` o `customer_segment` con `outputFormat="csv"`.
- Si pide "todos", usar páginas: `limit=5000` y repetir con `cursor=nextCursor`.
- Para "cancelaron", usar `criteria.minCancelledReservations=1`.
- Para "más de 10 reservas", usar `criteria.minTotalReservations=11`.
- Para país/nacionalidad reportada, usar `criteria.country`; `nationality` funciona como alias, pero no implica nacionalidad legal verificada.
- Para extranjeros vs Colombia, usar `criteria.locality` con `international`, `colombia` o `unknown`.
- Para "último mes", calcular fechas exactas en `America/Bogota`.

### `customer_demographics`

Usar para preguntas internas de demografía, país, visitantes extranjeros o "nacionalidades". Por defecto devuelve agregados sin nombres, teléfonos ni correos.

Importante: Precompro devuelve `country` y `countryCode` del contacto. El agente debe tratarlo como país/código reportado en Precompro, no como nacionalidad legal o pasaporte verificado.

Request:

```http
POST /tools/customers/demographics
```

Distribución por país:

```json
{
  "from": "2026-06-01",
  "to": "2026-06-30",
  "groupBy": ["country"]
}
```

Colombia vs internacionales:

```json
{
  "from": "2026-06-01",
  "to": "2026-06-30",
  "groupBy": ["locality"]
}
```

Clientes internacionales con datos incluidos:

```json
{
  "from": "2026-06-01",
  "to": "2026-06-30",
  "criteria": {
    "locality": "international"
  },
  "groupBy": ["country"],
  "includeCustomers": true,
  "includeReservations": false,
  "limit": 5000
}
```

Campos de respuesta:

- `summary.totalCustomers`: clientes únicos detectados en el rango.
- `summary.completedPeople`: personas asociadas a reservas finalizadas.
- `summary.topCountries`: ranking de países por clientes únicos.
- `summary.localityBreakdown`: `colombia`, `international` y `unknown`.
- `groups`: desglose por las dimensiones pedidas en `groupBy`.
- `demographicFieldNote`: recordatorio de que el dato viene de Precompro y no es nacionalidad legal.
- `customers`: solo aparece si `includeCustomers=true`; contiene PII y debe ser uso interno.

Dimensiones válidas en `groupBy`:

- `country`
- `countryCode`
- `nationality` alias de `country`
- `nationalityCode` alias de `countryCode`
- `locality`
- `marketingEligibility`

Comportamiento del agente:

- Para "qué nacionalidades nos visitan", llamar `customer_demographics` con `groupBy=["country"]`.
- Para "cuántos extranjeros", llamar `customer_demographics` con `groupBy=["locality"]`.
- Para "dame la base de canadienses", usar `customer_segment` o `customer_export` con `criteria.country="Canada"`.
- Al responder, decir "país reportado en Precompro" si el usuario pide precisión demográfica.

### `customer_lookup`

Usar para buscar un cliente o grupo pequeño por teléfono, email o nombre.

Request:

```http
POST /tools/customers/lookup
```

Input:

```json
{
  "phone": "+57 300 123 4567",
  "from": "2026-01-01",
  "to": "2026-06-23",
  "includeReservations": true
}
```

### `customer_export`

Alias orientado a CSV de `customer_segment`.

Request:

```http
POST /tools/customers/export
```

### `update_reservation`

Usar cuando el cliente quiera cambiar fecha, hora, número de personas, nombre, teléfono, correo o notas.

Request:

```http
POST /tools/reservations/update
```

Input:

```json
{
  "reservationId": "reservation-id-from-search",
  "phone": "3142360112",
  "date": "mañana",
  "time": "3pm",
  "partySize": 3,
  "comments": "Actualizar a 3 personas"
}
```

Requeridos:

- `reservationId`
- `phone`

Campos modificables:

- `displayName`
- `phoneNew`
- `countryCode`
- `email`
- `date`
- `time`
- `partySize`
- `comments`
- `allergies`
- `occasion`
- `requirements`
- `pet`
- `preferredZoneName`
- `partyComposition`

Comportamiento del agente:

- Buscar primero con `search_reservations`, salvo que tenga un `reservationId` confiable.
- Si cambia fecha, hora o número de personas, validar disponibilidad.
- Confirmar el cambio con el cliente antes de llamar la herramienta.

### `cancel_reservation`

Usar después de que el cliente confirme explícitamente que quiere cancelar.

Request:

```http
POST /tools/reservations/cancel
```

Input:

```json
{
  "reservationId": "reservation-id-from-search",
  "phone": "3142360112"
}
```

Requerido:

- `reservationId`

Opcional:

- `phone`

Comportamiento del agente:

- Buscar primero con `search_reservations`, salvo que tenga un `reservationId` confiable.
- Pedir confirmación explícita: "¿Confirmas que quieres cancelar la reserva de [fecha] a las [hora]?"
- Tratar la cancelación como idempotente. Si ya estaba cancelada, responder con calma.

### `confirm_reservation`

Reservada para flujos de recordatorio/reconfirmación.

Request:

```http
POST /tools/reservations/confirm
```

Input:

```json
{
  "reservationId": "reservation-id-from-search",
  "phone": "3142360112"
}
```

Comportamiento del agente:

- No llamar automáticamente después de `create_reservation`.
- Usar solo cuando el cliente esté reconfirmando una reserva existente.

## Prompt Recomendado Para OpenClaw

Usar este bloque en las instrucciones del agente:

```text
Eres el frontdesk digital de Ritwal.

Usa las herramientas del middleware para reservas. Nunca inventes disponibilidad, horarios, reservas o cancelaciones.

Antes de decir que un horario está disponible, llama check_availability.
Antes de crear una reserva, reúne nombre, teléfono, fecha, hora exacta y número de personas, confirma con el cliente y llama create_reservation.
Antes de modificar o cancelar, busca la reserva por teléfono con search_reservations. Si hay varias, pide al cliente elegir por fecha y hora.
Para preguntas internas de reportes, reservas pasadas, conteos por fecha o "personas que trajo", calcula el rango exacto en America/Bogota. Usa list_reservations_by_date para una fecha, list_reservations_range para un rango simple y reservation_report para desgloses por hora, zona, mesa, estado, fuente, rankings o comparativos. Usa activeReservations para reservas no canceladas y completedPeople para personas que realmente llegaron; no cuentes No Llego como asistencia.
Para preguntas internas de clientes, bases de datos, nombres, teléfonos, correos o segmentos de marketing, usa customer_lookup, customer_segment o customer_export. Estas herramientas solo preparan datos; no envían campañas ni mensajes.
Para preguntas internas de demografía, país, visitantes extranjeros o "nacionalidades", usa customer_demographics. Interpreta country/countryCode como país/código reportado en Precompro, no como nacionalidad legal verificada. Para bases con PII por país, usa customer_segment o customer_export con criteria.country.

No menciones Precompro, middleware, API, errores técnicos, status codes ni tokens al cliente.
Si una herramienta falla o tarda, responde de forma humana: "Déjame validarlo con el equipo de Ritwal y te confirmamos en un momento." Luego escala a humano.

Para grupos de 19 o más personas, eventos, privados, alergias severas, solicitudes VIP o casos sensibles, escala a humano.

Si check_availability devuelve exactTimeAvailable=false, no digas que la hora pedida está disponible. Ofrece alternativas reales del arreglo slots.

Mantén el tono cálido, claro y conciso. Confirma siempre fecha, hora, número de personas y teléfono antes de crear, modificar o cancelar.
```

## Flujos Recomendados

### Flujo De Disponibilidad

1. El cliente pide una fecha/hora/número de personas.
2. Si falta fecha o número de personas, pedir el dato faltante.
3. Llamar `check_availability`.
4. Si la hora exacta está disponible, ofrecerla.
5. Si no está disponible, ofrecer alternativas desde `slots`.
6. Si el cliente escoge un slot, pedir nombre y teléfono antes de crear.

### Flujo De Creación

1. Pedir `displayName`.
2. Pedir `phone`.
3. Pedir `date`.
4. Pedir `time`.
5. Pedir `partySize`.
6. Opcionalmente pedir solicitudes especiales.
7. Confirmar con el cliente.
8. Llamar `create_reservation`.
9. Responder con resumen de confirmación.

### Flujo De Modificación

1. Pedir teléfono si no se tiene.
2. Llamar `search_reservations`.
3. Si hay varias reservas, pedir cuál quiere modificar.
4. Pedir el cambio deseado.
5. Confirmar con el cliente.
6. Llamar `update_reservation`.
7. Responder con resumen actualizado.

### Flujo De Cancelación

1. Pedir teléfono si no se tiene.
2. Llamar `search_reservations`.
3. Si hay varias reservas, pedir cuál quiere cancelar.
4. Pedir confirmación explícita de cancelación.
5. Llamar `cancel_reservation`.
6. Responder con confirmación de cancelación.

### Flujo De Reporte Por Fechas

1. Identificar si el usuario pide una fecha única o un rango.
2. Convertir frases relativas a fechas exactas en `America/Bogota`.
3. Si es una fecha simple, llamar `list_reservations_by_date`.
4. Si es un rango simple, llamar `list_reservations_range`.
5. Si pide "por hora", "por zona", "por mesa", "por estado", "top", "ranking" o "comparar", llamar `reservation_report`.
6. Para "reservas hubo" usar `summary.activeReservations`.
7. Para "personas trajo" usar `summary.completedPeople`.
8. Si piden no-shows, sumar o mostrar `summary.noShowReservations` y `summary.noShowPeople`.
9. Si piden canceladas, sumar o mostrar `summary.cancelledReservations` y `summary.cancelledPeople`.
10. Si piden desglose por día, usar `days[].summary`.

### Flujo De Reporte Agregado

1. Calcular `from` y `to` exactos.
2. Elegir `groupBy` según la pregunta:
   - Por hora: `["hour"]`
   - Por día y hora: `["date", "hour"]`
   - Por zona/sección: `["sectionName"]`
   - Por estado operativo: `["lifecycle"]`
   - Por mesa: `["tableName"]`
3. Agregar `filters` si el usuario acota por zona, hora, estado o tamaño de grupo.
4. Llamar `reservation_report`.
5. Responder desde `summary` para totales y desde `groups` para desgloses.
6. Para comparativos, repetir la llamada para cada periodo y comparar las mismas métricas.

### Flujo De Segmentación De Clientes

1. Confirmar que es una solicitud interna/admin.
2. Calcular `from` y `to` exactos.
3. Convertir la intención en `criteria`.
4. Si pide datos en pantalla, llamar `customer_segment` con `outputFormat="json"`.
5. Si pide base, lista o CSV, llamar `customer_export`.
6. Si `pagination.nextCursor` viene con valor, avisar que hay más páginas o pedir la siguiente página automáticamente si el usuario pidió "todos".
7. No intentar enviar campañas desde esta API.

### Flujo De Demografía De Clientes

1. Confirmar que es una solicitud interna/admin.
2. Calcular `from` y `to` exactos.
3. Para países o "nacionalidades", llamar `customer_demographics` con `groupBy=["country"]`.
4. Para Colombia vs extranjeros, llamar `customer_demographics` con `groupBy=["locality"]`.
5. Para filtrar un país, usar `criteria.country`, por ejemplo `"Canada"`.
6. Responder con agregados de `summary` y `groups`; no pedir PII salvo que el usuario pida una base.
7. Aclarar que es país reportado en Precompro si el usuario pide precisión de nacionalidad.

## Manejo De Errores

| Código/patrón | Respuesta del agente |
| --- | --- |
| `VALIDATION_ERROR` | Pedir el dato faltante o inválido en lenguaje normal. |
| `NO_AVAILABILITY` / `SLOT_NOT_AVAILABLE` | Ofrecer alternativas si existen. |
| `DUPLICATE_RESERVATION` | Decir que ya existe una reserva para ese teléfono/fecha/hora y preguntar si desea modificarla. |
| `ESCALATE_LARGE_PARTY` | Escalar a humano. |
| `REQUEST_IN_PROGRESS` | Pedir esperar un momento. No reintentar creación inmediatamente. |
| `PRECOMPRO_HTTP_ERROR` / timeout / error desconocido | No mencionar sistemas. Escalar o decir que Ritwal confirmará en un momento. |

## Comandos De Prueba

Health:

```sh
curl https://ritwal-precompro-api.grupomistico.cloud/health
```

Schema:

```sh
curl -H "x-tool-secret: $TOOL_SECRET" \
  https://ritwal-precompro-api.grupomistico.cloud/tools/schema
```

Disponibilidad, solo lectura:

```sh
curl -H "x-tool-secret: $TOOL_SECRET" \
  -H "content-type: application/json" \
  -d '{"date":"mañana","partySize":2,"time":"7pm"}' \
  https://ritwal-precompro-api.grupomistico.cloud/tools/availability
```

Reporte de reservas por rango, solo lectura:

```sh
curl -H "x-tool-secret: $TOOL_SECRET" \
  -H "content-type: application/json" \
  -d '{"from":"2026-06-15","to":"2026-06-19","includeCancelled":true,"includeReservations":false}' \
  https://ritwal-precompro-api.grupomistico.cloud/tools/reservations/list-range
```

Reporte agregado por hora y estado, sin PII:

```sh
curl -H "x-tool-secret: $TOOL_SECRET" \
  -H "content-type: application/json" \
  -d '{"from":"2026-06-15","to":"2026-06-19","groupBy":["date","hour","lifecycle"],"includeCancelled":true}' \
  https://ritwal-precompro-api.grupomistico.cloud/tools/reservations/report
```

Segmento de clientes que cancelaron, con PII:

```sh
curl -H "x-tool-secret: $TOOL_SECRET" \
  -H "content-type: application/json" \
  -d '{"from":"2026-06-01","to":"2026-06-30","criteria":{"minCancelledReservations":1},"includeReservations":true,"limit":100}' \
  https://ritwal-precompro-api.grupomistico.cloud/tools/customers/segment
```

Export CSV de clientes frecuentes:

```sh
curl -H "x-tool-secret: $TOOL_SECRET" \
  -H "content-type: application/json" \
  -d '{"from":"2026-05-23","to":"2026-06-23","criteria":{"minTotalReservations":11},"limit":5000}' \
  https://ritwal-precompro-api.grupomistico.cloud/tools/customers/export
```

Demografía por país, sin PII:

```sh
curl -H "x-tool-secret: $TOOL_SECRET" \
  -H "content-type: application/json" \
  -d '{"from":"2026-06-01","to":"2026-06-30","groupBy":["country"]}' \
  https://ritwal-precompro-api.grupomistico.cloud/tools/customers/demographics
```

Clientes internacionales para base interna:

```sh
curl -H "x-tool-secret: $TOOL_SECRET" \
  -H "content-type: application/json" \
  -d '{"from":"2026-06-01","to":"2026-06-30","criteria":{"locality":"international"},"groupBy":["country"],"includeCustomers":true,"limit":5000}' \
  https://ritwal-precompro-api.grupomistico.cloud/tools/customers/demographics
```

Diagnóstico:

```sh
curl -H "x-tool-secret: $TOOL_SECRET" \
  https://ritwal-precompro-api.grupomistico.cloud/tools/diagnostics/precompro
```

Diagnóstico saludable esperado:

```json
{
  "ok": true,
  "egressIp": "2.24.77.242",
  "precompro": {
    "vendorId": "...",
    "apiKeyFingerprint": "...",
    "reservationBase": "https://servicereservation.precompro.com/api/ws",
    "availabilityBase": "https://serviceavailability.precompro.com/api",
    "vendorBase": "https://servicevendor.precompro.com/api",
    "webserviceBase": "https://servicewebservice.precompro.com/api"
  }
}
```

## Checklist Operativo

Antes de activar OpenClaw en producción:

1. `GET /health` devuelve `ok: true`.
2. `GET /tools/schema` funciona con `TOOL_SECRET`.
3. `GET /tools/diagnostics/precompro` devuelve `ok: true`.
4. `check_availability` devuelve slots reales.
5. El prompt del agente dice que no debe inventar disponibilidad.
6. El prompt del agente dice que no debe exponer errores técnicos.
7. Herramientas de escritura quedan activas solo cuando el equipo acepte reservas live.
8. Existe una ruta de escalamiento humano para fallos y casos especiales.

## No Hacer

- No poner `PRECOMPRO_API_KEY` en prompts, memoria, logs o config de OpenClaw.
- No llamar Precompro directamente desde el agente.
- No crear reserva sin fecha exacta, hora exacta, número de personas, nombre y teléfono.
- No reintentar `create_reservation` a ciegas después de timeout.
- No decir que una hora está disponible salvo que `check_availability` la haya devuelto.
- No usar `confirm_reservation` inmediatamente después de crear una reserva.
