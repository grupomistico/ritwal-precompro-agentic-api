import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdempotencyStore, InMemoryLock } from "../src/locks.js";
import { ReservationService } from "../src/services/reservations.js";
import { bogotaDateTimeToEpochMs } from "../src/utils/datetime.js";

const config = {
  precompro: {
    vendorId: "vendor-test",
  },
  defaults: {
    countryCode: 57,
    maxAutomaticPartySize: 18,
    requestTimeoutMs: 8000,
    idempotencyTtlMs: 600000,
    lockTtlMs: 15000,
  },
};

const TEST_DATE = "2099-05-06";
const TEST_AMBIGUOUS_DATE = "05-06-2099";
const TEST_TIME = "12:00";
const TEST_TIME_2 = "12:30";
const TEST_DATE_TIME = `${TEST_DATE} ${TEST_TIME}:00`;
const TEST_DATE_TIME_2 = `${TEST_DATE} ${TEST_TIME_2}:00`;
const TEST_RESERVATION_ID = "20990506-test-reservation";

describe("ReservationService.create", () => {
  let client;
  let service;
  let epochMs;

  beforeEach(() => {
    epochMs = bogotaDateTimeToEpochMs(TEST_DATE, TEST_TIME);
    client = {
      getAvailability: vi.fn(async () => ({
        ok: true,
        status: 200,
        data: [
          {
            date: epochMs,
            dateTime: TEST_DATE_TIME,
            status: true,
            validation: "checkDefault",
          },
        ],
      })),
      listReservations: vi.fn(async () => ({
        ok: true,
        status: 200,
        data: [],
      })),
      createReservation: vi.fn(async () => ({
        ok: true,
        status: 200,
        data: {
          code: 200,
          reservation: {
            id_reservation: TEST_RESERVATION_ID,
            displayName: "Maria Perez",
            phone: 3142360112,
            people: 2,
            date: epochMs,
            fecha: TEST_DATE,
            fechaCompleta: TEST_DATE_TIME,
          },
        },
      })),
    };
    service = new ReservationService({
      client,
      config,
      lock: new InMemoryLock(),
      idempotency: new IdempotencyStore(),
    });
  });

  it("rejects ambiguous dates before calling Precompro", async () => {
    await expect(
      service.create({
        displayName: "Maria Perez",
        phone: "3142360112",
        date: TEST_AMBIGUOUS_DATE,
        time: TEST_TIME,
        partySize: 2,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_DATE",
    });
    expect(client.createReservation).not.toHaveBeenCalled();
  });

  it("escalates parties above the automatic limit", async () => {
    const result = await service.create({
      displayName: "Maria Perez",
      phone: "3142360112",
      date: TEST_DATE,
      time: TEST_TIME,
      partySize: 19,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "ESCALATE_LARGE_PARTY",
      escalationRequired: true,
    });
    expect(client.createReservation).not.toHaveBeenCalled();
  });

  it("creates only after exact availability is found", async () => {
    const result = await service.create({
      displayName: "Maria Perez",
      phone: "3142360112",
      date: TEST_DATE,
      time: TEST_TIME,
      partySize: 2,
      zone: { id: 1442, name: "Salon" },
      comments: "Mesa tranquila",
    });

    expect(result).toMatchObject({
      ok: true,
      code: "RESERVATION_CREATED",
      reservation: {
        id: TEST_RESERVATION_ID,
        dateTime: TEST_DATE_TIME,
      },
    });
    expect(client.getAvailability).toHaveBeenCalledWith({
      people: 2,
      date: TEST_DATE,
      zone: 1442,
      subzone: 0,
    });
    expect(client.createReservation).toHaveBeenCalledOnce();
  });

  it.each([
    ["Salon", 1442, "Salón"],
    ["WINE GARDEN", 2190, "WINE GARDEN"],
    ["jardin", 2190, "WINE GARDEN"],
    [{ name: "Wine Garden" }, 2190, "WINE GARDEN"],
    [{ id: "2190", name: "Wine Garden" }, 2190, "Wine Garden"],
  ])("accepts zone input %j from tool callers", async (zone, zoneId, zoneName) => {
    const result = await service.availability({
      date: TEST_DATE,
      partySize: 2,
      zone,
    });

    expect(result).toMatchObject({
      ok: true,
      code: "AVAILABILITY_FOUND",
      zone: {
        id: zoneId,
        name: zoneName,
      },
    });
    expect(client.getAvailability).toHaveBeenCalledWith({
      people: 2,
      date: TEST_DATE,
      zone: zoneId,
      subzone: 0,
    });
  });

  it("accepts explicit zone zero as no specific zone", async () => {
    const result = await service.availability({
      date: TEST_DATE,
      partySize: 2,
      zone: 0,
    });

    expect(result).toMatchObject({
      ok: true,
      code: "AVAILABILITY_FOUND",
      zone: {
        id: 0,
      },
    });
    expect(client.getAvailability).toHaveBeenCalledWith({
      people: 2,
      date: TEST_DATE,
      zone: 0,
      subzone: 0,
    });
  });

  it("normalizes tool caller strings before checking availability", async () => {
    const result = await service.availability({
      date: TEST_DATE,
      time: "12pm",
      partySize: "2",
    });

    expect(result).toMatchObject({
      ok: true,
      code: "AVAILABILITY_FOUND",
      requestedTime: "12:00",
      exactTimeAvailable: true,
      partySize: 2,
    });
    expect(client.getAvailability).toHaveBeenCalledWith({
      people: 2,
      date: TEST_DATE,
      zone: 0,
      subzone: 0,
    });
  });

  it("marks requested exact time unavailable when no returned slot matches", async () => {
    const result = await service.availability({
      date: TEST_DATE,
      time: "8pm",
      partySize: "2",
    });

    expect(result).toMatchObject({
      requestedTime: "20:00",
      exactTimeAvailable: false,
      availableCount: 1,
    });
  });

  it("normalizes tool caller strings before creating a reservation", async () => {
    const result = await service.create({
      displayName: "Maria Perez",
      phone: "3142360112",
      date: TEST_DATE,
      time: "12pm",
      partySize: "2",
    });

    expect(result).toMatchObject({
      ok: true,
      code: "RESERVATION_CREATED",
      reservation: {
        dateTime: TEST_DATE_TIME,
      },
    });
    expect(client.getAvailability).toHaveBeenCalledWith({
      people: 2,
      date: TEST_DATE,
      zone: 0,
      subzone: 0,
    });
  });

  it("reuses idempotency results for repeated create requests", async () => {
    const body = {
      displayName: "Maria Perez",
      phone: "3142360112",
      date: TEST_DATE,
      time: TEST_TIME,
      partySize: 2,
      idempotencyKey: "same-client-attempt",
    };

    const first = await service.create(body);
    const second = await service.create(body);

    expect(first).toEqual(second);
    expect(client.createReservation).toHaveBeenCalledOnce();
  });

  it("blocks duplicates by phone and exact timestamp", async () => {
    client.listReservations.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [
        {
          id_reservation: "existing-reservation",
          displayName: "Maria Perez",
          phone: 3142360112,
          people: 2,
          date: epochMs,
          fechaCompleta: TEST_DATE_TIME,
          status: "confirmada",
        },
      ],
    });

    const result = await service.create({
      displayName: "Maria Perez",
      phone: "3142360112",
      date: TEST_DATE,
      time: TEST_TIME,
      partySize: 2,
    });

    expect(result).toMatchObject({
      ok: true,
      code: "RESERVATION_ALREADY_EXISTS",
      duplicate: true,
      reservation: {
        id: "existing-reservation",
      },
    });
    expect(client.getAvailability).not.toHaveBeenCalled();
    expect(client.createReservation).not.toHaveBeenCalled();
  });

  it("rejects selected times that are not available", async () => {
    client.getAvailability.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [
        {
          date: epochMs,
          dateTime: TEST_DATE_TIME,
          status: false,
        },
        {
          date: bogotaDateTimeToEpochMs(TEST_DATE, TEST_TIME_2),
          dateTime: TEST_DATE_TIME_2,
          status: true,
        },
      ],
    });

    await expect(
      service.create({
        displayName: "Maria Perez",
        phone: "3142360112",
        date: TEST_DATE,
        time: TEST_TIME,
        partySize: 2,
      }),
    ).rejects.toMatchObject({
      code: "SLOT_NOT_AVAILABLE",
      statusCode: 409,
    });
    expect(client.createReservation).not.toHaveBeenCalled();
  });
});

describe("ReservationService.availability", () => {
  it("escalates large parties without calling Precompro", async () => {
    const client = {
      getAvailability: vi.fn(),
    };
    const service = new ReservationService({
      client,
      config,
      lock: new InMemoryLock(),
      idempotency: new IdempotencyStore(),
    });

    const result = await service.availability({
      date: TEST_DATE,
      partySize: 19,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "ESCALATE_LARGE_PARTY",
    });
    expect(client.getAvailability).not.toHaveBeenCalled();
  });
});

describe("ReservationService reporting", () => {
  function buildService(client) {
    return new ReservationService({
      client,
      config,
      lock: new InMemoryLock(),
      idempotency: new IdempotencyStore(),
    });
  }

  it("lists reservations by date with active and cancelled summaries separated", async () => {
    const client = {
      listReservations: vi.fn(async () => ({
        ok: true,
        status: 200,
        data: [
          reservationForReport({
            id: "active-1",
            people: 2,
            status: "Finalizada",
            sectionName: "Salón",
            tableName: "Mesa 1",
            created_at: "2026-06-10 08:00:00",
            comments:
              "Mesa tranquila ALERGIAS: mani. OCASION: cumpleaños. ZONA PREFERIDA: Salón.",
          }),
          reservationForReport({
            id: "no-show-1",
            people: 1,
            status: "No Llego",
          }),
          reservationForReport({
            id: "cancelled-1",
            people: 4,
            status: "Cancelada",
            isCancelled: true,
          }),
        ],
      })),
    };
    const service = buildService(client);

    const result = await service.listByDate({ date: "2026-06-15" });

    expect(client.listReservations).toHaveBeenCalledWith({ date: "2026-06-15" });
    expect(result).toMatchObject({
      ok: true,
      code: "RESERVATIONS_BY_DATE_FOUND",
      summary: {
        date: "2026-06-15",
        totalReservations: 3,
        activeReservations: 2,
        completedReservations: 1,
        noShowReservations: 1,
        cancelledReservations: 1,
        totalPeople: 7,
        activePeople: 3,
        completedPeople: 2,
        noShowPeople: 1,
        cancelledPeople: 4,
      },
    });
    expect(result.reservations).toHaveLength(3);
    expect(result.reservations[0]).toMatchObject({
      reservationHour: "12:00",
      weekday: "lunes",
      weekdayNumber: 1,
      partyBucket: "1-2",
      sectionName: "Salón",
      tableName: "Mesa 1",
      createdAt: "2026-06-10 08:00:00",
      commentsStructured: {
        notes: "Mesa tranquila",
        allergies: "mani",
        occasion: "cumpleaños",
        preferredZoneName: "Salón",
      },
    });
  });

  it("can exclude cancelled reservations from date reports", async () => {
    const client = {
      listReservations: vi.fn(async () => ({
        ok: true,
        status: 200,
        data: [
          reservationForReport({ id: "active-1", people: 2 }),
          reservationForReport({
            id: "cancelled-1",
            people: 4,
            status: "Cancelada",
            isCancelled: true,
          }),
        ],
      })),
    };
    const service = buildService(client);

    const result = await service.listByDate({
      date: "2026-06-15",
      includeCancelled: false,
    });

    expect(result.summary).toMatchObject({
      totalReservations: 1,
      activeReservations: 1,
      cancelledReservations: 0,
      totalPeople: 2,
      activePeople: 2,
      cancelledPeople: 0,
    });
    expect(result.reservations).toHaveLength(1);
  });

  it("summarizes reservation ranges even when reservation details are omitted", async () => {
    const byDate = {
      "2026-06-15": [
        reservationForReport({ id: "d1-active", people: 2, date: "2026-06-15" }),
        reservationForReport({
          id: "d1-cancelled",
          people: 3,
          date: "2026-06-15",
          status: "Cancelada",
          isCancelled: true,
        }),
      ],
      "2026-06-16": [
        reservationForReport({ id: "d2-active", people: 5, date: "2026-06-16" }),
      ],
    };
    const client = {
      listReservations: vi.fn(async ({ date }) => ({
        ok: true,
        status: 200,
        data: byDate[date] || [],
      })),
    };
    const service = buildService(client);

    const result = await service.listRange({
      from: "2026-06-15",
      to: "2026-06-16",
      includeReservations: false,
    });

    expect(client.listReservations).toHaveBeenNthCalledWith(1, { date: "2026-06-15" });
    expect(client.listReservations).toHaveBeenNthCalledWith(2, { date: "2026-06-16" });
    expect(result).toMatchObject({
      ok: true,
      code: "RESERVATIONS_RANGE_FOUND",
      daysCount: 2,
      includeReservations: false,
      summary: {
        totalReservations: 3,
        activeReservations: 2,
        completedReservations: 2,
        noShowReservations: 0,
        cancelledReservations: 1,
        totalPeople: 10,
        activePeople: 7,
        completedPeople: 7,
        noShowPeople: 0,
        cancelledPeople: 3,
      },
      days: [
        {
          date: "2026-06-15",
          summary: {
            totalReservations: 2,
            activeReservations: 1,
            completedReservations: 1,
            noShowReservations: 0,
            cancelledReservations: 1,
            totalPeople: 5,
            activePeople: 2,
            completedPeople: 2,
            noShowPeople: 0,
            cancelledPeople: 3,
          },
        },
        {
          date: "2026-06-16",
          summary: {
            totalReservations: 1,
            activeReservations: 1,
            completedReservations: 1,
            noShowReservations: 0,
            cancelledReservations: 0,
            totalPeople: 5,
            activePeople: 5,
            completedPeople: 5,
            noShowPeople: 0,
            cancelledPeople: 0,
          },
        },
      ],
    });
    expect(result.days[0]).not.toHaveProperty("reservations");
    expect(result.days[1]).not.toHaveProperty("reservations");
  });

  it("rejects reservation ranges over 31 days", async () => {
    const service = buildService({ listReservations: vi.fn() });

    await expect(
      service.listRange({ from: "2026-06-01", to: "2026-07-02" }),
    ).rejects.toMatchObject({
      code: "DATE_RANGE_TOO_LARGE",
      statusCode: 400,
    });
  });

  it("builds grouped reports without guest PII", async () => {
    const byDate = {
      "2026-06-15": [
        reservationForReport({
          id: "d1-completed",
          people: 2,
          date: "2026-06-15",
          status: "Finalizada",
          sectionName: "Salón",
        }),
        reservationForReport({
          id: "d1-noshow",
          people: 3,
          date: "2026-06-15",
          status: "No Llego",
          sectionName: "Salón",
        }),
        reservationForReport({
          id: "d1-cancelled",
          people: 4,
          date: "2026-06-15",
          status: "Cancelada",
          isCancelled: true,
          sectionName: "Templos",
        }),
      ],
      "2026-06-16": [
        reservationForReport({
          id: "d2-completed",
          people: 5,
          date: "2026-06-16",
          status: "Finalizada",
          sectionName: "WINE GARDEN",
        }),
      ],
    };
    const client = {
      listReservations: vi.fn(async ({ date }) => ({
        ok: true,
        status: 200,
        data: byDate[date] || [],
      })),
    };
    const service = buildService(client);

    const result = await service.report({
      from: "2026-06-15",
      to: "2026-06-16",
      groupBy: ["date", "lifecycle"],
      filters: { sectionName: "Salón" },
    });

    expect(result).toMatchObject({
      ok: true,
      code: "RESERVATION_REPORT_READY",
      groupBy: ["date", "lifecycle"],
      filters: { sectionName: ["Salón"] },
      summary: {
        totalReservations: 2,
        activeReservations: 2,
        completedReservations: 1,
        noShowReservations: 1,
        totalPeople: 5,
        completedPeople: 2,
        noShowPeople: 3,
      },
    });
    expect(result.groups).toEqual([
      {
        key: { date: "2026-06-15", lifecycle: "completed" },
        label: "date: 2026-06-15 | lifecycle: completed",
        summary: expect.objectContaining({
          totalReservations: 1,
          completedReservations: 1,
          completedPeople: 2,
        }),
      },
      {
        key: { date: "2026-06-15", lifecycle: "noShow" },
        label: "date: 2026-06-15 | lifecycle: noShow",
        summary: expect.objectContaining({
          totalReservations: 1,
          noShowReservations: 1,
          noShowPeople: 3,
        }),
      },
    ]);
    expect(JSON.stringify(result.groups)).not.toContain("Maria Perez");
    expect(JSON.stringify(result.groups)).not.toContain("3142360112");
  });
});

function reservationForReport({
  id,
  people,
  status = "Finalizada",
  isCancelled = false,
  date = "2026-06-15",
  time = "12:00",
  ...overrides
}) {
  const dateTime = `${date} ${time}:00`;
  return {
    id_reservation: id,
    displayName: "Maria Perez",
    phone: 3142360112,
    people,
    date: bogotaDateTimeToEpochMs(date, time),
    fecha: date,
    fechaCompleta: dateTime,
    status,
    isCancelled,
    ...overrides,
  };
}
