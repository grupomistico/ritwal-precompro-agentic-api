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
- The Precompro `apiKey` rotates every 30 days; update `PRECOMPRO_API_KEY`
  before expiry and restart/redeploy the middleware.
- Use a non-empty `TOOL_SECRET` before exposing this outside the local sandbox.
