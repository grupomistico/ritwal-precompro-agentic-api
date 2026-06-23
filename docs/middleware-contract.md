# Ritwal Convocore Middleware Contract

Base path: local/dev server or deployed middleware URL.

Authentication for Convocore tools:

- Header: `x-tool-secret: <TOOL_SECRET>`
- Alternative: `Authorization: Bearer <TOOL_SECRET>`

The middleware owns all Precompro safety rules. Convocore must not call Precompro directly.

The server listens on `0.0.0.0` in local/dev mode so it can be exposed by the
sandbox tunnel during tests.

Tool payloads can arrive as a direct JSON body, a Convocore parameter array,
query parameters, or wrapped by the calling runtime under `body`, `input`,
`inputs`, `args`, `arguments`, `parameters`, `params`, `data`, `payload`,
`toolInput`, or Convocore's runtime `tool_payload`. The middleware normalizes those shapes before validation so
Convocore can call tools reliably from chat, WhatsApp or the runtime worker.

## Endpoints

### `POST /tools/availability`

Input:

```json
{
  "date": "mañana",
  "time": "3pm",
  "partySize": "2",
  "zone": { "id": 1442, "name": "Salon" }
}
```

Returned slots include available times. `time` is optional for availability; when
present, the middleware normalizes it and returns whether that exact time appears
available. This lets the agent ask Precompro with natural WhatsApp inputs without
failing before the API call.

Accepted convenience inputs from tool callers:

- `date`: strict `YYYY-MM-DD`, `hoy`, `mañana`/`manana`, or `pasado mañana`.
- `time`: strict `HH:mm` or simple AM/PM forms like `3pm`.
- `partySize`: number or numeric string.
- `zone`: omit, `0`, a section id, a section name, or `{ "id": 1442, "name": "Salón" }`.

Output:

```json
{
  "ok": true,
  "code": "AVAILABILITY_FOUND",
  "date": "2026-05-16",
  "requestedTime": "15:00",
  "exactTimeAvailable": true,
  "availableCount": 14,
  "slots": [
    {
      "epochMs": 1778086800000,
      "dateTime": "2026-05-06 12:00:00",
      "time": "12:00",
      "available": true,
      "validation": "checkDefault",
      "paymentInfo": null
    }
  ]
}
```

### `POST /tools/reservations/create`

Input:

```json
{
  "displayName": "Maria Perez",
  "phone": "3142360112",
  "countryCode": 57,
  "email": "maria@example.com",
  "date": "2026-05-06",
  "time": "12:00",
  "partySize": 2,
  "zone": { "id": 1442, "name": "Salon" },
  "comments": "Mesa tranquila",
  "allergies": "mani",
  "occasion": "cumpleanos",
  "requirements": "silla de bebe",
  "partyComposition": "2 adultos, 1 bebe",
  "idempotencyKey": "optional-client-key"
}
```

Rules:

- `date` is normalized before validation; after normalization it must be a real `YYYY-MM-DD`.
- `time` is normalized before validation; after normalization it must be strict `HH:mm`.
- `phone` must be numeric after normalization.
- `partySize` is coerced from numeric strings and must be 1-18 for automatic booking.
- Exact selected slot must exist in Precompro availability with `status=true`.
- Duplicates by phone + exact timestamp are blocked/idempotent.
- `zone` filters availability only; Precompro assigns final table/section.

### `POST /tools/reservations/search`

Input:

```json
{ "phone": "3142360112" }
```

Returns active reservations by phone.

### `POST /tools/reservations/list-date`

Read-only endpoint for reservation reports by service date. It calls
Precompro `reservation/list` from the server IP and returns normalized
reservations plus summary counters.

Input:

```json
{
  "date": "2026-06-15",
  "includeCancelled": true
}
```

Output:

```json
{
  "ok": true,
  "code": "RESERVATIONS_BY_DATE_FOUND",
  "date": "2026-06-15",
  "includeCancelled": true,
  "summary": {
    "date": "2026-06-15",
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
    "statusCounts": {}
  },
  "reservations": []
}
```

For operational questions like "cuantas reservas hubo", agents should use
`activeReservations` unless the user explicitly asks to include cancellations.
For "cuantas personas trajo" or attendance, agents should use
`completedPeople`; `activePeople` means non-cancelled reservations and can
include no-shows.

Reservation detail rows may include operational fields returned by Precompro,
normalized for agents:

- Timing: `date`, `dateTime`, `reservationHour`, `weekday`, `weekdayNumber`.
- Party: `people`, `adult`, `boy`, `baby`, `partyBucket`.
- Status: `status`, `codeStatus`, `completed`, `noShow`, `cancelled`.
- Location: `tableId`, `tableName`, `sectionId`, `sectionName`,
  `subSectionId`, `subSectionName`.
- Source/payment: `source`, `provider`, `typeReservation`, `paymentType`,
  `balancePaid`.
- Audit: `createdAt`, `updatedAt`, `createdBy`, `finishedBy`, `cancelledBy`,
  `noShowBy`.
- Notes: `comments`, `commentsStructured`.

### `POST /tools/reservations/list-range`

Read-only endpoint for date range reports. The range is inclusive and capped at
31 days so the agent can answer weekly and monthly-light questions without
pulling unbounded data.

Input:

```json
{
  "from": "2026-06-15",
  "to": "2026-06-19",
  "includeCancelled": true,
  "includeReservations": false
}
```

Output:

```json
{
  "ok": true,
  "code": "RESERVATIONS_RANGE_FOUND",
  "from": "2026-06-15",
  "to": "2026-06-19",
  "daysCount": 5,
  "includeCancelled": true,
  "includeReservations": false,
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
    "cancelledPeople": 23,
    "statusCounts": {}
  },
  "days": [
    {
      "date": "2026-06-15",
      "summary": {}
    }
  ]
}
```

Agents should calculate relative date phrases, such as "semana pasada de lunes
a viernes", into exact `YYYY-MM-DD` dates in `America/Bogota` before calling
this endpoint.

### `POST /tools/reservations/report`

Read-only aggregated reporting endpoint. It returns summaries and grouped
metrics without guest names or phone numbers. Use this for most internal
questions that ask "por hora", "por zona", "por estado", "por fuente", "por
mesa" or "comparar".

Input:

```json
{
  "from": "2026-06-15",
  "to": "2026-06-19",
  "includeCancelled": true,
  "groupBy": ["date", "hour", "lifecycle"],
  "filters": {
    "sectionName": "Salón",
    "lifecycle": ["completed", "noShow"]
  }
}
```

Allowed `groupBy` values:

```text
date, weekday, hour, reservationHour, status, lifecycle, sectionName,
tableName, partyBucket, source, provider, typeReservation, paymentType,
createdBy, finishedBy, cancelledBy, noShowBy
```

Output:

```json
{
  "ok": true,
  "code": "RESERVATION_REPORT_READY",
  "from": "2026-06-15",
  "to": "2026-06-19",
  "groupBy": ["date", "hour"],
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
        "hour": "20:00"
      },
      "label": "date: 2026-06-19 | hour: 20:00",
      "summary": {}
    }
  ],
  "days": [
    {
      "date": "2026-06-19",
      "summary": {}
    }
  ]
}
```

For comparisons, call this endpoint once per range and compare the returned
`summary` values. Keep each range to 31 days or less.

### `POST /tools/customers/segment`

Internal-only customer segmentation endpoint. It scans Precompro reservations by
date range, deduplicates contacts by phone/email/document/name, derives customer
metrics and preferences, and returns JSON or CSV. This endpoint returns PII and
is intended only for the internal/admin agent.

Input for customers who reserved and cancelled:

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

Input for customers with more than 10 reservations in the last month:

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

Response shape:

```json
{
  "ok": true,
  "code": "CUSTOMER_SEGMENT_READY",
  "internalOnly": true,
  "pii": true,
  "query": {},
  "scanned": {
    "daysCount": 30,
    "reservationsCount": 1200,
    "customerCount": 800
  },
  "pagination": {
    "totalCustomers": 80,
    "returnedCustomers": 100,
    "nextCursor": "100"
  },
  "customers": [
    {
      "contact": {
        "displayName": "Maria Perez",
        "phone": "573001112233",
        "email": "maria@example.com",
        "marketingConsent": "assumed_opt_in_precompro",
        "marketingEligible": true
      },
      "metrics": {
        "totalReservations": 12,
        "completedReservations": 9,
        "cancelledReservations": 2,
        "noShowReservations": 1,
        "completedPeople": 28,
        "cancellationRate": 0.1667
      },
      "preferences": {
        "topWeekdays": [],
        "topHours": [],
        "topSections": []
      }
    }
  ]
}
```

Supported criteria include reservation counts, people counts, rates, phone/email
presence, cancellation/no-show/completed flags, date recency, section/table,
source/provider, reservation hour, weekday, party bucket, occasion, preferred
zone, name text and comments text.

Ranges have no hard day limit. Results are paginated with `limit` and
`pagination.nextCursor`.

### `POST /tools/customers/lookup`

Internal-only lookup by phone, email or name. If `from` and `to` are supplied it
returns historical customer metrics for that range; otherwise it scans a recent
default window.

Input:

```json
{
  "phone": "+57 300 123 4567",
  "from": "2026-01-01",
  "to": "2026-06-23",
  "includeReservations": true
}
```

### `POST /tools/customers/export`

CSV-oriented alias of `customer_segment`. Use this when the internal agent asks
for "base de datos", "lista" or "CSV" for use in another marketing tool. It
returns CSV content inside the JSON response as `csv`, plus a suggested
`filename`.

### `POST /tools/reservations/update`

Input:

```json
{
  "reservationId": "202605...",
  "phone": "3142360112",
  "date": "2026-05-06",
  "time": "12:30",
  "partySize": 3,
  "comments": "Actualizar a 3 personas"
}
```

Rules:

- The reservation must be active and found by phone.
- Middleware hydrates required Precompro fields before update.
- Target date/time/party size must pass availability validation.

### `POST /tools/reservations/cancel`

Input:

```json
{ "reservationId": "202605..." }
```

Cancel is treated as idempotent.

### `POST /tools/reservations/confirm`

Input:

```json
{ "reservationId": "202605..." }
```

Reserved for later reminder/reconfirmation flows. Do not call automatically after create in the MVP.

## Error Shape

All middleware errors are normalized:

```json
{
  "ok": false,
  "code": "SLOT_NOT_AVAILABLE",
  "message": "No encontre ese horario disponible.",
  "details": {
    "alternatives": []
  }
}
```

Convocore should branch on `ok` and `code`, not on raw Precompro messages.

## Tool Discovery

`GET /tools/schema` returns the tool list, paths, descriptions and JSON schemas
that should be copied into Convocore when we register the agent.

## Operational Rules

- Groups of 19+ return `ESCALATE_LARGE_PARTY` and should go to a human.
- `cancel` and `confirm` can receive `phone`; when present, the middleware
  verifies the reservation belongs to that phone before calling Precompro.
- The Precompro `apiKey` refresh process runs from Dokploy and refreshes before
  the 20-day operational window expires.
- Use a non-empty `TOOL_SECRET` before exposing this outside the local sandbox.
