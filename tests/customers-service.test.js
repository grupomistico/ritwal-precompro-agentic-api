import { describe, expect, it, vi } from "vitest";
import { CustomerService } from "../src/services/customers.js";

const config = {
  defaults: {
    countryCode: 57,
  },
};

describe("CustomerService", () => {
  function buildService(byDate) {
    const reservationService = {
      getReservationsByDate: vi.fn(async (date) => byDate[date] || []),
    };
    return {
      reservationService,
      service: new CustomerService({ reservationService, config }),
    };
  }

  it("segments customers who reserved and cancelled", async () => {
    const { service, reservationService } = buildService({
      "2026-06-01": [
        reservation({
          id: "alice-1",
          displayName: "Alice Perez",
          phone: "573001112233",
          email: "alice@example.com",
          status: "Finalizada",
          completed: true,
          people: 2,
          date: "2026-06-01",
          sectionName: "Salón",
        }),
        reservation({
          id: "alice-2",
          displayName: "Alice Perez",
          phone: "573001112233",
          email: "alice@example.com",
          status: "Cancelada",
          cancelled: true,
          people: 4,
          date: "2026-06-01",
          sectionName: "Salón",
        }),
        reservation({
          id: "bob-1",
          displayName: "Bob Mora",
          phone: "573009998877",
          email: "bob@example.com",
          status: "Finalizada",
          completed: true,
          people: 3,
          date: "2026-06-01",
          sectionName: "Templos",
        }),
      ],
      "2026-06-02": [
        reservation({
          id: "alice-3",
          displayName: "Alice Perez",
          phone: "573001112233",
          email: "alice@example.com",
          status: "Finalizada",
          completed: true,
          people: 2,
          date: "2026-06-02",
          sectionName: "WINE GARDEN",
        }),
      ],
    });

    const result = await service.segment({
      from: "2026-06-01",
      to: "2026-06-02",
      criteria: {
        minCancelledReservations: 1,
      },
      includeReservations: true,
    });

    expect(reservationService.getReservationsByDate).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      ok: true,
      code: "CUSTOMER_SEGMENT_READY",
      internalOnly: true,
      pii: true,
      scanned: {
        daysCount: 2,
        reservationsCount: 4,
        customerCount: 2,
      },
      pagination: {
        totalCustomers: 1,
        returnedCustomers: 1,
      },
    });
    expect(result.customers[0]).toMatchObject({
      contact: {
        displayName: "Alice Perez",
        phone: "573001112233",
        email: "alice@example.com",
        marketingEligible: true,
        marketingConsent: "assumed_opt_in_precompro",
      },
      metrics: {
        totalReservations: 3,
        completedReservations: 2,
        cancelledReservations: 1,
        totalPeople: 8,
        completedPeople: 4,
        cancelledPeople: 4,
      },
    });
    expect(result.customers[0].reservations).toHaveLength(3);
  });

  it("finds customers with more than ten reservations in a range", async () => {
    const frequentReservations = Array.from({ length: 11 }, (_, index) =>
      reservation({
        id: `frequent-${index}`,
        displayName: "Cliente Frecuente",
        phone: "573001110000",
        email: "frequent@example.com",
        status: "Finalizada",
        completed: true,
        people: 2,
        date: "2026-06-01",
      }),
    );
    const { service } = buildService({
      "2026-06-01": [
        ...frequentReservations,
        reservation({
          id: "casual-1",
          displayName: "Cliente Casual",
          phone: "573009990000",
          email: "casual@example.com",
          status: "Finalizada",
          completed: true,
          people: 2,
          date: "2026-06-01",
        }),
      ],
    });

    const result = await service.segment({
      from: "2026-06-01",
      to: "2026-06-01",
      criteria: {
        minTotalReservations: 11,
      },
    });

    expect(result.pagination.totalCustomers).toBe(1);
    expect(result.customers[0]).toMatchObject({
      contact: {
        displayName: "Cliente Frecuente",
        phone: "573001110000",
      },
      metrics: {
        totalReservations: 11,
        completedReservations: 11,
        completedPeople: 22,
      },
    });
  });

  it("looks up a customer by phone", async () => {
    const { service } = buildService({
      "2026-06-01": [
        reservation({
          id: "target-1",
          displayName: "Cliente Objetivo",
          phone: "573001234567",
          email: "target@example.com",
          date: "2026-06-01",
        }),
        reservation({
          id: "other-1",
          displayName: "Otro Cliente",
          phone: "573007654321",
          email: "other@example.com",
          date: "2026-06-01",
        }),
      ],
    });

    const result = await service.lookup({
      phone: "+57 300 123 4567",
      from: "2026-06-01",
      to: "2026-06-01",
    });

    expect(result).toMatchObject({
      ok: true,
      code: "CUSTOMERS_FOUND",
      pagination: {
        totalCustomers: 1,
      },
    });
    expect(result.customers[0].contact.email).toBe("target@example.com");
  });

  it("filters customer segments by reported country", async () => {
    const { service } = buildService({
      "2026-06-01": [
        reservation({
          id: "canada-1",
          displayName: "Claire Maple",
          phone: "14165550100",
          email: "claire@example.ca",
          countryCode: "1",
          country: "Canada",
          date: "2026-06-01",
        }),
        reservation({
          id: "colombia-1",
          displayName: "Carlos Ruiz",
          phone: "573001110000",
          email: "carlos@example.com",
          countryCode: "57",
          country: "Colombia",
          date: "2026-06-01",
        }),
      ],
    });

    const result = await service.segment({
      from: "2026-06-01",
      to: "2026-06-01",
      criteria: {
        country: "Canada",
      },
    });

    expect(result.pagination.totalCustomers).toBe(1);
    expect(result.customers[0].contact).toMatchObject({
      displayName: "Claire Maple",
      country: "Canada",
      countryCode: "1",
    });
  });

  it("builds customer demographics without PII by default", async () => {
    const { service } = buildService({
      "2026-06-01": [
        reservation({
          id: "canada-1",
          displayName: "Claire Maple",
          phone: "14165550100",
          email: "claire@example.ca",
          countryCode: "1",
          country: "Canada",
          people: 2,
          date: "2026-06-01",
        }),
        reservation({
          id: "canada-2",
          displayName: "Claire Maple",
          phone: "14165550100",
          email: "claire@example.ca",
          countryCode: "1",
          country: "Canada",
          people: 3,
          date: "2026-06-01",
        }),
        reservation({
          id: "colombia-1",
          displayName: "Carlos Ruiz",
          phone: "573001110000",
          email: "carlos@example.com",
          countryCode: "57",
          country: "Colombia",
          people: 4,
          date: "2026-06-01",
        }),
      ],
    });

    const result = await service.demographics({
      from: "2026-06-01",
      to: "2026-06-01",
      groupBy: ["country"],
    });

    expect(result).toMatchObject({
      ok: true,
      code: "CUSTOMER_DEMOGRAPHICS_READY",
      internalOnly: true,
      pii: false,
      summary: {
        totalCustomers: 2,
        totalReservations: 3,
        completedPeople: 9,
        colombiaCustomers: 1,
        internationalCustomers: 1,
      },
    });
    expect(result.customers).toBeUndefined();
    expect(result.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimensions: { country: "Canada" },
          totalCustomers: 1,
          totalReservations: 2,
          completedPeople: 5,
        }),
        expect.objectContaining({
          dimensions: { country: "Colombia" },
          totalCustomers: 1,
          totalReservations: 1,
          completedPeople: 4,
        }),
      ]),
    );
  });

  it("filters demographics by international locality and can include customers", async () => {
    const { service } = buildService({
      "2026-06-01": [
        reservation({
          id: "canada-1",
          displayName: "Claire Maple",
          phone: "14165550100",
          email: "claire@example.ca",
          countryCode: "1",
          country: "Canada",
          date: "2026-06-01",
        }),
        reservation({
          id: "colombia-1",
          displayName: "Carlos Ruiz",
          phone: "573001110000",
          email: "carlos@example.com",
          countryCode: "57",
          country: "Colombia",
          date: "2026-06-01",
        }),
      ],
    });

    const result = await service.demographics({
      from: "2026-06-01",
      to: "2026-06-01",
      criteria: {
        locality: "international",
      },
      groupBy: ["locality"],
      includeCustomers: true,
      limit: 10,
    });

    expect(result).toMatchObject({
      pii: true,
      summary: {
        totalCustomers: 1,
        internationalCustomers: 1,
      },
      pagination: {
        totalCustomers: 1,
        returnedCustomers: 1,
      },
    });
    expect(result.groups[0]).toMatchObject({
      dimensions: { locality: "international" },
      totalCustomers: 1,
    });
    expect(result.customers[0].contact.displayName).toBe("Claire Maple");
  });

  it("exports customer segments as CSV", async () => {
    const { service } = buildService({
      "2026-06-01": [
        reservation({
          id: "alice-1",
          displayName: "Alice Perez",
          phone: "573001112233",
          email: "alice@example.com",
          date: "2026-06-01",
          sectionName: "Salón",
        }),
      ],
    });

    const result = await service.export({
      from: "2026-06-01",
      to: "2026-06-01",
    });

    expect(result).toMatchObject({
      ok: true,
      format: "csv",
      contentType: "text/csv; charset=utf-8",
      filename: "ritwal-customers-2026-06-01-2026-06-01.csv",
    });
    expect(result.csv).toContain("displayName,phone,email");
    expect(result.csv).toContain("Alice Perez");
    expect(result.csv).toContain("alice@example.com");
  });
});

function reservation({
  id,
  displayName,
  phone,
  email,
  people = 2,
  date = "2026-06-01",
  time = "20:00",
  status = "Finalizada",
  completed = true,
  cancelled = false,
  noShow = false,
  sectionName = "Salón",
  countryCode = "57",
  country = "Colombia",
}) {
  return {
    id,
    displayName,
    phone,
    email,
    identityDocument: null,
    countryCode,
    country,
    people,
    date,
    dateTime: `${date} ${time}:00`,
    reservationHour: time,
    weekday: "lunes",
    partyBucket: people <= 2 ? "1-2" : "3-4",
    status,
    completed,
    cancelled,
    noShow,
    sectionName,
    tableName: "M1",
    source: "precompro",
    provider: "precompro",
    typeReservation: "Normal",
    paymentType: "normal",
    balancePaid: 0,
    comments: "",
    commentsStructured: null,
  };
}
