import { z } from "zod";
import { AppError } from "../errors.js";
import { assertIsoDate, normalizeDateInput } from "../utils/datetime.js";
import { normalizePhone } from "../utils/phone.js";

const MAX_PAGE_SIZE = 5000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_LOOKUP_DAYS = 365;
const CUSTOMER_SORT_FIELDS = [
  "lastReservationDate",
  "firstReservationDate",
  "totalReservations",
  "completedReservations",
  "cancelledReservations",
  "noShowReservations",
  "completedPeople",
  "totalPeople",
  "displayName",
];

const stringArraySchema = z.preprocess(
  normalizeStringArrayInput,
  z.array(z.string()).optional(),
);

const customerCriteriaSchema = z
  .object({
    minTotalReservations: z.coerce.number().int().min(0).optional(),
    maxTotalReservations: z.coerce.number().int().min(0).optional(),
    minCompletedReservations: z.coerce.number().int().min(0).optional(),
    minCancelledReservations: z.coerce.number().int().min(0).optional(),
    minNoShowReservations: z.coerce.number().int().min(0).optional(),
    minPendingReservations: z.coerce.number().int().min(0).optional(),
    minTotalPeople: z.coerce.number().int().min(0).optional(),
    minCompletedPeople: z.coerce.number().int().min(0).optional(),
    minCancelledPeople: z.coerce.number().int().min(0).optional(),
    minNoShowPeople: z.coerce.number().int().min(0).optional(),
    minCancellationRate: z.coerce.number().min(0).max(1).optional(),
    maxCancellationRate: z.coerce.number().min(0).max(1).optional(),
    minNoShowRate: z.coerce.number().min(0).max(1).optional(),
    maxNoShowRate: z.coerce.number().min(0).max(1).optional(),
    hasEmail: z.preprocess(normalizeBooleanInput, z.boolean()).optional(),
    hasPhone: z.preprocess(normalizeBooleanInput, z.boolean()).optional(),
    hasCancelled: z.preprocess(normalizeBooleanInput, z.boolean()).optional(),
    hasNoShow: z.preprocess(normalizeBooleanInput, z.boolean()).optional(),
    hasCompleted: z.preprocess(normalizeBooleanInput, z.boolean()).optional(),
    hasPending: z.preprocess(normalizeBooleanInput, z.boolean()).optional(),
    sectionName: stringArraySchema,
    tableName: stringArraySchema,
    source: stringArraySchema,
    provider: stringArraySchema,
    typeReservation: stringArraySchema,
    paymentType: stringArraySchema,
    reservationHour: stringArraySchema,
    hour: stringArraySchema,
    weekday: stringArraySchema,
    partyBucket: stringArraySchema,
    occasion: stringArraySchema,
    preferredZoneName: stringArraySchema,
    nameContains: z.string().optional(),
    commentsContains: z.string().optional(),
    lastReservationBefore: z.preprocess(normalizeDateInput, z.string().optional()),
    lastReservationAfter: z.preprocess(normalizeDateInput, z.string().optional()),
    firstReservationBefore: z.preprocess(normalizeDateInput, z.string().optional()),
    firstReservationAfter: z.preprocess(normalizeDateInput, z.string().optional()),
  })
  .strict()
  .optional()
  .default({});

export const customerSegmentSchema = z.object({
  from: z.preprocess(normalizeDateInput, z.string()),
  to: z.preprocess(normalizeDateInput, z.string()),
  includeCancelled: z.preprocess(normalizeBooleanInput, z.boolean()).optional().default(true),
  criteria: customerCriteriaSchema,
  includeReservations: z.preprocess(normalizeBooleanInput, z.boolean()).optional().default(false),
  includeRawReservations: z.preprocess(normalizeBooleanInput, z.boolean()).optional().default(false),
  outputFormat: z.enum(["json", "csv"]).optional().default("json"),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional().default(DEFAULT_PAGE_SIZE),
  cursor: z.string().or(z.number()).optional(),
  sortBy: z.enum(CUSTOMER_SORT_FIELDS).optional().default("lastReservationDate"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

export const customerLookupSchema = z
  .object({
    phone: z.string().or(z.number()).optional(),
    email: z.string().optional(),
    name: z.string().optional(),
    from: z.preprocess(normalizeDateInput, z.string().optional()),
    to: z.preprocess(normalizeDateInput, z.string().optional()),
    includeCancelled: z.preprocess(normalizeBooleanInput, z.boolean()).optional().default(true),
    includeReservations: z.preprocess(normalizeBooleanInput, z.boolean()).optional().default(true),
    outputFormat: z.enum(["json", "csv"]).optional().default("json"),
    limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional().default(DEFAULT_PAGE_SIZE),
    cursor: z.string().or(z.number()).optional(),
  })
  .refine((data) => data.phone || data.email || data.name, {
    message: "phone, email or name is required",
  });

export class CustomerService {
  constructor({ reservationService, config }) {
    this.reservationService = reservationService;
    this.config = config;
  }

  async segment(input) {
    const data = customerSegmentSchema.parse(input);
    const { customers, scanned } = await this.buildCustomersForRange({
      from: data.from,
      to: data.to,
      includeCancelled: data.includeCancelled,
    });
    const filtered = customers
      .filter((customer) => matchesCustomerCriteria(customer, data.criteria))
      .sort(customerSorter(data.sortBy, data.sortOrder));
    return formatCustomerPage({
      customers: filtered,
      scanned,
      query: {
        from: data.from,
        to: data.to,
        includeCancelled: data.includeCancelled,
        criteria: normalizeCriteriaForOutput(data.criteria),
      },
      includeReservations: data.includeReservations,
      includeRawReservations: data.includeRawReservations,
      outputFormat: data.outputFormat,
      limit: data.limit,
      cursor: data.cursor,
    });
  }

  async lookup(input) {
    const data = customerLookupSchema.parse(input);
    const range = lookupRange(data);
    const criteria = {
      ...(data.name ? { nameContains: data.name } : {}),
    };
    const { customers, scanned } = await this.buildCustomersForRange({
      from: range.from,
      to: range.to,
      includeCancelled: data.includeCancelled,
    });
    const normalizedPhone = normalizePhone(data.phone);
    const normalizedEmail = normalizeEmail(data.email);
    const filtered = customers
      .filter((customer) => {
        if (normalizedPhone && !customer.contact.phones.includes(normalizedPhone)) return false;
        if (normalizedEmail && !customer.contact.emails.includes(normalizedEmail)) return false;
        return matchesCustomerCriteria(customer, criteria);
      })
      .sort(customerSorter("lastReservationDate", "desc"));

    return formatCustomerPage({
      customers: filtered,
      scanned,
      query: {
        from: range.from,
        to: range.to,
        phone: normalizedPhone || null,
        email: normalizedEmail || null,
        name: data.name || null,
        includeCancelled: data.includeCancelled,
      },
      includeReservations: data.includeReservations,
      includeRawReservations: false,
      outputFormat: data.outputFormat,
      limit: data.limit,
      cursor: data.cursor,
      code: filtered.length ? "CUSTOMERS_FOUND" : "NO_CUSTOMERS_FOUND",
    });
  }

  async export(input) {
    return this.segment({
      outputFormat: "csv",
      limit: MAX_PAGE_SIZE,
      ...input,
    });
  }

  async buildCustomersForRange({ from, to, includeCancelled }) {
    const dates = validateCustomerRange(from, to);
    const days = await mapWithConcurrency(dates, 6, async (date) => {
      const reservations = await this.reservationService.getReservationsByDate(
        date,
        includeCancelled,
      );
      return { date, reservations };
    });
    const reservations = days.flatMap((day) => day.reservations);
    const customers = buildCustomerProfiles(reservations, this.config);
    return {
      customers,
      scanned: {
        from,
        to,
        daysCount: dates.length,
        reservationsCount: reservations.length,
        customerCount: customers.length,
      },
    };
  }
}

function buildCustomerProfiles(reservations, config) {
  const grouped = new Map();
  for (const reservation of reservations) {
    const key = customerKey(reservation);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(reservation);
  }

  return [...grouped.entries()].map(([key, customerReservations]) => {
    const sortedReservations = [...customerReservations].sort((left, right) =>
      String(left.dateTime || "").localeCompare(String(right.dateTime || "")),
    );
    const latest = sortedReservations[sortedReservations.length - 1] || {};
    const contact = buildContact(key, sortedReservations, latest);
    const metrics = buildCustomerMetrics(sortedReservations);
    const preferences = buildCustomerPreferences(sortedReservations);
    return {
      key,
      contact: {
        ...contact,
        marketingConsent: "assumed_opt_in_precompro",
        marketingEligible: Boolean(contact.phone || contact.email),
        consentSource: "precompro",
      },
      metrics,
      preferences,
      reservations: sortedReservations.map((reservation) =>
        sanitizeReservationForCustomer(reservation, config),
      ),
    };
  });
}

function buildContact(key, reservations, latest) {
  const names = uniqueNonEmpty(reservations.map((reservation) => reservation.displayName));
  const phones = uniqueNonEmpty(
    reservations.map((reservation) => normalizePhone(reservation.phone)),
  );
  const emails = uniqueNonEmpty(reservations.map((reservation) => normalizeEmail(reservation.email)));
  const identityDocuments = uniqueNonEmpty(
    reservations.map((reservation) => reservation.identityDocument),
  );
  const countries = uniqueNonEmpty(reservations.map((reservation) => reservation.country));
  const countryCodes = uniqueNonEmpty(reservations.map((reservation) => reservation.countryCode));

  return {
    displayName: latest.displayName || names[0] || null,
    phone: normalizePhone(latest.phone) || phones[0] || null,
    email: normalizeEmail(latest.email) || emails[0] || null,
    identityDocument: latest.identityDocument || identityDocuments[0] || null,
    countryCode: latest.countryCode || countryCodes[0] || null,
    country: latest.country || countries[0] || null,
    names,
    phones,
    emails,
    identityDocuments,
    countries,
    countryCodes,
    dedupeKey: key,
  };
}

function buildCustomerMetrics(reservations) {
  const metrics = {
    totalReservations: reservations.length,
    activeReservations: 0,
    completedReservations: 0,
    cancelledReservations: 0,
    noShowReservations: 0,
    pendingReservations: 0,
    totalPeople: 0,
    activePeople: 0,
    completedPeople: 0,
    cancelledPeople: 0,
    noShowPeople: 0,
    pendingPeople: 0,
    totalBalancePaid: 0,
    firstReservationDate: null,
    lastReservationDate: null,
    firstReservationDateTime: null,
    lastReservationDateTime: null,
    averagePartySize: 0,
    cancellationRate: 0,
    noShowRate: 0,
    completedRate: 0,
    statusCounts: {},
  };

  for (const reservation of reservations) {
    const people = Number.isFinite(reservation.people) ? reservation.people : 0;
    metrics.totalPeople += people;
    metrics.totalBalancePaid += Number.isFinite(reservation.balancePaid)
      ? reservation.balancePaid
      : 0;
    const status = reservation.status || "unknown";
    metrics.statusCounts[status] = (metrics.statusCounts[status] || 0) + 1;

    if (reservation.cancelled) {
      metrics.cancelledReservations += 1;
      metrics.cancelledPeople += people;
    } else if (reservation.noShow) {
      metrics.activeReservations += 1;
      metrics.noShowReservations += 1;
      metrics.activePeople += people;
      metrics.noShowPeople += people;
    } else if (reservation.completed) {
      metrics.activeReservations += 1;
      metrics.completedReservations += 1;
      metrics.activePeople += people;
      metrics.completedPeople += people;
    } else {
      metrics.activeReservations += 1;
      metrics.pendingReservations += 1;
      metrics.activePeople += people;
      metrics.pendingPeople += people;
    }

    if (!metrics.firstReservationDate || reservation.date < metrics.firstReservationDate) {
      metrics.firstReservationDate = reservation.date || null;
      metrics.firstReservationDateTime = reservation.dateTime || null;
    }
    if (!metrics.lastReservationDate || reservation.date > metrics.lastReservationDate) {
      metrics.lastReservationDate = reservation.date || null;
      metrics.lastReservationDateTime = reservation.dateTime || null;
    }
  }

  if (metrics.totalReservations) {
    metrics.averagePartySize = round(metrics.totalPeople / metrics.totalReservations, 2);
    metrics.cancellationRate = round(metrics.cancelledReservations / metrics.totalReservations, 4);
    metrics.noShowRate = round(metrics.noShowReservations / metrics.totalReservations, 4);
    metrics.completedRate = round(metrics.completedReservations / metrics.totalReservations, 4);
  }

  return metrics;
}

function buildCustomerPreferences(reservations) {
  return {
    topWeekdays: topValues(reservations, "weekday"),
    topHours: topValues(reservations, "reservationHour"),
    topSections: topValues(reservations, "sectionName"),
    topTables: topValues(reservations, "tableName"),
    topPartyBuckets: topValues(reservations, "partyBucket"),
    topSources: topValues(reservations, "source"),
    topProviders: topValues(reservations, "provider"),
    topTypeReservations: topValues(reservations, "typeReservation"),
    topPaymentTypes: topValues(reservations, "paymentType"),
    topOccasions: topStructuredCommentValues(reservations, "occasion"),
    topPreferredZones: topStructuredCommentValues(reservations, "preferredZoneName"),
    topAllergies: topStructuredCommentValues(reservations, "allergies"),
    topRequirements: topStructuredCommentValues(reservations, "requirements"),
  };
}

function sanitizeReservationForCustomer(reservation, config) {
  return {
    id: reservation.id,
    displayName: reservation.displayName,
    phone: reservation.phone,
    email: reservation.email,
    identityDocument: reservation.identityDocument,
    countryCode: reservation.countryCode || config.defaults.countryCode,
    country: reservation.country,
    people: reservation.people,
    adult: reservation.adult,
    boy: reservation.boy,
    baby: reservation.baby,
    date: reservation.date,
    dateTime: reservation.dateTime,
    reservationHour: reservation.reservationHour,
    weekday: reservation.weekday,
    status: reservation.status,
    completed: reservation.completed,
    cancelled: reservation.cancelled,
    noShow: reservation.noShow,
    tableId: reservation.tableId,
    tableName: reservation.tableName,
    sectionId: reservation.sectionId,
    sectionName: reservation.sectionName,
    subSectionName: reservation.subSectionName,
    source: reservation.source,
    provider: reservation.provider,
    typeReservation: reservation.typeReservation,
    paymentType: reservation.paymentType,
    balancePaid: reservation.balancePaid,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
    createdBy: reservation.createdBy,
    finishedBy: reservation.finishedBy,
    cancelledBy: reservation.cancelledBy,
    noShowBy: reservation.noShowBy,
    comments: reservation.comments,
    commentsStructured: reservation.commentsStructured,
  };
}

function matchesCustomerCriteria(customer, criteria = {}) {
  const { metrics, contact, reservations } = customer;
  if (!numberAtLeast(metrics.totalReservations, criteria.minTotalReservations)) return false;
  if (!numberAtMost(metrics.totalReservations, criteria.maxTotalReservations)) return false;
  if (!numberAtLeast(metrics.completedReservations, criteria.minCompletedReservations)) {
    return false;
  }
  if (!numberAtLeast(metrics.cancelledReservations, criteria.minCancelledReservations)) {
    return false;
  }
  if (!numberAtLeast(metrics.noShowReservations, criteria.minNoShowReservations)) return false;
  if (!numberAtLeast(metrics.pendingReservations, criteria.minPendingReservations)) return false;
  if (!numberAtLeast(metrics.totalPeople, criteria.minTotalPeople)) return false;
  if (!numberAtLeast(metrics.completedPeople, criteria.minCompletedPeople)) return false;
  if (!numberAtLeast(metrics.cancelledPeople, criteria.minCancelledPeople)) return false;
  if (!numberAtLeast(metrics.noShowPeople, criteria.minNoShowPeople)) return false;
  if (!numberAtLeast(metrics.cancellationRate, criteria.minCancellationRate)) return false;
  if (!numberAtMost(metrics.cancellationRate, criteria.maxCancellationRate)) return false;
  if (!numberAtLeast(metrics.noShowRate, criteria.minNoShowRate)) return false;
  if (!numberAtMost(metrics.noShowRate, criteria.maxNoShowRate)) return false;

  if (criteria.hasEmail !== undefined && Boolean(contact.email) !== criteria.hasEmail) return false;
  if (criteria.hasPhone !== undefined && Boolean(contact.phone) !== criteria.hasPhone) return false;
  if (criteria.hasCancelled !== undefined) {
    if ((metrics.cancelledReservations > 0) !== criteria.hasCancelled) return false;
  }
  if (criteria.hasNoShow !== undefined) {
    if ((metrics.noShowReservations > 0) !== criteria.hasNoShow) return false;
  }
  if (criteria.hasCompleted !== undefined) {
    if ((metrics.completedReservations > 0) !== criteria.hasCompleted) return false;
  }
  if (criteria.hasPending !== undefined) {
    if ((metrics.pendingReservations > 0) !== criteria.hasPending) return false;
  }

  if (!dateBefore(metrics.lastReservationDate, criteria.lastReservationBefore)) return false;
  if (!dateAfter(metrics.lastReservationDate, criteria.lastReservationAfter)) return false;
  if (!dateBefore(metrics.firstReservationDate, criteria.firstReservationBefore)) return false;
  if (!dateAfter(metrics.firstReservationDate, criteria.firstReservationAfter)) return false;

  if (!matchesAnyReservation(reservations, "sectionName", criteria.sectionName)) return false;
  if (!matchesAnyReservation(reservations, "tableName", criteria.tableName)) return false;
  if (!matchesAnyReservation(reservations, "source", criteria.source)) return false;
  if (!matchesAnyReservation(reservations, "provider", criteria.provider)) return false;
  if (!matchesAnyReservation(reservations, "typeReservation", criteria.typeReservation)) {
    return false;
  }
  if (!matchesAnyReservation(reservations, "paymentType", criteria.paymentType)) return false;
  if (!matchesAnyReservation(reservations, "reservationHour", criteria.reservationHour || criteria.hour)) {
    return false;
  }
  if (!matchesAnyReservation(reservations, "weekday", criteria.weekday)) return false;
  if (!matchesAnyReservation(reservations, "partyBucket", criteria.partyBucket)) return false;
  if (!matchesAnyStructuredComment(reservations, "occasion", criteria.occasion)) return false;
  if (
    !matchesAnyStructuredComment(
      reservations,
      "preferredZoneName",
      criteria.preferredZoneName,
    )
  ) {
    return false;
  }

  if (criteria.nameContains && !contains(contact.names.join(" "), criteria.nameContains)) {
    return false;
  }
  if (
    criteria.commentsContains &&
    !reservations.some((reservation) => contains(reservation.comments, criteria.commentsContains))
  ) {
    return false;
  }

  return true;
}

function formatCustomerPage({
  customers,
  scanned,
  query,
  includeReservations,
  includeRawReservations,
  outputFormat,
  limit,
  cursor,
  code,
}) {
  const offset = cursorToOffset(cursor);
  const page = customers.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const rows = page.map((customer) =>
    customerOutput(customer, { includeReservations, includeRawReservations }),
  );
  const nextCursor = nextOffset < customers.length ? String(nextOffset) : null;
  const base = {
    ok: true,
    code: code || (customers.length ? "CUSTOMER_SEGMENT_READY" : "NO_CUSTOMERS_MATCHED"),
    message: customers.length
      ? "Segmento de clientes listo."
      : "No encontré clientes para esos criterios.",
    internalOnly: true,
    pii: true,
    marketingConsentAssumption: "Todos los contactos en Precompro se tratan como opt-in, según configuración operativa de Ritwal.",
    query,
    scanned,
    pagination: {
      totalCustomers: customers.length,
      returnedCustomers: rows.length,
      limit,
      cursor: offset ? String(offset) : null,
      nextCursor,
    },
  };

  if (outputFormat === "csv") {
    return {
      ...base,
      format: "csv",
      contentType: "text/csv; charset=utf-8",
      filename: customerExportFilename(query.from, query.to),
      csv: customersToCsv(rows),
    };
  }

  return {
    ...base,
    format: "json",
    customers: rows,
  };
}

function customerOutput(customer, { includeReservations, includeRawReservations }) {
  const output = {
    key: customer.key,
    contact: customer.contact,
    metrics: customer.metrics,
    preferences: customer.preferences,
  };
  if (includeReservations) {
    output.reservations = includeRawReservations
      ? customer.reservations
      : customer.reservations.map((reservation) => ({
          id: reservation.id,
          date: reservation.date,
          dateTime: reservation.dateTime,
          people: reservation.people,
          status: reservation.status,
          completed: reservation.completed,
          cancelled: reservation.cancelled,
          noShow: reservation.noShow,
          sectionName: reservation.sectionName,
          tableName: reservation.tableName,
          source: reservation.source,
          commentsStructured: reservation.commentsStructured,
        }));
  }
  return output;
}

function customersToCsv(customers) {
  const columns = [
    "key",
    "displayName",
    "phone",
    "email",
    "identityDocument",
    "countryCode",
    "country",
    "marketingEligible",
    "totalReservations",
    "completedReservations",
    "cancelledReservations",
    "noShowReservations",
    "pendingReservations",
    "totalPeople",
    "completedPeople",
    "cancelledPeople",
    "noShowPeople",
    "pendingPeople",
    "totalBalancePaid",
    "averagePartySize",
    "cancellationRate",
    "noShowRate",
    "completedRate",
    "firstReservationDate",
    "lastReservationDate",
    "topWeekdays",
    "topHours",
    "topSections",
    "topTables",
    "topPartyBuckets",
    "topSources",
    "topTypeReservations",
    "topOccasions",
    "names",
    "phones",
    "emails",
  ];
  const rows = customers.map((customer) => {
    const { contact, metrics, preferences } = customer;
    return {
      key: customer.key,
      displayName: contact.displayName,
      phone: contact.phone,
      email: contact.email,
      identityDocument: contact.identityDocument,
      countryCode: contact.countryCode,
      country: contact.country,
      marketingEligible: contact.marketingEligible,
      totalReservations: metrics.totalReservations,
      completedReservations: metrics.completedReservations,
      cancelledReservations: metrics.cancelledReservations,
      noShowReservations: metrics.noShowReservations,
      pendingReservations: metrics.pendingReservations,
      totalPeople: metrics.totalPeople,
      completedPeople: metrics.completedPeople,
      cancelledPeople: metrics.cancelledPeople,
      noShowPeople: metrics.noShowPeople,
      pendingPeople: metrics.pendingPeople,
      totalBalancePaid: metrics.totalBalancePaid,
      averagePartySize: metrics.averagePartySize,
      cancellationRate: metrics.cancellationRate,
      noShowRate: metrics.noShowRate,
      completedRate: metrics.completedRate,
      firstReservationDate: metrics.firstReservationDate,
      lastReservationDate: metrics.lastReservationDate,
      topWeekdays: formatTopValues(preferences.topWeekdays),
      topHours: formatTopValues(preferences.topHours),
      topSections: formatTopValues(preferences.topSections),
      topTables: formatTopValues(preferences.topTables),
      topPartyBuckets: formatTopValues(preferences.topPartyBuckets),
      topSources: formatTopValues(preferences.topSources),
      topTypeReservations: formatTopValues(preferences.topTypeReservations),
      topOccasions: formatTopValues(preferences.topOccasions),
      names: contact.names.join(" | "),
      phones: contact.phones.join(" | "),
      emails: contact.emails.join(" | "),
    };
  });

  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n");
}

function customerKey(reservation) {
  const phone = normalizePhone(reservation.phone);
  if (phone) return `phone:${phone}`;
  const email = normalizeEmail(reservation.email);
  if (email) return `email:${email}`;
  const document = normalizeComparable(reservation.identityDocument);
  if (document) return `document:${document}`;
  const name = normalizeComparable(reservation.displayName);
  return `name:${name || "unknown"}`;
}

function validateCustomerRange(from, to) {
  validateDate(from);
  validateDate(to);
  if (from > to) {
    throw new AppError(
      "INVALID_DATE_RANGE",
      "La fecha inicial debe ser menor o igual a la fecha final.",
      { from, to },
      400,
    );
  }
  return datesBetween(from, to);
}

function validateDate(date) {
  if (!assertIsoDate(date)) {
    throw new AppError(
      "INVALID_DATE",
      "La fecha debe venir en formato YYYY-MM-DD y ser una fecha real.",
      { date },
      400,
    );
  }
}

function lookupRange(data) {
  if (data.from || data.to) {
    if (!data.from || !data.to) {
      throw new AppError(
        "INVALID_DATE_RANGE",
        "Para lookup histórico envía from y to juntos.",
        { from: data.from, to: data.to },
        400,
      );
    }
    validateCustomerRange(data.from, data.to);
    return { from: data.from, to: data.to };
  }

  const to = todayBogota();
  const from = addDaysIso(to, -DEFAULT_LOOKUP_DAYS);
  return { from, to, defaulted: true };
}

function datesBetween(from, to) {
  const dates = [];
  const current = parseIsoDateUtc(from);
  const end = parseIsoDateUtc(to);
  while (current <= end) {
    dates.push(formatIsoDateUtc(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function todayBogota() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysIso(date, days) {
  const value = parseIsoDateUtc(date);
  value.setUTCDate(value.getUTCDate() + days);
  return formatIsoDateUtc(value);
}

function parseIsoDateUtc(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDateUtc(date) {
  return date.toISOString().slice(0, 10);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function numberAtLeast(value, minimum) {
  return minimum === undefined || value >= minimum;
}

function numberAtMost(value, maximum) {
  return maximum === undefined || value <= maximum;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function dateBefore(value, limit) {
  return !limit || (value && value < limit);
}

function dateAfter(value, limit) {
  return !limit || (value && value > limit);
}

function matchesAnyReservation(reservations, field, allowedValues) {
  if (!allowedValues?.length) return true;
  return reservations.some((reservation) => matchesStringFilter(reservation[field], allowedValues));
}

function matchesAnyStructuredComment(reservations, field, allowedValues) {
  if (!allowedValues?.length) return true;
  return reservations.some((reservation) =>
    matchesStringFilter(reservation.commentsStructured?.[field], allowedValues),
  );
}

function matchesStringFilter(value, allowedValues) {
  if (!allowedValues?.length) return true;
  const normalizedValue = normalizeComparable(value || "unknown");
  return allowedValues.some((allowed) => normalizeComparable(allowed) === normalizedValue);
}

function contains(value, expected) {
  return normalizeComparable(value).includes(normalizeComparable(expected));
}

function normalizeComparable(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

function uniqueNonEmpty(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
}

function topValues(reservations, field, limit = 5) {
  return topFromValues(reservations.map((reservation) => reservation[field]), limit);
}

function topStructuredCommentValues(reservations, field, limit = 5) {
  return topFromValues(
    reservations.map((reservation) => reservation.commentsStructured?.[field]),
    limit,
  );
}

function topFromValues(values, limit = 5) {
  const counts = new Map();
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const key = String(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, "es"))
    .slice(0, limit);
}

function customerSorter(sortBy, sortOrder) {
  const direction = sortOrder === "asc" ? 1 : -1;
  return (left, right) => {
    const leftValue = sortValue(left, sortBy);
    const rightValue = sortValue(right, sortBy);
    if (leftValue < rightValue) return -1 * direction;
    if (leftValue > rightValue) return 1 * direction;
    return String(left.contact.displayName || "").localeCompare(
      String(right.contact.displayName || ""),
      "es",
    );
  };
}

function sortValue(customer, sortBy) {
  if (sortBy === "displayName") return customer.contact.displayName || "";
  return customer.metrics[sortBy] ?? "";
}

function customerExportFilename(from, to) {
  return `ritwal-customers-${from || "from"}-${to || "to"}.csv`;
}

function cursorToOffset(cursor) {
  const number = Number(cursor || 0);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function normalizeCriteriaForOutput(criteria = {}) {
  return Object.fromEntries(
    Object.entries(criteria).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined;
    }),
  );
}

function formatTopValues(values = []) {
  return values.map((item) => `${item.value} (${item.count})`).join(" | ");
}

function csvCell(value) {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function normalizeBooleanInput(value) {
  if (value === undefined || value === null || value === "") return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const key = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "si", "sí"].includes(key)) return true;
  if (["false", "0", "no"].includes(key)) return false;
  return value;
}

function normalizeStringArrayInput(value) {
  if (value === undefined || value === null || value === "") return value;
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeStringArrayInput(item) || [])
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim());
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      return normalizeStringArrayInput(JSON.parse(trimmed));
    } catch {
      return trimmed
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [String(value).trim()].filter(Boolean);
}
