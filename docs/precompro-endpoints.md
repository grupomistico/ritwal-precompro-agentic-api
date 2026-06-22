# Precompro API Notes

Source: https://documentation.precompro.co/docs and https://documentation.precompro.co/docs-json

Environment reviewed from public docs: Staging.

Ritwal test credentials currently respond on the hosts without the `2` suffix. The public staging availability host `serviceavailability2.precompro.co` returned a PHP/Composer 500 during testing on 2026-05-05 and again on 2026-05-22.

On 2026-05-22 the previous sandbox key returned `401 Unauthorized` on the same requests that had worked before. A replacement sandbox key restored `vendor`, `sections`, `availability`, and `reservation/list` on the hosts without `2`. If this happens again, first verify the sandbox key before changing Convocore or middleware logic.

Authentication:

- Header name: `apiKey`
- Access is IP allowlisted by Precompro. For sandbox testing we will request `0.0.0.0`.
- Staging and production API keys are different.
- For Ritwal, the token must be refreshed every 30 days. Treat `/refresh` as a rotation operation and update the deployed secret immediately after a successful refresh.

Base URLs:

- Reservation: `https://servicereservation.precompro.co/api/ws`
- Availability: `https://serviceavailability.precompro.co/api`
- Vendor: `https://servicevendor.precompro.co/api`
- Webservice: `https://servicewebservice.precompro.co/api`

Public staging docs list these alternatives:

- Reservation: `https://servicereservation2.precompro.co/api/ws`
- Availability: `https://serviceavailability2.precompro.co/api`
- Vendor: `https://servicevendor2.precompro.co/api`
- Webservice: `https://servicewebservice2.precompro.co/api`

Endpoints:

- `POST /availability/ws`: get available reservation slots.
  - Body: `vendorId` string, `people` number, `date` as `YYYY-MM-DD`, optional `zone` and `subzone`.
  - Response: array of slots with `date` in milliseconds, `dateTime`, `status`, `validation`, and optional `paymentInfo`.
  - If `paymentInfo` exists, pass `paymentInfo.total` as `balancePaid` when creating the reservation.

- `POST /reservation/create/{vendorId}`: create reservation.
  - Required body: `people`, `displayName`, `date` in milliseconds.
  - Optional body: `email`, `phone`, `indicative`, `balancePaid`, `comments`.
  - Response includes `reservation.id_reservation`; may include `paymentLink`, `limitTime`, and `limitTimeFormat`.

- `PUT /reservation/update/{id}`: update reservation.
  - Body supports the same fields as create, all optional.
  - `id` is the `id_reservation` returned by create/list.

- `PUT /reservation/cancel/{id}`: cancel reservation.

- `PUT /reservation/confirm/{id}`: confirm reservation.

- `POST /reservation/list`: list reservations.
  - Required body: `vendorId`.
  - Optional filters: `phone`, `intuiposId`, `date` as `YYYY-MM-DD`.
  - Response shape depends on the filter:
    - phone: array of reservation summaries.
    - intuiposId: array of reservation summaries.
    - date: `{ data: [...] }`.

- `GET /ws/vendor/{id}`: restaurant info, schedules, menu URL, branches, and reservation params.

- `GET /ws/vendor/{id}/sections`: restaurant zones/sections and sub-sections.

- `GET /refresh`: generate a new API key from the old one. Treat as a sensitive operation.
  - Run intentionally only. It invalidates/rotates the working credential.
  - After refreshing, update `.env`, deployment secrets, Convocore/middleware secrets, and any password manager entry.

Error behavior:

- `400`: validation errors.
- `403`: missing API key, unauthorized user, unauthorized IP, inactive user, or no availability for some reservation writes.
- `404`: vendor or reservation not found.
- `500`: Precompro internal error.

Testing order:

1. `vendor`
2. `sections`
3. `availability`
4. `list-date`
5. `create` only with `RUN_WRITE_TESTS=true`
6. `cancel` or `confirm` only against a sandbox reservation
