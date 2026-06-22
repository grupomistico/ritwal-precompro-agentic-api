# Precompro Test Matrix For Ritwal

Goal: map the API behavior deeply enough to build a reliable Convocore frontdesk agent.

## Read-only Tests

- Service health
  - `status` for reservation, availability, vendor, and webservice.
  - Expected: all return `200` with `message: OK`.

- Vendor profile
  - Confirm display name, address, phone, email, timezone, menu URL, reservation schedule, and policy params.
  - Current Ritwal params:
    - `anticipationTime`: 1 hour.
    - `updateTime`: 12 hours.
    - `cancelledTime`: 12 hours.
    - `isActiveSelectedZone`: `0`.

- Sections
  - Confirm available sections and whether subzones are required.
  - Current Ritwal sections: `Salón` id `1442`, `Templos` id `1443`.

- Availability by date
  - Sweep the next 14-30 days.
  - Detect closed days, partial schedules, holidays, and empty responses.
  - Invalid/date-format result on 2026-05-05:
    - `YYYY-MM-DD` works.
    - `YYYY/MM/DD` works and is interpreted as the same date.
    - `05-06-2026` is accepted but interpreted as `2026-06-05`, not `2026-05-06`.
    - Millisecond timestamp string `1778086800000` is accepted and interpreted as `2026-05-06`.
    - `not-a-date` returns `403`, `Date invalid: 1969-12-31`.
    - Past date `2025-05-06` returns `403`, `Date invalid: 2025-05-06`.
    - Impossible date `2026-02-30` returns `403`, but message normalizes it to `2026-03-02`.
    - Empty date returns `403`, `The date field is required.`
  - Middleware must parse natural-language dates itself and call Precompro with strict `YYYY-MM-DD`.

- Availability by party size
  - Test 1, 2, 3, 4, 5, 6, 8, 10, 12+ people.
  - Detect party-size limits and whether large parties should escalate to frontdesk.

- Availability by zone
  - Test default `zone=0`.
  - Test `zone=1442` and `zone=1443`, despite `isActiveSelectedZone=0`, to see whether the API ignores or applies zone.
  - Result on 2026-05-05: availability respects `zone`. Small parties are available in `Salón` (`1442`), while large parties are available in `Templos` (`1443`).

- Paid slots
  - Search for any slot returning `paymentInfo`.
  - If present, the agent must pass `paymentInfo.total` as `balancePaid` when creating.
  - Result on 2026-05-05: 30-day sweep across party sizes 2, 10, and 18 with zones 0, 1442, and 1443 produced `paidChecks=0`.

- List reservations by date
  - Check response shape, canceled reservation visibility, and status codes.
  - Result on 2026-05-05 for `2026-05-06` sandbox history: `list-date` returned 38 records, all canceled.
  - Canceled reservations had `status=Cancelada`, `codeStatus=4`, and non-null `isCancelled`.
  - Active filter should be `!isCancelled`; canceled records remain visible in `list-date`.
  - `isUserConfirmed=integration` can remain on canceled records that were confirmed before cancellation.

- List reservations by phone
  - Requires a reservation created with a phone.
  - Used for “quiero ver/cambiar/cancelar mi reserva”.
  - Result on 2026-05-05: if two active reservations share a phone, `list-phone` returns both in chronological order. After cancelling one, it returns only the remaining active reservation. After cancelling both, it returns an empty list.

- List reservations by `intuiposId`
  - Result on 2026-05-05: using the `tableId` from a newly created reservation as `intuiposId` did not return that reservation. It returned older canceled reservations instead.
  - Treat `intuiposId` as not useful for customer-facing WhatsApp flows unless Precompro clarifies the mapping.

- Duplicate same customer/same slot
  - Result on 2026-05-05: Precompro allowed two reservations with the same phone, same displayName, same people count, and same timestamp.
  - `list-phone` returned both duplicate reservations.
  - Availability for the same slot remained `status=true` after both creates.
  - Middleware should block duplicate active reservations for the same phone + exact timestamp unless explicitly overridden by a human.
  - Concurrent result on 2026-05-05: two simultaneous `create` requests for the same phone + exact timestamp both succeeded in ~645ms and produced two active reservations.
  - Middleware needs an idempotency key or lock around `phone + timestamp` before calling Precompro.

## Write Lifecycle Tests

Run only with `RUN_WRITE_TESTS=true`.

- Create free reservation
  - Required: `people`, `displayName`, `date`.
  - Optional but important for agent: `phone`, `indicative`, `email`, `comments`.

- Create with phone and then list by phone
  - Confirms the lookup flow customers will actually use.

- Update reservation
  - Change date/time and people count.
  - Test blocked updates inside `updateTime` window.
  - Result on 2026-05-05: webservice allowed updating a same-day reservation inside the 12-hour `updateTime` window.
  - Result on 2026-05-05: webservice allowed updating a valid reservation from `2026-05-06 12:00:00` to invalid `2026-05-06 03:00:00`. Middleware must validate update target availability.
  - Partial update result on 2026-05-05:
    - `comments` only, `displayName` only, and `phone` only returned HTTP `200` with body `code=403` requiring `people` and `date`.
    - `people` only returned `code=403` requiring `date`.
    - `date` only returned `code=403` requiring `people`.
    - Existing reservation remained unchanged.
  - Middleware must hydrate update payloads with current reservation `people` and `date` at minimum, even when the user changes only one field.

- Confirm reservation
  - Confirm whether this changes `status`, `codeStatus`, or only returns a message.
  - Result on 2026-05-05:
    - Immediately after `create`, `list-phone` reports `status=confirmada`.
    - At the same time, `list-date` reports `status=Sin Reconfirmar`, `codeStatus=0`, `isUserConfirmed=null`.
    - After `confirm`, `list-phone` reports `status=confirmada por usuario`.
    - After `confirm`, `list-date` still reports `status=Sin Reconfirmar`, `codeStatus=0`, but `isUserConfirmed=integration`.
  - For agent responses, treat successful create as reserved, and optional confirm as user-confirmed. Do not rely on `list-date.status` alone for confirmation state.
  - Result on 2026-05-05: confirming a canceled reservation returned `200` with `message=Ok`, but did not make it appear in `list-phone`.

- Cancel reservation
  - Confirm status after cancellation.
  - Test blocked cancels inside `cancelledTime` window.
  - Result on 2026-05-05: webservice allowed cancelling a same-day reservation inside the 12-hour `cancelledTime` window.
  - Result on 2026-05-05: cancelling the same reservation twice returned `200` both times. Treat cancel as idempotent from the middleware perspective.

- Operations with nonexistent reservation ID
  - Result on 2026-05-05:
    - `cancel/{fakeId}` returned HTTP `500` with technical PHP message.
    - `confirm/{fakeId}` returned HTTP `200` with body `{ code: 404, message: "Reservation not found" }`.
    - `update/{fakeId}` returned HTTP `200` with body `{ code: 404, message: "Reservation not found" }`.
  - Middleware must inspect response body, not only HTTP status.

- Create against unavailable slot
  - Agent must gracefully say the time is unavailable and offer alternatives.
  - Result on 2026-05-05: Precompro accepted `2026-05-06 03:00:00` even though availability does not expose that slot. Middleware must enforce availability before calling create.
  - Result on 2026-05-05: Precompro accepted `2026-05-05 12:00:00` even though availability returned `status=false` with `validation=noAnticipationOrRotation`.

- Create with invalid payload
  - Missing name, invalid date, invalid phone.
  - Agent/middleware should normalize errors into user-safe messages.
  - Result on 2026-05-05:
    - Missing/empty `displayName`: `400`, `The display name field is required.`
    - Missing `date`: `400`, `The date field is required.`
    - String `date`: `400`, `The date must be a number.`
    - `people=0` or negative: `403`, `Not availability on this date, please change the date`
    - String `people`: `400`, `The people must be a number.`
    - Weird string `phone=abc`: accepted and created reservation. Middleware must validate phone.
    - Weird string `indicative=co`: accepted and normalized to `57`. Middleware must validate country code.

- Create with email
  - Result on 2026-05-05: creating with `email` returns `emailStatus=Enviado` and `typeNotification=email`.

- Create with comments/special fields
  - Result on 2026-05-05: structured `comments` persist exactly and are visible in `list-date`.
  - Extra fields persisted:
    - `birthday`
    - `celebrationComment`
    - `commentRestaurant`
  - Extra fields ignored/not persisted in this test:
    - `alergies`
    - `allergies`
    - `hasPets`
    - `celebrationName`
    - `guest`
  - Middleware should place all guest-facing special requests in `comments`, and may also fill `birthday`, `celebrationComment`, and `commentRestaurant` when useful.

- Create with party composition
  - Result on 2026-05-05: sending `people=4`, `adult=2`, `boy=1`, `baby=1` created a reservation.
  - Response/list showed `people=4`, `adult=4`, `boy=1`, `baby=0`.
  - `boy` appears to persist; `baby` did not persist; `adult` was overwritten to match `people`.
  - Middleware should keep total party size in `people` and place composition details in `comments` for reliability.

- Create 19+ people
  - Result on 2026-05-05: creating 19 people at `2026-05-06 12:00:00` returned `403`, `Not availability on this date, please change the date`.

- Create with explicit zone/section fields
  - Result on 2026-05-05: `create` accepts extra fields such as `zone`, `sectionId`, `subzone`, and `subSectionId`, but ignores them for assignment.
  - For 2 people, forcing `Templos` (`1443`) still assigned reservations to `Salón` (`1442`).
  - For 18 people, forcing `Salón` (`1442`) still assigned reservations to `Templos` (`1443`).
  - Middleware should use zone only to filter/check availability and set user expectations; final table/section is assigned by Precompro.

## Agent Design Implications

- Always call availability before create, and only create when the exact selected timestamp has `status=true`.
- Never invent availability from vendor schedules alone.
- Store or ask for phone number before creating if future lookup/cancel/update will be needed.
- Validate phone, country code, party size, and exact availability in middleware before calling Precompro.
- Prevent duplicate active reservations for the same phone and exact timestamp.
- Add idempotency/locking for create requests because Precompro accepts simultaneous duplicates.
- Use middleware timeouts around Precompro calls.
  - Result on 2026-05-05 latency sample:
    - `vendor`: avg 273ms, max 620ms.
    - `sections`: avg 129ms, max 143ms.
    - `availability`: avg 544ms, max 1078ms.
    - `list-date`: avg 552ms, max 932ms.
    - `list-phone` empty: avg 138ms, max 163ms.
    - `create`: avg 569ms, max 806ms.
    - `cancel`: avg 369ms, max 511ms.
  - Suggested tool timeout: 8-10 seconds with one controlled retry only for safe read operations. Do not blindly retry create without idempotency.
- For update/cancel, find candidate reservations by phone and ask user to confirm which reservation if more than one exists.
- Do not expose internal IDs to guests.
- Escalate to human when:
  - Large party size has no slots.
  - API returns 500/timeout.
  - Reservation is within update/cancel restricted windows.
  - Customer asks for special handling not covered by fields.
