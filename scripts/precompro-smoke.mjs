import { readFileSync, existsSync } from "node:fs";

loadDotEnv();

const env = process.env;
const command = process.argv[2] || "help";

const config = {
  apiKey: env.PRECOMPRO_API_KEY,
  vendorId: env.PRECOMPRO_VENDOR_ID,
  bases: {
    reservation:
      env.PRECOMPRO_RESERVATION_BASE ||
      "https://servicereservation.precompro.co/api/ws",
    availability:
      env.PRECOMPRO_AVAILABILITY_BASE ||
      "https://serviceavailability.precompro.co/api",
    vendor:
      env.PRECOMPRO_VENDOR_BASE || "https://servicevendor.precompro.co/api",
    webservice:
      env.PRECOMPRO_WEBSERVICE_BASE ||
      "https://servicewebservice.precompro.co/api",
  },
};

const readCommands = new Set([
  "read",
  "status",
  "vendor",
  "sections",
  "availability",
  "list-date",
  "list-phone",
  "list-intuipos",
  "availability-invalid-dates",
  "latency",
  "list-date-summary",
]);
const writeCommands = new Set([
  "create",
  "update",
  "cancel",
  "confirm",
  "lifecycle",
  "create-unavailable",
  "multi-phone",
  "invalid-payloads",
  "email",
  "update-unavailable",
  "duplicate-slot",
  "operation-edges",
  "create-zone-fields",
  "intuipos-flow",
  "concurrent-create",
  "special-fields",
  "latency-write",
  "partial-update",
  "confirm-state",
  "party-composition",
]);
const refreshCommands = new Set(["refresh"]);

try {
  await main();
} catch (error) {
  console.error(error.message);
  if (error.details) {
    console.error(JSON.stringify(error.details, null, 2));
  }
  process.exit(1);
}

async function main() {
  if (command === "help") {
    printHelp();
    return;
  }

  if (writeCommands.has(command) && env.RUN_WRITE_TESTS !== "true") {
    throw new Error(
      `Write command "${command}" blocked. Set RUN_WRITE_TESTS=true only for intentional sandbox writes.`,
    );
  }

  if (refreshCommands.has(command) && env.RUN_REFRESH_TESTS !== "true") {
    throw new Error(
      `Refresh command blocked. Set RUN_REFRESH_TESTS=true only when you are ready to rotate the Precompro apiKey.`,
    );
  }

  requireEnv("PRECOMPRO_API_KEY", config.apiKey);

  switch (command) {
    case "read":
      await runReadSuite();
      break;
    case "status":
      await status();
      break;
    case "vendor":
      await vendor();
      break;
    case "sections":
      await sections();
      break;
    case "availability":
      await availability();
      break;
    case "list-date":
      await listDate();
      break;
    case "list-phone":
      await listPhone();
      break;
    case "list-intuipos":
      await listIntuipos();
      break;
    case "availability-invalid-dates":
      await availabilityInvalidDates();
      break;
    case "latency":
      await latencyReadOnly();
      break;
    case "list-date-summary":
      await listDateSummary();
      break;
    case "create":
      await createReservation();
      break;
    case "update":
      await updateReservation();
      break;
    case "cancel":
      await cancelReservation(env.TEST_RESERVATION_ID);
      break;
    case "confirm":
      await confirmReservation(env.TEST_RESERVATION_ID);
      break;
    case "lifecycle":
      await lifecycleReservation();
      break;
    case "create-unavailable":
      await createUnavailableReservation();
      break;
    case "multi-phone":
      await multiPhoneReservations();
      break;
    case "invalid-payloads":
      await invalidPayloads();
      break;
    case "email":
      await emailReservation();
      break;
    case "update-unavailable":
      await updateUnavailableReservation();
      break;
    case "duplicate-slot":
      await duplicateSlotReservations();
      break;
    case "operation-edges":
      await operationEdgeCases();
      break;
    case "create-zone-fields":
      await createZoneFields();
      break;
    case "intuipos-flow":
      await intuiposFlow();
      break;
    case "concurrent-create":
      await concurrentCreate();
      break;
    case "special-fields":
      await specialFields();
      break;
    case "latency-write":
      await latencyWrite();
      break;
    case "partial-update":
      await partialUpdate();
      break;
    case "confirm-state":
      await confirmState();
      break;
    case "party-composition":
      await partyComposition();
      break;
    case "refresh":
      await refreshApiKey();
      break;
    default:
      throw new Error(`Unknown command "${command}". Run npm run precompro -- help.`);
  }
}

async function runReadSuite() {
  await vendor();
  await sections();
  await availability();
  await listDate();
}

async function status() {
  const bases = [
    ["reservation", config.bases.reservation],
    ["availability", config.bases.availability],
    ["vendor", config.bases.vendor],
    ["webservice", config.bases.webservice],
  ];

  const results = [];
  for (const [name, base] of bases) {
    const statusUrl =
      name === "reservation" && base.endsWith("/ws")
        ? `${base.slice(0, -3)}/status`
        : `${base}/status`;
    try {
      results.push({
        name,
        result: await request("GET", statusUrl, { tolerateHttpError: true }),
      });
    } catch (error) {
      results.push({ name, error: error.message });
    }
  }
  printJson(results);
}

async function vendor() {
  requireVendor();
  printJson(
    await request("GET", `${config.bases.vendor}/ws/vendor/${config.vendorId}`),
  );
}

async function sections() {
  requireVendor();
  printJson(
    await request(
      "GET",
      `${config.bases.vendor}/ws/vendor/${config.vendorId}/sections`,
    ),
  );
}

async function availability({ silent = false } = {}) {
  requireVendor();
  const body = {
    vendorId: config.vendorId,
    people: numberEnv("TEST_PEOPLE", 2),
    date: env.TEST_DATE || tomorrowBogota(),
    zone: numberEnv("TEST_ZONE", 0),
    subzone: numberEnv("TEST_SUBZONE", 0),
  };
  const response = await request(
    "POST",
    `${config.bases.availability}/availability/ws`,
    { body },
  );
  if (!silent) printJson(response);
  return response;
}

async function availabilityInvalidDates() {
  requireVendor();
  const cases = [
    "2026-05-06",
    "2026/05/06",
    "05-06-2026",
    "not-a-date",
    "1778086800000",
    "2025-05-06",
    "2026-02-30",
    "",
  ];

  const results = [];
  for (const date of cases) {
    const response = await request(
      "POST",
      `${config.bases.availability}/availability/ws`,
      {
        body: {
          vendorId: config.vendorId,
          people: numberEnv("TEST_PEOPLE", 2),
          date,
          zone: numberEnv("TEST_ZONE", 0),
          subzone: numberEnv("TEST_SUBZONE", 0),
        },
        tolerateHttpError: true,
      },
    );
    results.push({
      date,
      ok: response.ok,
      status: response.status,
      dataSummary: summarizeAvailabilityResponse(response.data),
      data: response.data,
    });
  }

  printJson(results);
}

async function latencyReadOnly() {
  requireVendor();
  const iterations = numberEnv("LATENCY_ITERATIONS", 5);
  const probes = [
    {
      name: "vendor",
      fn: () => request("GET", `${config.bases.vendor}/ws/vendor/${config.vendorId}`),
    },
    {
      name: "sections",
      fn: () =>
        request("GET", `${config.bases.vendor}/ws/vendor/${config.vendorId}/sections`),
    },
    {
      name: "availability",
      fn: () =>
        request("POST", `${config.bases.availability}/availability/ws`, {
          body: {
            vendorId: config.vendorId,
            people: numberEnv("TEST_PEOPLE", 2),
            date: env.TEST_DATE || tomorrowBogota(),
            zone: numberEnv("TEST_ZONE", 0),
            subzone: numberEnv("TEST_SUBZONE", 0),
          },
        }),
    },
    {
      name: "list-date",
      fn: () =>
        request("POST", `${config.bases.reservation}/reservation/list`, {
          body: {
            vendorId: config.vendorId,
            date: env.TEST_DATE || tomorrowBogota(),
          },
        }),
    },
    {
      name: "list-phone-empty",
      fn: () => listByPhoneRaw(Number(env.TEST_PHONE || "9999999999")),
    },
  ];

  const results = [];
  for (const probe of probes) {
    results.push(await measureProbe(probe.name, probe.fn, iterations));
  }
  printJson(results);
}

async function listDate() {
  requireVendor();
  printJson(
    await request("POST", `${config.bases.reservation}/reservation/list`, {
      body: {
        vendorId: config.vendorId,
        date: env.TEST_DATE || todayBogota(),
      },
    }),
  );
}

async function listDateSummary() {
  requireVendor();
  const date = env.TEST_DATE || tomorrowBogota();
  const response = await request("POST", `${config.bases.reservation}/reservation/list`, {
    body: {
      vendorId: config.vendorId,
      date,
    },
  });
  const items = reservationListItems(response.data);
  const summary = {
    ok: response.ok,
    status: response.status,
    date,
    total: items.length,
    activeCount: items.filter((item) => !item.isCancelled).length,
    cancelledCount: items.filter((item) => item.isCancelled).length,
    byStatus: countBy(items, (item) => item.status ?? "null"),
    byCodeStatus: countBy(items, (item) => String(item.codeStatus ?? "null")),
    byIsUserConfirmed: countBy(items, (item) => item.isUserConfirmed ?? "null"),
    active: items
      .filter((item) => !item.isCancelled)
      .map((item) => summarizeDateReservation(item)),
    cancelledSamples: items
      .filter((item) => item.isCancelled)
      .slice(-10)
      .map((item) => summarizeDateReservation(item)),
  };
  printJson(summary);
}

async function listPhone() {
  requireVendor();
  requireEnv("TEST_PHONE", env.TEST_PHONE);
  printJson(await listByPhoneRaw(Number(env.TEST_PHONE)));
}

async function listIntuipos() {
  requireVendor();
  requireEnv("TEST_INTUIPOS_ID", env.TEST_INTUIPOS_ID);
  printJson(await listByIntuiposRaw(Number(env.TEST_INTUIPOS_ID)));
}

async function listByPhoneRaw(phone) {
  return request("POST", `${config.bases.reservation}/reservation/list`, {
    body: {
      vendorId: config.vendorId,
      phone,
    },
  });
}

async function listByIntuiposRaw(intuiposId) {
  return request("POST", `${config.bases.reservation}/reservation/list`, {
    body: {
      vendorId: config.vendorId,
      intuiposId,
    },
  });
}

async function createReservation() {
  requireVendor();

  const slot = await resolveCreateSlot();
  const body = {
    people: numberEnv("TEST_PEOPLE", 2),
    displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox",
    date: slot.date,
    comments: env.TEST_COMMENTS || "Prueba automatizada desde sandbox Solvers AI",
  };

  if (env.TEST_EMAIL) body.email = env.TEST_EMAIL;
  if (env.TEST_PHONE_CREATE) body.phone = Number(env.TEST_PHONE_CREATE);
  if (env.TEST_INDICATIVE) body.indicative = Number(env.TEST_INDICATIVE);

  const balancePaid =
    env.TEST_BALANCE_PAID ||
    (slot.paymentInfo && String(slot.paymentInfo.total)) ||
    "";
  if (balancePaid) body.balancePaid = Number(balancePaid);

  const response = await request(
    "POST",
    `${config.bases.reservation}/reservation/create/${config.vendorId}`,
    { body },
  );
  printJson(response);

  const reservationId = response?.data?.reservation?.id_reservation;
  if (reservationId && env.CANCEL_AFTER_CREATE === "true") {
    console.error(`\nCANCEL_AFTER_CREATE=true, cancelling ${reservationId}...`);
    printJson(await cancelReservation(reservationId, { print: false }));
  }
}

async function lifecycleReservation() {
  requireVendor();

  const slotsResponse = await availability({ silent: true });
  const slots = Array.isArray(slotsResponse.data)
    ? slotsResponse.data.filter((item) => item.status)
    : [];
  if (slots.length < 2) {
    throw new Error("Need at least two available slots to test create/update lifecycle.");
  }

  const phone = Number(env.TEST_PHONE_CREATE || "1234567890");
  const createSlot = slots[0];
  const updateSlot = slots[1];
  const summary = {
    createSlot: createSlot.dateTime,
    updateSlot: updateSlot.dateTime,
    phone,
    steps: [],
  };
  let reservationId;

  try {
    const createBody = {
      people: numberEnv("TEST_PEOPLE", 2),
      displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox",
      date: createSlot.date,
      phone,
      indicative: Number(env.TEST_INDICATIVE || 57),
      comments: env.TEST_COMMENTS || "Prueba automatizada desde sandbox Solvers AI",
    };
    if (env.TEST_EMAIL) createBody.email = env.TEST_EMAIL;
    if (createSlot.paymentInfo) createBody.balancePaid = Number(createSlot.paymentInfo.total);

    const createResponse = await request(
      "POST",
      `${config.bases.reservation}/reservation/create/${config.vendorId}`,
      { body: createBody },
    );
    reservationId = createResponse.data?.reservation?.id_reservation;
    summary.reservationId = reservationId;
    summary.steps.push({
      name: "create",
      ok: createResponse.ok,
      status: createResponse.status,
      message: createResponse.data?.message,
    });
    if (!reservationId) throw new Error("Create succeeded but did not return id_reservation.");

    const listAfterCreate = await listByPhoneRaw(phone);
    summary.steps.push({
      name: "list-phone-after-create",
      ok: listAfterCreate.ok,
      status: listAfterCreate.status,
      count: reservationListCount(listAfterCreate.data),
      sample: reservationListItems(listAfterCreate.data).map((item) => ({
        id: item.id_reservation,
        status: item.status,
        fechaCompleta: item.fechaCompleta,
      })),
    });

    const updateResponse = await request(
      "PUT",
      `${config.bases.reservation}/reservation/update/${reservationId}`,
      {
        body: {
          people: numberEnv("TEST_PEOPLE", 2),
          displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox",
          date: updateSlot.date,
          phone,
          indicative: Number(env.TEST_INDICATIVE || 57),
          comments: `${env.TEST_COMMENTS || "Prueba automatizada desde sandbox Solvers AI"} | update lifecycle`,
        },
      },
    );
    summary.steps.push({
      name: "update",
      ok: updateResponse.ok,
      status: updateResponse.status,
      data: updateResponse.data,
    });

    const confirmResponse = await request(
      "PUT",
      `${config.bases.reservation}/reservation/confirm/${reservationId}`,
    );
    summary.steps.push({
      name: "confirm",
      ok: confirmResponse.ok,
      status: confirmResponse.status,
      data: confirmResponse.data,
    });
  } finally {
    if (reservationId) {
      const cancelResponse = await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      );
      summary.steps.push({
        name: "cancel-cleanup",
        ok: cancelResponse.ok,
        status: cancelResponse.status,
        data: cancelResponse.data,
      });

      const listAfterCancel = await listByPhoneRaw(phone);
      summary.steps.push({
        name: "list-phone-after-cancel",
        ok: listAfterCancel.ok,
        status: listAfterCancel.status,
        count: reservationListCount(listAfterCancel.data),
        statuses: reservationListItems(listAfterCancel.data).map((item) => ({
          id: item.id_reservation,
          status: item.status,
          fechaCompleta: item.fechaCompleta,
        })),
      });
    }
  }

  printJson(summary);
}

async function createUnavailableReservation() {
  requireVendor();
  const date = env.TEST_UNAVAILABLE_DATE || env.TEST_DATE || tomorrowBogota();
  const time = env.TEST_UNAVAILABLE_TIME || "03:00:00";
  const epochMs = bogotaDateTimeToEpochMs(date, time);
  const body = {
    people: numberEnv("TEST_PEOPLE", 2),
    displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox Unavailable",
    date: epochMs,
    phone: Number(env.TEST_PHONE_CREATE || "1234567893"),
    indicative: Number(env.TEST_INDICATIVE || 57),
    comments: env.TEST_COMMENTS || "Prueba automatizada fuera de horario",
  };

  const createResponse = await request(
    "POST",
    `${config.bases.reservation}/reservation/create/${config.vendorId}`,
    { body, tolerateHttpError: true },
  );

  const reservationId = createResponse.data?.reservation?.id_reservation;
  const summary = {
    attemptedDateTime: `${date} ${time}`,
    epochMs,
    createResponse,
    cleanup: null,
  };

  if (reservationId) {
    summary.cleanup = await request(
      "PUT",
      `${config.bases.reservation}/reservation/cancel/${reservationId}`,
      { tolerateHttpError: true },
    );
  }

  printJson(summary);
}

async function multiPhoneReservations() {
  requireVendor();

  const slotsResponse = await availability({ silent: true });
  const slots = Array.isArray(slotsResponse.data)
    ? slotsResponse.data.filter((item) => item.status)
    : [];
  if (slots.length < 2) {
    throw new Error("Need at least two available slots to test multiple reservations.");
  }

  const phone = Number(env.TEST_PHONE_CREATE || "1234567896");
  const summary = {
    phone,
    slots: slots.slice(0, 2).map((slot) => slot.dateTime),
    createdReservationIds: [],
    steps: [],
  };

  try {
    for (const [index, slot] of slots.slice(0, 2).entries()) {
      const createResponse = await request(
        "POST",
        `${config.bases.reservation}/reservation/create/${config.vendorId}`,
        {
          body: {
            people: numberEnv("TEST_PEOPLE", 2),
            displayName: `${env.TEST_DISPLAY_NAME || "Ritwal Sandbox Multi"} ${index + 1}`,
            date: slot.date,
            phone,
            indicative: Number(env.TEST_INDICATIVE || 57),
            comments: `${env.TEST_COMMENTS || "Prueba automatizada desde sandbox Solvers AI"} | multi ${index + 1}`,
          },
        },
      );
      const reservationId = createResponse.data?.reservation?.id_reservation;
      if (reservationId) summary.createdReservationIds.push(reservationId);
      summary.steps.push({
        name: `create-${index + 1}`,
        ok: createResponse.ok,
        status: createResponse.status,
        reservationId,
        fechaCompleta: createResponse.data?.reservation?.fechaCompleta,
      });
    }

    const listBoth = await listByPhoneRaw(phone);
    summary.steps.push({
      name: "list-phone-two-active",
      ok: listBoth.ok,
      status: listBoth.status,
      count: reservationListCount(listBoth.data),
      reservations: summarizeReservationList(listBoth.data),
    });

    const firstId = summary.createdReservationIds[0];
    if (firstId) {
      const cancelFirst = await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${firstId}`,
        { tolerateHttpError: true },
      );
      summary.steps.push({
        name: "cancel-first",
        ok: cancelFirst.ok,
        status: cancelFirst.status,
        data: cancelFirst.data,
      });
    }

    const listOne = await listByPhoneRaw(phone);
    summary.steps.push({
      name: "list-phone-after-one-cancel",
      ok: listOne.ok,
      status: listOne.status,
      count: reservationListCount(listOne.data),
      reservations: summarizeReservationList(listOne.data),
    });
  } finally {
    for (const reservationId of summary.createdReservationIds.slice(1)) {
      const cleanup = await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      );
      summary.steps.push({
        name: `cleanup-${reservationId}`,
        ok: cleanup.ok,
        status: cleanup.status,
        data: cleanup.data,
      });
    }

    const finalList = await listByPhoneRaw(phone);
    summary.steps.push({
      name: "list-phone-final",
      ok: finalList.ok,
      status: finalList.status,
      count: reservationListCount(finalList.data),
      reservations: summarizeReservationList(finalList.data),
    });
  }

  printJson(summary);
}

async function invalidPayloads() {
  requireVendor();

  const slot = await resolveCreateSlot();
  const base = {
    people: numberEnv("TEST_PEOPLE", 2),
    displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox Invalid",
    date: slot.date,
    phone: Number(env.TEST_PHONE_CREATE || "1234567897"),
    indicative: Number(env.TEST_INDICATIVE || 57),
    comments: "Prueba automatizada payload invalido",
  };

  const cases = [
    {
      name: "missing-displayName",
      body: omit(base, "displayName"),
    },
    {
      name: "empty-displayName",
      body: { ...base, displayName: "" },
    },
    {
      name: "missing-date",
      body: omit(base, "date"),
    },
    {
      name: "date-string",
      body: { ...base, date: "2026-05-06 12:00:00" },
    },
    {
      name: "people-zero",
      body: { ...base, people: 0 },
    },
    {
      name: "people-negative",
      body: { ...base, people: -1 },
    },
    {
      name: "people-string",
      body: { ...base, people: "two" },
    },
    {
      name: "phone-string-weird",
      body: { ...base, phone: "abc" },
    },
    {
      name: "indicative-string",
      body: { ...base, indicative: "co" },
    },
  ];

  const results = [];
  for (const testCase of cases) {
    const response = await request(
      "POST",
      `${config.bases.reservation}/reservation/create/${config.vendorId}`,
      { body: testCase.body, tolerateHttpError: true },
    );
    const reservationId = response.data?.reservation?.id_reservation;
    const result = {
      name: testCase.name,
      ok: response.ok,
      status: response.status,
      data: response.data,
      cleanup: null,
    };

    if (reservationId) {
      result.cleanup = await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      );
    }
    results.push(result);
  }

  printJson(results);
}

async function emailReservation() {
  requireVendor();

  const slot = await resolveCreateSlot();
  const body = {
    people: numberEnv("TEST_PEOPLE", 2),
    displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox Email",
    date: slot.date,
    email: env.TEST_EMAIL || "ritwal-sandbox@example.com",
    phone: Number(env.TEST_PHONE_CREATE || "1234567898"),
    indicative: Number(env.TEST_INDICATIVE || 57),
    comments: env.TEST_COMMENTS || "Prueba automatizada con email",
  };

  const createResponse = await request(
    "POST",
    `${config.bases.reservation}/reservation/create/${config.vendorId}`,
    { body },
  );

  const reservationId = createResponse.data?.reservation?.id_reservation;
  const summary = {
    create: createResponse,
    cleanup: null,
  };

  if (reservationId) {
    summary.cleanup = await request(
      "PUT",
      `${config.bases.reservation}/reservation/cancel/${reservationId}`,
      { tolerateHttpError: true },
    );
  }

  printJson(summary);
}

async function updateUnavailableReservation() {
  requireVendor();

  const slot = await resolveCreateSlot();
  const invalidDate = env.TEST_UNAVAILABLE_DATE || env.TEST_DATE || tomorrowBogota();
  const invalidTime = env.TEST_UNAVAILABLE_TIME || "03:00:00";
  const invalidEpochMs = bogotaDateTimeToEpochMs(invalidDate, invalidTime);
  const phone = Number(env.TEST_PHONE_CREATE || "1234567899");
  let reservationId;
  const summary = {
    originalSlot: slot.dateTime,
    attemptedUpdateDateTime: `${invalidDate} ${invalidTime}`,
    attemptedUpdateEpochMs: invalidEpochMs,
    steps: [],
  };

  try {
    const createResponse = await request(
      "POST",
      `${config.bases.reservation}/reservation/create/${config.vendorId}`,
      {
        body: {
          people: numberEnv("TEST_PEOPLE", 2),
          displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox Update Invalid",
          date: slot.date,
          phone,
          indicative: Number(env.TEST_INDICATIVE || 57),
          comments: env.TEST_COMMENTS || "Prueba automatizada update invalido",
        },
      },
    );
    reservationId = createResponse.data?.reservation?.id_reservation;
    summary.reservationId = reservationId;
    summary.steps.push({
      name: "create",
      ok: createResponse.ok,
      status: createResponse.status,
      fechaCompleta: createResponse.data?.reservation?.fechaCompleta,
    });

    if (!reservationId) throw new Error("Create succeeded but did not return id_reservation.");

    const updateResponse = await request(
      "PUT",
      `${config.bases.reservation}/reservation/update/${reservationId}`,
      {
        body: {
          people: numberEnv("TEST_PEOPLE", 2),
          displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox Update Invalid",
          date: invalidEpochMs,
          phone,
          indicative: Number(env.TEST_INDICATIVE || 57),
          comments: `${env.TEST_COMMENTS || "Prueba automatizada update invalido"} | moved to unavailable`,
        },
        tolerateHttpError: true,
      },
    );
    summary.steps.push({
      name: "update-unavailable",
      ok: updateResponse.ok,
      status: updateResponse.status,
      data: updateResponse.data,
    });
  } finally {
    if (reservationId) {
      const cleanup = await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      );
      summary.steps.push({
        name: "cleanup",
        ok: cleanup.ok,
        status: cleanup.status,
        data: cleanup.data,
      });
    }
  }

  printJson(summary);
}

async function duplicateSlotReservations() {
  requireVendor();

  const slot = await resolveCreateSlot();
  const phone = Number(env.TEST_PHONE_CREATE || "1234567801");
  const summary = {
    slot: slot.dateTime,
    phone,
    createdReservationIds: [],
    steps: [],
  };

  try {
    summary.steps.push({
      name: "availability-before",
      result: summarizeAvailabilitySlot(await availability({ silent: true }), slot.date),
    });

    for (const index of [1, 2]) {
      const createResponse = await request(
        "POST",
        `${config.bases.reservation}/reservation/create/${config.vendorId}`,
        {
          body: {
            people: numberEnv("TEST_PEOPLE", 2),
            displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox Duplicate",
            date: slot.date,
            phone,
            indicative: Number(env.TEST_INDICATIVE || 57),
            comments: `${env.TEST_COMMENTS || "Prueba automatizada duplicate slot"} | duplicate ${index}`,
          },
          tolerateHttpError: true,
        },
      );
      const reservationId = createResponse.data?.reservation?.id_reservation;
      if (reservationId) summary.createdReservationIds.push(reservationId);
      summary.steps.push({
        name: `create-duplicate-${index}`,
        ok: createResponse.ok,
        status: createResponse.status,
        reservationId,
        data: createResponse.data,
      });
    }

    const listByPhone = await listByPhoneRaw(phone);
    summary.steps.push({
      name: "list-phone-after-duplicates",
      ok: listByPhone.ok,
      status: listByPhone.status,
      count: reservationListCount(listByPhone.data),
      reservations: summarizeReservationList(listByPhone.data),
    });

    summary.steps.push({
      name: "availability-after-duplicates",
      result: summarizeAvailabilitySlot(await availability({ silent: true }), slot.date),
    });
  } finally {
    for (const reservationId of summary.createdReservationIds) {
      const cleanup = await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      );
      summary.steps.push({
        name: `cleanup-${reservationId}`,
        ok: cleanup.ok,
        status: cleanup.status,
        data: cleanup.data,
      });
    }

    const finalList = await listByPhoneRaw(phone);
    summary.steps.push({
      name: "list-phone-final",
      ok: finalList.ok,
      status: finalList.status,
      count: reservationListCount(finalList.data),
      reservations: summarizeReservationList(finalList.data),
    });
  }

  printJson(summary);
}

async function operationEdgeCases() {
  requireVendor();

  const fakeId = env.TEST_FAKE_RESERVATION_ID || "ritwal_fake_reservation_id";
  const slot = await resolveCreateSlot();
  const phone = Number(env.TEST_PHONE_CREATE || "1234567802");
  const summary = {
    fakeId,
    slot: slot.dateTime,
    steps: [],
  };
  let reservationId;

  summary.steps.push({
    name: "cancel-fake-id",
    result: await request(
      "PUT",
      `${config.bases.reservation}/reservation/cancel/${fakeId}`,
      { tolerateHttpError: true },
    ),
  });
  summary.steps.push({
    name: "confirm-fake-id",
    result: await request(
      "PUT",
      `${config.bases.reservation}/reservation/confirm/${fakeId}`,
      { tolerateHttpError: true },
    ),
  });
  summary.steps.push({
    name: "update-fake-id",
    result: await request(
      "PUT",
      `${config.bases.reservation}/reservation/update/${fakeId}`,
      {
        body: {
          people: numberEnv("TEST_PEOPLE", 2),
          displayName: "Ritwal Sandbox Fake Update",
          date: slot.date,
          phone,
          indicative: Number(env.TEST_INDICATIVE || 57),
        },
        tolerateHttpError: true,
      },
    ),
  });

  try {
    const createResponse = await request(
      "POST",
      `${config.bases.reservation}/reservation/create/${config.vendorId}`,
      {
        body: {
          people: numberEnv("TEST_PEOPLE", 2),
          displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox Operation Edges",
          date: slot.date,
          phone,
          indicative: Number(env.TEST_INDICATIVE || 57),
          comments: env.TEST_COMMENTS || "Prueba automatizada operation edges",
        },
      },
    );
    reservationId = createResponse.data?.reservation?.id_reservation;
    summary.reservationId = reservationId;
    summary.steps.push({
      name: "create-valid",
      ok: createResponse.ok,
      status: createResponse.status,
      reservationId,
    });

    if (!reservationId) throw new Error("Create succeeded but did not return id_reservation.");

    summary.steps.push({
      name: "cancel-first",
      result: await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      ),
    });
    summary.steps.push({
      name: "cancel-second",
      result: await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      ),
    });
    summary.steps.push({
      name: "confirm-after-cancel",
      result: await request(
        "PUT",
        `${config.bases.reservation}/reservation/confirm/${reservationId}`,
        { tolerateHttpError: true },
      ),
    });
    summary.steps.push({
      name: "update-after-cancel",
      result: await request(
        "PUT",
        `${config.bases.reservation}/reservation/update/${reservationId}`,
        {
          body: {
            people: numberEnv("TEST_PEOPLE", 2),
            displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox Operation Edges",
            date: slot.date,
            phone,
            indicative: Number(env.TEST_INDICATIVE || 57),
            comments: "Intento update despues de cancelacion",
          },
          tolerateHttpError: true,
        },
      ),
    });

    const listAfter = await listByPhoneRaw(phone);
    summary.steps.push({
      name: "list-phone-after-cancel-ops",
      ok: listAfter.ok,
      status: listAfter.status,
      count: reservationListCount(listAfter.data),
      reservations: summarizeReservationList(listAfter.data),
    });
  } finally {
    if (reservationId) {
      const cleanup = await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      );
      summary.steps.push({
        name: "final-cleanup",
        ok: cleanup.ok,
        status: cleanup.status,
        data: cleanup.data,
      });
    }
  }

  printJson(summary);
}

async function createZoneFields() {
  requireVendor();

  const people = numberEnv("TEST_PEOPLE", 2);
  const targetZone = numberEnv("TEST_ZONE", people >= 10 ? 1443 : 1442);
  const originalZone = env.TEST_ZONE;
  if (env.TEST_AVAILABILITY_ZONE !== undefined) {
    env.TEST_ZONE = env.TEST_AVAILABILITY_ZONE;
  }
  const slotsResponse = await availability({ silent: true });
  env.TEST_ZONE = originalZone;
  const slots = Array.isArray(slotsResponse.data)
    ? slotsResponse.data.filter((item) => item.status)
    : [];
  if (!slots.length) {
    throw new Error("Need at least one available slot to test create zone fields.");
  }
  const slot = slots[0];
  const phone = Number(env.TEST_PHONE_CREATE || "1234567803");
  const summary = {
    people,
    targetZone,
    slot: slot.dateTime,
    phone,
    createdReservationIds: [],
    steps: [],
  };

  const variants = [
    {
      name: "zone",
      fields: { zone: targetZone },
    },
    {
      name: "sectionId",
      fields: { sectionId: targetZone },
    },
    {
      name: "zone-and-sectionId",
      fields: { zone: targetZone, sectionId: targetZone },
    },
    {
      name: "zone-subzone-zero",
      fields: { zone: targetZone, subzone: 0, sectionId: targetZone, subSectionId: 0 },
    },
  ];

  try {
    for (const [index, variant] of variants.entries()) {
      const createResponse = await request(
        "POST",
        `${config.bases.reservation}/reservation/create/${config.vendorId}`,
        {
          body: {
            people,
            displayName: `${env.TEST_DISPLAY_NAME || "Ritwal Sandbox Zone"} ${variant.name}`,
            date: slot.date,
            phone: phone + index,
            indicative: Number(env.TEST_INDICATIVE || 57),
            comments: `${env.TEST_COMMENTS || "Prueba automatizada zone fields"} | ${variant.name}`,
            ...variant.fields,
          },
          tolerateHttpError: true,
        },
      );
      const reservationId = createResponse.data?.reservation?.id_reservation;
      if (reservationId) summary.createdReservationIds.push(reservationId);
      summary.steps.push({
        name: `create-${variant.name}`,
        sentFields: variant.fields,
        ok: createResponse.ok,
        status: createResponse.status,
        reservationId,
        data: createResponse.data,
      });
    }

    const dateList = await request("POST", `${config.bases.reservation}/reservation/list`, {
      body: {
        vendorId: config.vendorId,
        date: env.TEST_DATE || tomorrowBogota(),
      },
    });
    const created = reservationListItems(dateList.data)
      .filter((item) => summary.createdReservationIds.includes(item.reservationId))
      .map((item) => ({
        reservationId: item.reservationId,
        displayName: item.displayName,
        phone: item.phone,
        people: item.people,
        fechaCompleta: item.fechaCompleta,
        tableName: item.tableName,
        tableId: item.tableId,
        sectionId: item.sectionId,
        sectionName: item.sectionName,
        subSectionId: item.subSectionId,
        subSectionName: item.subSectionName,
        status: item.status,
      }));
    summary.steps.push({
      name: "list-date-created-zone-results",
      ok: dateList.ok,
      status: dateList.status,
      reservations: created,
    });
  } finally {
    for (const reservationId of summary.createdReservationIds) {
      const cleanup = await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      );
      summary.steps.push({
        name: `cleanup-${reservationId}`,
        ok: cleanup.ok,
        status: cleanup.status,
        data: cleanup.data,
      });
    }
  }

  printJson(summary);
}

async function intuiposFlow() {
  requireVendor();

  const slot = await resolveCreateSlot();
  const phone = Number(env.TEST_PHONE_CREATE || "1234567804");
  const summary = {
    slot: slot.dateTime,
    phone,
    steps: [],
  };
  let reservationId;

  try {
    const createResponse = await request(
      "POST",
      `${config.bases.reservation}/reservation/create/${config.vendorId}`,
      {
        body: {
          people: numberEnv("TEST_PEOPLE", 2),
          displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox Intuipos",
          date: slot.date,
          phone,
          indicative: Number(env.TEST_INDICATIVE || 57),
          comments: env.TEST_COMMENTS || "Prueba automatizada intuipos",
        },
      },
    );
    reservationId = createResponse.data?.reservation?.id_reservation;
    summary.reservationId = reservationId;
    summary.steps.push({
      name: "create",
      ok: createResponse.ok,
      status: createResponse.status,
      reservationId,
    });

    const dateList = await request("POST", `${config.bases.reservation}/reservation/list`, {
      body: {
        vendorId: config.vendorId,
        date: env.TEST_DATE || tomorrowBogota(),
      },
    });
    const created = reservationListItems(dateList.data).find(
      (item) => item.reservationId === reservationId,
    );
    const tableId = created?.tableId;
    summary.tableId = tableId;
    summary.steps.push({
      name: "list-date-find-created",
      ok: dateList.ok,
      status: dateList.status,
      reservation: created
        ? {
            reservationId: created.reservationId,
            tableName: created.tableName,
            tableId: created.tableId,
            sectionId: created.sectionId,
            sectionName: created.sectionName,
            status: created.status,
            fechaCompleta: created.fechaCompleta,
          }
        : null,
    });

    if (!tableId) throw new Error("Could not find tableId for created reservation.");

    const listByIntuiposBefore = await listByIntuiposRaw(Number(tableId));
    summary.steps.push({
      name: "list-intuipos-before-cancel",
      ok: listByIntuiposBefore.ok,
      status: listByIntuiposBefore.status,
      count: reservationListCount(listByIntuiposBefore.data),
      reservations: summarizeReservationList(listByIntuiposBefore.data),
      raw: listByIntuiposBefore.data,
    });

    const cancelResponse = await request(
      "PUT",
      `${config.bases.reservation}/reservation/cancel/${reservationId}`,
      { tolerateHttpError: true },
    );
    summary.steps.push({
      name: "cancel",
      ok: cancelResponse.ok,
      status: cancelResponse.status,
      data: cancelResponse.data,
    });

    const listByIntuiposAfter = await listByIntuiposRaw(Number(tableId));
    summary.steps.push({
      name: "list-intuipos-after-cancel",
      ok: listByIntuiposAfter.ok,
      status: listByIntuiposAfter.status,
      count: reservationListCount(listByIntuiposAfter.data),
      reservations: summarizeReservationList(listByIntuiposAfter.data),
      raw: listByIntuiposAfter.data,
    });
  } finally {
    if (reservationId) {
      const cleanup = await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      );
      summary.steps.push({
        name: "final-cleanup",
        ok: cleanup.ok,
        status: cleanup.status,
        data: cleanup.data,
      });
    }
  }

  printJson(summary);
}

async function concurrentCreate() {
  requireVendor();

  const slot = await resolveCreateSlot();
  const phone = Number(env.TEST_PHONE_CREATE || "1234567805");
  const body = {
    people: numberEnv("TEST_PEOPLE", 2),
    displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox Concurrent",
    date: slot.date,
    phone,
    indicative: Number(env.TEST_INDICATIVE || 57),
    comments: env.TEST_COMMENTS || "Prueba automatizada concurrencia",
  };
  const summary = {
    slot: slot.dateTime,
    phone,
    createdReservationIds: [],
    steps: [],
  };

  try {
    const startedAt = Date.now();
    const responses = await Promise.all(
      [1, 2].map((index) =>
        request(
          "POST",
          `${config.bases.reservation}/reservation/create/${config.vendorId}`,
          {
            body: {
              ...body,
              comments: `${body.comments} | concurrent ${index}`,
            },
            tolerateHttpError: true,
          },
        ),
      ),
    );
    const elapsedMs = Date.now() - startedAt;

    responses.forEach((response, index) => {
      const reservationId = response.data?.reservation?.id_reservation;
      if (reservationId) summary.createdReservationIds.push(reservationId);
      summary.steps.push({
        name: `concurrent-create-${index + 1}`,
        ok: response.ok,
        status: response.status,
        reservationId,
        data: response.data,
      });
    });
    summary.elapsedMs = elapsedMs;

    const listByPhone = await listByPhoneRaw(phone);
    summary.steps.push({
      name: "list-phone-after-concurrent",
      ok: listByPhone.ok,
      status: listByPhone.status,
      count: reservationListCount(listByPhone.data),
      reservations: summarizeReservationList(listByPhone.data),
    });
  } finally {
    for (const reservationId of summary.createdReservationIds) {
      const cleanup = await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      );
      summary.steps.push({
        name: `cleanup-${reservationId}`,
        ok: cleanup.ok,
        status: cleanup.status,
        data: cleanup.data,
      });
    }

    const finalList = await listByPhoneRaw(phone);
    summary.steps.push({
      name: "list-phone-final",
      ok: finalList.ok,
      status: finalList.status,
      count: reservationListCount(finalList.data),
      reservations: summarizeReservationList(finalList.data),
    });
  }

  printJson(summary);
}

async function specialFields() {
  requireVendor();

  const slotsResponse = await availability({ silent: true });
  const slots = Array.isArray(slotsResponse.data)
    ? slotsResponse.data.filter((item) => item.status)
    : [];
  if (slots.length < 2) {
    throw new Error("Need at least two slots to test special fields.");
  }

  const phone = Number(env.TEST_PHONE_CREATE || "1234567806");
  const summary = {
    phone,
    createdReservationIds: [],
    steps: [],
  };
  const commentText = [
    "ALERGIAS: maní y mariscos.",
    "OCASIÓN: cumpleaños.",
    "REQUERIMIENTOS: silla de bebé, mesa tranquila.",
    "MASCOTA: perro pequeño.",
    "ZONA PREFERIDA: Salón.",
  ].join(" ");

  const variants = [
    {
      name: "structured-comments",
      slot: slots[0],
      body: {
        comments: commentText,
      },
    },
    {
      name: "extra-special-fields",
      slot: slots[1],
      body: {
        comments: "Reserva con campos especiales extra.",
        alergies: "maní y mariscos",
        allergies: "maní y mariscos",
        hasPets: 1,
        birthday: "1990-05-06",
        celebrationName: "Cumpleaños",
        celebrationComment: "Traer postre con vela",
        guest: "Invitada especial",
        commentRestaurant: "Mesa tranquila y silla de bebé",
      },
    },
  ];

  try {
    for (const [index, variant] of variants.entries()) {
      const createResponse = await request(
        "POST",
        `${config.bases.reservation}/reservation/create/${config.vendorId}`,
        {
          body: {
            people: numberEnv("TEST_PEOPLE", 2),
            displayName: `${env.TEST_DISPLAY_NAME || "Ritwal Sandbox Special"} ${variant.name}`,
            date: variant.slot.date,
            phone: phone + index,
            indicative: Number(env.TEST_INDICATIVE || 57),
            ...variant.body,
          },
          tolerateHttpError: true,
        },
      );
      const reservationId = createResponse.data?.reservation?.id_reservation;
      if (reservationId) summary.createdReservationIds.push(reservationId);
      summary.steps.push({
        name: `create-${variant.name}`,
        ok: createResponse.ok,
        status: createResponse.status,
        reservationId,
        sentBody: variant.body,
        data: createResponse.data,
      });
    }

    const dateList = await request("POST", `${config.bases.reservation}/reservation/list`, {
      body: {
        vendorId: config.vendorId,
        date: env.TEST_DATE || tomorrowBogota(),
      },
    });
    const created = reservationListItems(dateList.data)
      .filter((item) => summary.createdReservationIds.includes(item.reservationId))
      .map((item) => pickSpecialFields(item));
    summary.steps.push({
      name: "list-date-special-results",
      ok: dateList.ok,
      status: dateList.status,
      reservations: created,
    });
  } finally {
    for (const reservationId of summary.createdReservationIds) {
      const cleanup = await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      );
      summary.steps.push({
        name: `cleanup-${reservationId}`,
        ok: cleanup.ok,
        status: cleanup.status,
        data: cleanup.data,
      });
    }
  }

  printJson(summary);
}

async function latencyWrite() {
  requireVendor();
  const iterations = numberEnv("LATENCY_ITERATIONS", 3);
  const slot = await resolveCreateSlot();
  const phoneBase = Number(env.TEST_PHONE_CREATE || "1234567808");
  const samples = [];

  for (let index = 0; index < iterations; index += 1) {
    let reservationId;
    const createStartedAt = Date.now();
    const createResponse = await request(
      "POST",
      `${config.bases.reservation}/reservation/create/${config.vendorId}`,
      {
        body: {
          people: numberEnv("TEST_PEOPLE", 2),
          displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox Latency",
          date: slot.date,
          phone: phoneBase + index,
          indicative: Number(env.TEST_INDICATIVE || 57),
          comments: `Prueba automatizada latencia ${index + 1}`,
        },
        tolerateHttpError: true,
      },
    );
    const createMs = Date.now() - createStartedAt;
    reservationId = createResponse.data?.reservation?.id_reservation;

    let cancelMs = null;
    let cancelResponse = null;
    if (reservationId) {
      const cancelStartedAt = Date.now();
      cancelResponse = await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      );
      cancelMs = Date.now() - cancelStartedAt;
    }

    samples.push({
      iteration: index + 1,
      reservationId,
      create: {
        ok: createResponse.ok,
        status: createResponse.status,
        ms: createMs,
      },
      cancel: cancelResponse
        ? {
            ok: cancelResponse.ok,
            status: cancelResponse.status,
            ms: cancelMs,
          }
        : null,
    });
  }

  printJson({
    slot: slot.dateTime,
    iterations,
    create: summarizeDurations(samples.map((sample) => sample.create.ms)),
    cancel: summarizeDurations(
      samples.map((sample) => sample.cancel?.ms).filter((value) => value !== null),
    ),
    samples,
  });
}

async function partialUpdate() {
  requireVendor();

  const slotsResponse = await availability({ silent: true });
  const slots = Array.isArray(slotsResponse.data)
    ? slotsResponse.data.filter((item) => item.status)
    : [];
  if (slots.length < 2) {
    throw new Error("Need at least two slots to test partial updates.");
  }

  const phone = Number(env.TEST_PHONE_CREATE || "1234567809");
  const summary = {
    initialSlot: slots[0].dateTime,
    secondSlot: slots[1].dateTime,
    phone,
    steps: [],
  };
  let reservationId;

  try {
    const createResponse = await request(
      "POST",
      `${config.bases.reservation}/reservation/create/${config.vendorId}`,
      {
        body: {
          people: 2,
          displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox Partial Update",
          date: slots[0].date,
          phone,
          indicative: Number(env.TEST_INDICATIVE || 57),
          comments: "Reserva inicial para partial update",
        },
      },
    );
    reservationId = createResponse.data?.reservation?.id_reservation;
    summary.reservationId = reservationId;
    summary.steps.push({
      name: "create",
      ok: createResponse.ok,
      status: createResponse.status,
      reservationId,
    });
    if (!reservationId) throw new Error("Create succeeded but did not return id_reservation.");

    const updates = [
      {
        name: "comments-only",
        body: { comments: "Solo cambio comentarios" },
      },
      {
        name: "people-only",
        body: { people: 3 },
      },
      {
        name: "displayName-only",
        body: { displayName: "Ritwal Sandbox Nombre Actualizado" },
      },
      {
        name: "phone-only",
        body: { phone: phone + 1 },
      },
      {
        name: "date-only",
        body: { date: slots[1].date },
      },
    ];

    for (const update of updates) {
      const response = await request(
        "PUT",
        `${config.bases.reservation}/reservation/update/${reservationId}`,
        {
          body: update.body,
          tolerateHttpError: true,
        },
      );
      summary.steps.push({
        name: `update-${update.name}`,
        sentBody: update.body,
        ok: response.ok,
        status: response.status,
        data: response.data,
      });
    }

    const dateList = await request("POST", `${config.bases.reservation}/reservation/list`, {
      body: {
        vendorId: config.vendorId,
        date: env.TEST_DATE || tomorrowBogota(),
      },
    });
    const found = reservationListItems(dateList.data).find(
      (item) => item.reservationId === reservationId,
    );
    summary.steps.push({
      name: "list-date-after-partial-updates",
      ok: dateList.ok,
      status: dateList.status,
      reservation: found
        ? {
            reservationId: found.reservationId,
            displayName: found.displayName,
            people: found.people,
            phone: found.phone,
            comments: found.comments,
            fechaCompleta: found.fechaCompleta,
            status: found.status,
          }
        : null,
    });
  } finally {
    if (reservationId) {
      const cleanup = await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      );
      summary.steps.push({
        name: "cleanup",
        ok: cleanup.ok,
        status: cleanup.status,
        data: cleanup.data,
      });
    }
  }

  printJson(summary);
}

async function confirmState() {
  requireVendor();

  const slot = await resolveCreateSlot();
  const phone = Number(env.TEST_PHONE_CREATE || "1234567812");
  const summary = {
    slot: slot.dateTime,
    phone,
    steps: [],
  };
  let reservationId;

  try {
    const createResponse = await request(
      "POST",
      `${config.bases.reservation}/reservation/create/${config.vendorId}`,
      {
        body: {
          people: numberEnv("TEST_PEOPLE", 2),
          displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox Confirm State",
          date: slot.date,
          phone,
          indicative: Number(env.TEST_INDICATIVE || 57),
          comments: env.TEST_COMMENTS || "Prueba automatizada confirm state",
        },
      },
    );
    reservationId = createResponse.data?.reservation?.id_reservation;
    summary.reservationId = reservationId;
    summary.steps.push({
      name: "create",
      ok: createResponse.ok,
      status: createResponse.status,
      reservationId,
      createResponseStatus: createResponse.data?.message,
    });

    summary.steps.push(await snapshotReservationState("before-confirm", phone, reservationId));

    const confirmResponse = await request(
      "PUT",
      `${config.bases.reservation}/reservation/confirm/${reservationId}`,
      { tolerateHttpError: true },
    );
    summary.steps.push({
      name: "confirm",
      ok: confirmResponse.ok,
      status: confirmResponse.status,
      data: confirmResponse.data,
    });

    summary.steps.push(await snapshotReservationState("after-confirm", phone, reservationId));
  } finally {
    if (reservationId) {
      const cleanup = await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      );
      summary.steps.push({
        name: "cleanup",
        ok: cleanup.ok,
        status: cleanup.status,
        data: cleanup.data,
      });
    }
  }

  printJson(summary);
}

async function partyComposition() {
  requireVendor();

  const slot = await resolveCreateSlot();
  const phone = Number(env.TEST_PHONE_CREATE || "1234567813");
  const summary = {
    slot: slot.dateTime,
    phone,
    steps: [],
  };
  let reservationId;

  try {
    const createBody = {
      people: numberEnv("TEST_PEOPLE", 4),
      adult: numberEnv("TEST_ADULT", 2),
      boy: numberEnv("TEST_BOY", 1),
      baby: numberEnv("TEST_BABY", 1),
      displayName: env.TEST_DISPLAY_NAME || "Ritwal Sandbox Party Composition",
      date: slot.date,
      phone,
      indicative: Number(env.TEST_INDICATIVE || 57),
      comments: env.TEST_COMMENTS || "Prueba automatizada composicion grupo",
    };
    const createResponse = await request(
      "POST",
      `${config.bases.reservation}/reservation/create/${config.vendorId}`,
      {
        body: createBody,
        tolerateHttpError: true,
      },
    );
    reservationId = createResponse.data?.reservation?.id_reservation;
    summary.reservationId = reservationId;
    summary.steps.push({
      name: "create",
      sentBody: createBody,
      ok: createResponse.ok,
      status: createResponse.status,
      data: createResponse.data,
    });

    const dateList = await request("POST", `${config.bases.reservation}/reservation/list`, {
      body: {
        vendorId: config.vendorId,
        date: env.TEST_DATE || tomorrowBogota(),
      },
    });
    const found = reservationListItems(dateList.data).find(
      (item) => item.reservationId === reservationId,
    );
    summary.steps.push({
      name: "list-date-party-composition",
      ok: dateList.ok,
      status: dateList.status,
      reservation: found
        ? {
            reservationId: found.reservationId,
            people: found.people,
            adult: found.adult,
            boy: found.boy,
            baby: found.baby,
            comments: found.comments,
            status: found.status,
          }
        : null,
    });
  } finally {
    if (reservationId) {
      const cleanup = await request(
        "PUT",
        `${config.bases.reservation}/reservation/cancel/${reservationId}`,
        { tolerateHttpError: true },
      );
      summary.steps.push({
        name: "cleanup",
        ok: cleanup.ok,
        status: cleanup.status,
        data: cleanup.data,
      });
    }
  }

  printJson(summary);
}

async function updateReservation() {
  requireEnv("TEST_RESERVATION_ID", env.TEST_RESERVATION_ID);

  const body = {};
  if (env.TEST_PEOPLE) body.people = Number(env.TEST_PEOPLE);
  if (env.TEST_DISPLAY_NAME) body.displayName = env.TEST_DISPLAY_NAME;
  if (env.TEST_RESERVATION_EPOCH_MS) {
    body.date = Number(env.TEST_RESERVATION_EPOCH_MS);
  }
  if (env.TEST_EMAIL) body.email = env.TEST_EMAIL;
  if (env.TEST_PHONE_CREATE) body.phone = Number(env.TEST_PHONE_CREATE);
  if (env.TEST_INDICATIVE) body.indicative = Number(env.TEST_INDICATIVE);
  if (env.TEST_BALANCE_PAID) body.balancePaid = Number(env.TEST_BALANCE_PAID);
  if (env.TEST_COMMENTS) body.comments = env.TEST_COMMENTS;

  if (Object.keys(body).length === 0) {
    throw new Error("No update fields set. Add TEST_* values before update.");
  }

  printJson(
    await request(
      "PUT",
      `${config.bases.reservation}/reservation/update/${env.TEST_RESERVATION_ID}`,
      { body },
    ),
  );
}

async function cancelReservation(id, { print = true } = {}) {
  requireEnv("reservation id", id);
  const response = await request(
    "PUT",
    `${config.bases.reservation}/reservation/cancel/${id}`,
  );
  if (print) printJson(response);
  return response;
}

async function confirmReservation(id) {
  requireEnv("TEST_RESERVATION_ID", id);
  printJson(
    await request(
      "PUT",
      `${config.bases.reservation}/reservation/confirm/${id}`,
    ),
  );
}

async function refreshApiKey() {
  printJson(await request("GET", `${config.bases.webservice}/refresh`));
  console.error(
    "\nPrecompro returned a rotated apiKey. Update .env/deployment secrets immediately and store the old key only for audit if required.",
  );
}

async function resolveCreateSlot() {
  if (env.TEST_RESERVATION_EPOCH_MS) {
    return {
      date: Number(env.TEST_RESERVATION_EPOCH_MS),
      paymentInfo: env.TEST_BALANCE_PAID
        ? { total: Number(env.TEST_BALANCE_PAID) }
        : undefined,
    };
  }

  const availabilityResponse = await availability({ silent: true });
  const slots = availabilityResponse.data;
  const slot = Array.isArray(slots) ? slots.find((item) => item.status) : null;
  if (!slot) {
    throw new Error(
      "No available slot found. Set TEST_RESERVATION_EPOCH_MS manually or try another TEST_DATE.",
    );
  }
  return slot;
}

async function request(method, url, options = {}) {
  const headers = {
    apiKey: config.apiKey,
    Accept: "application/json",
  };
  const fetchOptions = { method, headers };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);
  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok && !options.tolerateHttpError) {
    const error = new Error(`${method} ${url} failed with HTTP ${response.status}`);
    error.details = data || text;
    throw error;
  }

  return {
    ok: response.ok,
    status: response.status,
    url,
    data,
  };
}

async function measureProbe(name, fn, iterations) {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = Date.now();
    const response = await fn();
    samples.push({
      iteration: index + 1,
      ok: response.ok,
      status: response.status,
      ms: Date.now() - startedAt,
    });
  }
  return {
    name,
    iterations,
    ...summarizeDurations(samples.map((sample) => sample.ms)),
    samples,
  };
}

function summarizeDurations(values) {
  if (!values.length) return { minMs: null, avgMs: null, maxMs: null };
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    minMs: Math.min(...values),
    avgMs: Math.round(sum / values.length),
    maxMs: Math.max(...values),
  };
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function reservationListItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function reservationListCount(data) {
  return reservationListItems(data).length;
}

function summarizeReservationList(data) {
  return reservationListItems(data).map((item) => ({
    id: item.id_reservation,
    displayName: item.displayName,
    people: item.people,
    status: item.status,
    fechaCompleta: item.fechaCompleta,
  }));
}

function summarizeAvailabilitySlot(response, epochMs) {
  const items = Array.isArray(response.data) ? response.data : [];
  const slot = items.find((item) => item.date === epochMs);
  return slot
    ? {
        dateTime: slot.dateTime,
        status: slot.status,
        validation: slot.validation,
        paymentInfo: slot.paymentInfo || null,
      }
    : null;
}

function summarizeAvailabilityResponse(data) {
  if (!Array.isArray(data)) return data;
  return {
    count: data.length,
    availableCount: data.filter((item) => item.status).length,
    first: data[0] || null,
    last: data.at(-1) || null,
  };
}

function pickSpecialFields(item) {
  return {
    reservationId: item.reservationId,
    displayName: item.displayName,
    phone: item.phone,
    fechaCompleta: item.fechaCompleta,
    comments: item.comments,
    alergies: item.alergies,
    allergies: item.allergies,
    hasPets: item.hasPets,
    birthday: item.birthday,
    celebrationName: item.celebrationName,
    celebrationComment: item.celebrationComment,
    guest: item.guest,
    commentRestaurant: item.commentRestaurant,
    vendorComments: item.vendorComments,
    status: item.status,
  };
}

function countBy(items, getKey) {
  return items.reduce((accumulator, item) => {
    const key = getKey(item);
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function summarizeDateReservation(item) {
  return {
    reservationId: item.reservationId,
    displayName: item.displayName,
    phone: item.phone,
    people: item.people,
    fechaCompleta: item.fechaCompleta,
    status: item.status,
    codeStatus: item.codeStatus,
    isCancelled: item.isCancelled,
    isUserConfirmed: item.isUserConfirmed,
    sectionName: item.sectionName,
    tableName: item.tableName,
  };
}

async function snapshotReservationState(name, phone, reservationId) {
  const phoneList = await listByPhoneRaw(phone);
  const dateList = await request("POST", `${config.bases.reservation}/reservation/list`, {
    body: {
      vendorId: config.vendorId,
      date: env.TEST_DATE || tomorrowBogota(),
    },
  });
  const phoneReservation = reservationListItems(phoneList.data).find(
    (item) => item.id_reservation === reservationId,
  );
  const dateReservation = reservationListItems(dateList.data).find(
    (item) => item.reservationId === reservationId,
  );

  return {
    name,
    phoneList: {
      ok: phoneList.ok,
      status: phoneList.status,
      reservation: phoneReservation
        ? {
            id_reservation: phoneReservation.id_reservation,
            status: phoneReservation.status,
            fechaCompleta: phoneReservation.fechaCompleta,
            updated_at: phoneReservation.updated_at,
          }
        : null,
    },
    dateList: {
      ok: dateList.ok,
      status: dateList.status,
      reservation: dateReservation
        ? {
            reservationId: dateReservation.reservationId,
            status: dateReservation.status,
            codeStatus: dateReservation.codeStatus,
            isConfirmed: dateReservation.isConfirmed,
            isUserConfirmed: dateReservation.isUserConfirmed,
            isCancelled: dateReservation.isCancelled,
            fechaCompleta: dateReservation.fechaCompleta,
            updated_at: dateReservation.updated_at,
          }
        : null,
    },
  };
}


function omit(object, key) {
  const next = { ...object };
  delete next[key];
  return next;
}

function loadDotEnv() {
  if (!existsSync(".env")) return;
  const lines = readFileSync(".env", "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function requireVendor() {
  requireEnv("PRECOMPRO_VENDOR_ID", config.vendorId);
}

function requireEnv(name, value) {
  if (!value) throw new Error(`${name} is required.`);
}

function numberEnv(name, fallback) {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (Number.isNaN(number)) throw new Error(`${name} must be a number.`);
  return number;
}

function todayBogota() {
  return formatBogotaDate(new Date());
}

function tomorrowBogota() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return formatBogotaDate(date);
}

function bogotaDateTimeToEpochMs(date, time) {
  const iso = `${date}T${time}-05:00`;
  const epochMs = Date.parse(iso);
  if (Number.isNaN(epochMs)) {
    throw new Error(`Invalid Bogota datetime: ${date} ${time}`);
  }
  return epochMs;
}

function formatBogotaDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`Precompro smoke tests

Setup:
  cp .env.example .env
  # Fill PRECOMPRO_API_KEY and PRECOMPRO_VENDOR_ID

Read-only:
  npm run precompro -- read
  npm run precompro -- vendor
  npm run precompro -- sections
  npm run precompro -- availability
  npm run precompro -- availability-invalid-dates
  npm run precompro -- latency
  npm run precompro -- list-date
  npm run precompro -- list-date-summary
  npm run precompro -- list-phone
  npm run precompro -- list-intuipos

Write tests, guarded:
  RUN_WRITE_TESTS=true npm run precompro -- create
  RUN_WRITE_TESTS=true npm run precompro -- lifecycle
  RUN_WRITE_TESTS=true npm run precompro -- create-unavailable
  RUN_WRITE_TESTS=true npm run precompro -- multi-phone
  RUN_WRITE_TESTS=true npm run precompro -- invalid-payloads
  RUN_WRITE_TESTS=true npm run precompro -- email
  RUN_WRITE_TESTS=true npm run precompro -- update-unavailable
  RUN_WRITE_TESTS=true npm run precompro -- duplicate-slot
  RUN_WRITE_TESTS=true npm run precompro -- operation-edges
  RUN_WRITE_TESTS=true npm run precompro -- create-zone-fields
  RUN_WRITE_TESTS=true npm run precompro -- intuipos-flow
  RUN_WRITE_TESTS=true npm run precompro -- concurrent-create
  RUN_WRITE_TESTS=true npm run precompro -- special-fields
  RUN_WRITE_TESTS=true npm run precompro -- latency-write
  RUN_WRITE_TESTS=true npm run precompro -- partial-update
  RUN_WRITE_TESTS=true npm run precompro -- confirm-state
  RUN_WRITE_TESTS=true npm run precompro -- party-composition
  RUN_WRITE_TESTS=true npm run precompro -- update
  RUN_WRITE_TESTS=true npm run precompro -- cancel
  RUN_WRITE_TESTS=true npm run precompro -- confirm

Credential rotation, guarded:
  RUN_REFRESH_TESTS=true npm run precompro -- refresh
`);
}
