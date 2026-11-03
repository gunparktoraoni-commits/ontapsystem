import type { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId } from "@/lib/errors/http";
import { invalidateCache, generateCacheKey } from "@/lib/cache";
import { getSchemaCompat, omitMissingColumns } from "@/lib/db/schemaCompat";
import { syncUserProfileToBizcard } from "@/lib/bizcard/sync";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import {
  actorUserIdFromSession,
  ensureCompanyPermission,
  ensureCompanyRole,
  logCompanyAudit,
  resolveCompanyActorContext,
  type CompanyActorContext,
} from "@/server/lib/company";
import {
  validateSocialInput,
  type SocialInput,
} from "@/server/lib/validators";

export function parseEmployeeIdParam(value: string, requestId: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw createCompanyError(
      CompanyErrorCode.INVALID_EMPLOYEE_DATA,
      "Invalid employee id.",
      400,
      requestId,
    );
  }
  return BigInt(value);
}

export async function invalidateEmployeeProfileCaches(userId: bigint): Promise<void> {
  const userIdStr = userId.toString();
  try {
    const [user, bizcards] = await Promise.all([
      prisma.user.findUnique({
        where: { user_id: userId },
        select: { custom_uri: true, serial_id: true },
      }),
      prisma.bizcard.findMany({
        where: { user_id: userId, deactivated_flag: false },
        select: { url_alias: true },
      }),
    ]);

    const aliases = new Set<string>();
    for (const raw of [
      user?.custom_uri,
      user?.serial_id,
      ...bizcards.map((b) => b.url_alias),
    ]) {
      const normalized = String(raw ?? "").trim().toLowerCase();
      if (normalized) aliases.add(normalized);
    }

    await Promise.all([
      invalidateCache(generateCacheKey("user", userIdStr, "profile")),
      ...[...aliases].map((alias) =>
        invalidateCache(generateCacheKey("public", "profile", alias)),
      ),
    ]);
  } catch (cacheErr) {
    console.warn("[company-employee-profile] cache invalidation failed:", cacheErr);
  }
}

export type ManageEmployeesAuth = {
  requestId: string;
  startedAt: number;
  ip: string;
  context: CompanyActorContext;
};

export async function requireManageEmployeesAuth(
  request: NextRequest,
): Promise<ManageEmployeesAuth> {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  const auth = await resolveRequestSession(request, { tryRefresh: true });
  if (!auth.session) {
    throw createCompanyError(
      CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
      "Authentication required.",
      401,
      requestId,
    );
  }

  const context = await resolveCompanyActorContext({
    userId: actorUserIdFromSession(auth),
    requestId,
  });
  ensureCompanyRole(context, ["admin", "manager"], requestId);
  ensureCompanyPermission(context, "manage_employees", requestId);

  return { requestId, startedAt, ip, context };
}

export async function resolveCompanyEmployeeTarget(params: {
  employeeId: bigint;
  companyId: bigint;
  requestId: string;
}): Promise<{
  employee_id: bigint;
  user_id: bigint;
  is_active: boolean;
  role: string;
}> {
  const employee = await prisma.companyEmployee.findFirst({
    where: {
      employee_id: params.employeeId,
      company_id: params.companyId,
    },
    select: {
      employee_id: true,
      user_id: true,
      is_active: true,
      role: true,
    },
  });

  if (!employee) {
    throw createCompanyError(
      CompanyErrorCode.EMPLOYEE_NOT_FOUND,
      "Employee not found.",
      404,
      params.requestId,
    );
  }

  return employee;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function nullableTrim(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

/** Clamp to DB column widths so Prisma/MySQL do not 500 on overflow. */
function clampStr(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

function clampNullable(value: string | null, max: number): string | null {
  if (value == null) return null;
  return clampStr(value, max);
}

function sanitizeCoord(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

export type ProfessionalDetailsPayload = {
  firstName: string;
  lastName: string;
  suffix: string;
  occupation: string;
  about: string;
  bizCardName: string;
  description: string;
  email: string;
  contactEmail: string;
  alternativeEmail: string;
  contactNumber: string;
  secondaryNumber: string;
  telephoneNumber: string;
  altTelephoneNumber: string;
  profileImage: string | null;
  address: {
    area: string;
    brgy: string;
    city: string;
    region: string;
    zipcode: string;
    plusCode: string;
    mapLink: string;
    landmark: string;
    latitude: number | null;
    longitude: number | null;
  };
};

export async function fetchProfessionalDetails(
  userId: bigint,
  requestId = "n/a",
): Promise<ProfessionalDetailsPayload> {
  const compat = await getSchemaCompat();
  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    select: {
      first_name: true,
      last_name: true,
      suffix: true,
      job_position: true,
      about: true,
      email: true,
      alt_email: true,
      contact: true,
      alt_contact: true,
      ...(compat.userTelephone ? { telephone: true, alt_telephone: true } : {}),
      profile_url: true,
    },
  });

  if (!user) {
    throw createCompanyError(
      CompanyErrorCode.EMPLOYEE_NOT_FOUND,
      "Employee user profile not found.",
      404,
      requestId,
    );
  }

  const bizcardSelect = {
    bizcard_id: true,
    bizcard_name: true,
    description: true,
    first_name: true,
    last_name: true,
    suffix: true,
    occupation: true,
    bio: true,
    email: true,
    alt_email: true,
    contact_number: true,
    alt_contact_number: true,
    ...(compat.bizcardTelephone
      ? { telephone_number: true, alt_telephone_number: true }
      : {}),
    profile_img: true,
  } as const;

  const [bizcardPrimary, address] = await Promise.all([
    prisma.bizcard.findFirst({
      where: { user_id: userId, is_blank: false },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: bizcardSelect,
    }),
    prisma.address.findFirst({
      where: { user_id: userId },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: {
        area: true,
        brgy: true,
        city: true,
        region: true,
        zipcode: true,
        plus_code: true,
        map_link: true,
        ...(compat.addressLandmark ? { landmark: true } : {}),
        latitude: true,
        longitude: true,
      },
    }),
  ]);

  // Manually provisioned employees often only have a blank placeholder card.
  const bizcard =
    bizcardPrimary ??
    (await prisma.bizcard.findFirst({
      where: { user_id: userId },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: bizcardSelect,
    }));

  const userTel = user as { telephone?: string | null; alt_telephone?: string | null };
  const cardTel = bizcard as {
    telephone_number?: string | null;
    alt_telephone_number?: string | null;
  } | null;
  const addrLandmark = address as { landmark?: string | null } | null;

  return {
    firstName: asString(bizcard?.first_name ?? user.first_name),
    lastName: asString(bizcard?.last_name ?? user.last_name),
    suffix: asString(bizcard?.suffix ?? user.suffix ?? "N/A") || "N/A",
    occupation: asString(bizcard?.occupation ?? user.job_position),
    about: asString(bizcard?.bio ?? user.about),
    bizCardName: asString(bizcard?.bizcard_name),
    description: asString(bizcard?.description),
    email: asString(user.email),
    contactEmail: asString(bizcard?.email || user.email),
    alternativeEmail: asString(bizcard?.alt_email ?? user.alt_email),
    contactNumber: asString(bizcard?.contact_number ?? user.contact),
    secondaryNumber: asString(bizcard?.alt_contact_number ?? user.alt_contact),
    telephoneNumber: asString(cardTel?.telephone_number ?? userTel.telephone),
    altTelephoneNumber: asString(cardTel?.alt_telephone_number ?? userTel.alt_telephone),
    profileImage: user.profile_url || bizcard?.profile_img || null,
    address: {
      area: asString(address?.area),
      brgy: asString(address?.brgy),
      city: asString(address?.city),
      region: asString(address?.region),
      zipcode: asString(address?.zipcode),
      plusCode: asString(address?.plus_code),
      mapLink: asString(address?.map_link),
      landmark: asString(addrLandmark?.landmark),
      latitude:
        address?.latitude != null && Number.isFinite(Number(address.latitude))
          ? Number(address.latitude)
          : null,
      longitude:
        address?.longitude != null && Number.isFinite(Number(address.longitude))
          ? Number(address.longitude)
          : null,
    },
  };
}

export type ProfessionalDetailsUpdateInput = {
  firstName?: string;
  lastName?: string;
  suffix?: string;
  occupation?: string;
  about?: string;
  bizCardName?: string;
  description?: string;
  contactEmail?: string | null;
  alternativeEmail?: string | null;
  contactNumber?: string | null;
  secondaryNumber?: string | null;
  telephoneNumber?: string | null;
  altTelephoneNumber?: string | null;
  address?: {
    area?: string | null;
    brgy?: string | null;
    city?: string | null;
    region?: string | null;
    zipcode?: string | null;
    plusCode?: string | null;
    mapLink?: string | null;
    landmark?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
};

function trackChange(
  changed: string[],
  field: string,
  before: string,
  after: string,
): void {
  if (before !== after) changed.push(field);
}

export function validateProfessionalDetailsInput(input: ProfessionalDetailsUpdateInput): {
  valid: boolean;
  missingFields: string[];
} {
  const missingFields: string[] = [];

  if (!asString(input.bizCardName).trim()) missingFields.push("BizCard Name");
  if (!asString(input.firstName).trim()) missingFields.push("First Name");
  if (!asString(input.lastName).trim()) missingFields.push("Last Name");

  const anyContactMethod = [
    input.contactEmail,
    input.alternativeEmail,
    input.contactNumber,
    input.secondaryNumber,
    input.telephoneNumber,
    input.altTelephoneNumber,
  ].some((value) => (nullableTrim(value)?.length ?? 0) > 0);

  if (!anyContactMethod) missingFields.push("At least one contact method");

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

export async function updateProfessionalDetails(params: {
  userId: bigint;
  employeeId: bigint;
  companyId: bigint;
  actorUserId: bigint;
  input: ProfessionalDetailsUpdateInput;
  requestId: string;
  ip?: string;
}): Promise<{ changedFields: string[] }> {
  const compat = await getSchemaCompat();
  const current = await fetchProfessionalDetails(params.userId, params.requestId);
  const changedFields: string[] = [];

  const firstName = clampStr(
    params.input.firstName !== undefined
      ? asString(params.input.firstName).trim()
      : current.firstName,
    100,
  );
  const lastName = clampStr(
    params.input.lastName !== undefined
      ? asString(params.input.lastName).trim()
      : current.lastName,
    100,
  );
  if (!firstName || !lastName) {
    throw createCompanyError(
      CompanyErrorCode.INVALID_EMPLOYEE_DATA,
      "First name and last name are required.",
      422,
      params.requestId,
    );
  }

  const suffix = clampStr(
    params.input.suffix !== undefined
      ? asString(params.input.suffix).trim() || "N/A"
      : current.suffix,
    10,
  );
  const occupation = clampStr(
    params.input.occupation !== undefined
      ? asString(params.input.occupation).trim()
      : current.occupation,
    100,
  );
  const about =
    params.input.about !== undefined ? asString(params.input.about) : current.about;
  const rawBizCardName =
    params.input.bizCardName !== undefined
      ? asString(params.input.bizCardName).trim()
      : current.bizCardName;
  // Bizcard.bizcard_name is NOT NULL — never write null/empty.
  const bizCardName = clampStr(
    rawBizCardName || `${firstName} ${lastName}`.trim() || "BizCard",
    255,
  );
  const description =
    params.input.description !== undefined
      ? asString(params.input.description).trim()
      : current.description;
  const contactEmail = clampNullable(
    params.input.contactEmail !== undefined
      ? nullableTrim(params.input.contactEmail)
      : current.contactEmail || null,
    255,
  );
  const alternativeEmail = clampNullable(
    params.input.alternativeEmail !== undefined
      ? nullableTrim(params.input.alternativeEmail)
      : current.alternativeEmail || null,
    255,
  );
  // User.contact / alt_contact are VARCHAR(20); Bizcard contact fields are wider.
  const contactNumber = clampNullable(
    params.input.contactNumber !== undefined
      ? nullableTrim(params.input.contactNumber)
      : current.contactNumber || null,
    20,
  );
  const secondaryNumber = clampNullable(
    params.input.secondaryNumber !== undefined
      ? nullableTrim(params.input.secondaryNumber)
      : current.secondaryNumber || null,
    20,
  );
  const telephoneNumber = clampNullable(
    params.input.telephoneNumber !== undefined
      ? nullableTrim(params.input.telephoneNumber)
      : current.telephoneNumber || null,
    30,
  );
  const altTelephoneNumber = clampNullable(
    params.input.altTelephoneNumber !== undefined
      ? nullableTrim(params.input.altTelephoneNumber)
      : current.altTelephoneNumber || null,
    30,
  );

  trackChange(changedFields, "firstName", current.firstName, firstName);
  trackChange(changedFields, "lastName", current.lastName, lastName);
  trackChange(changedFields, "suffix", current.suffix, suffix);
  trackChange(changedFields, "occupation", current.occupation, occupation);
  trackChange(changedFields, "about", current.about, about);
  trackChange(changedFields, "bizCardName", current.bizCardName, bizCardName);
  trackChange(changedFields, "description", current.description, description);
  trackChange(changedFields, "contactEmail", current.contactEmail, contactEmail ?? "");
  trackChange(
    changedFields,
    "alternativeEmail",
    current.alternativeEmail,
    alternativeEmail ?? "",
  );
  trackChange(
    changedFields,
    "contactNumber",
    current.contactNumber,
    contactNumber ?? "",
  );
  trackChange(
    changedFields,
    "secondaryNumber",
    current.secondaryNumber,
    secondaryNumber ?? "",
  );
  trackChange(
    changedFields,
    "telephoneNumber",
    current.telephoneNumber,
    telephoneNumber ?? "",
  );
  trackChange(
    changedFields,
    "altTelephoneNumber",
    current.altTelephoneNumber,
    altTelephoneNumber ?? "",
  );

  const addressInput = params.input.address;
  const nextAddress = {
    area: clampStr(
      addressInput && "area" in addressInput
        ? asString(addressInput.area)
        : current.address.area,
      255,
    ),
    brgy: clampStr(
      addressInput && "brgy" in addressInput
        ? asString(addressInput.brgy)
        : current.address.brgy,
      255,
    ),
    city: clampStr(
      addressInput && "city" in addressInput
        ? asString(addressInput.city)
        : current.address.city,
      255,
    ),
    region: clampStr(
      addressInput && "region" in addressInput
        ? asString(addressInput.region)
        : current.address.region,
      255,
    ),
    zipcode: clampStr(
      addressInput && "zipcode" in addressInput
        ? asString(addressInput.zipcode)
        : current.address.zipcode,
      20,
    ),
    plusCode: clampStr(
      addressInput && "plusCode" in addressInput
        ? asString(addressInput.plusCode)
        : current.address.plusCode,
      255,
    ),
    mapLink: clampStr(
      addressInput && "mapLink" in addressInput
        ? asString(addressInput.mapLink)
        : current.address.mapLink,
      512,
    ),
    landmark:
      addressInput && "landmark" in addressInput
        ? asString(addressInput.landmark)
        : current.address.landmark,
    latitude:
      addressInput && "latitude" in addressInput
        ? sanitizeCoord(addressInput.latitude)
        : sanitizeCoord(current.address.latitude),
    longitude:
      addressInput && "longitude" in addressInput
        ? sanitizeCoord(addressInput.longitude)
        : sanitizeCoord(current.address.longitude),
  };

  if (addressInput !== undefined) {
    const addrKeys: Array<keyof typeof nextAddress> = [
      "area",
      "brgy",
      "city",
      "region",
      "zipcode",
      "plusCode",
      "mapLink",
      "landmark",
      "latitude",
      "longitude",
    ];
    for (const key of addrKeys) {
      if (String(current.address[key] ?? "") !== String(nextAddress[key] ?? "")) {
        changedFields.push(`address.${key}`);
      }
    }
  }

  if (changedFields.length === 0) {
    return { changedFields };
  }

  const existingAddress = await prisma.address.findFirst({
    where: { user_id: params.userId },
    orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
    select: { address_id: true },
  });

  try {
    await prisma.$transaction(async (tx) => {
      const userFields: Record<string, unknown> = {
        updated_at: new Date(),
        first_name: firstName,
        last_name: lastName,
        suffix,
        job_position: occupation || null,
        about: about || null,
        alt_email: alternativeEmail,
        contact: contactNumber,
        alt_contact: secondaryNumber,
      };
      if (compat.userTelephone) {
        userFields.telephone = telephoneNumber;
        userFields.alt_telephone = altTelephoneNumber;
      }

      await tx.user.update({
        where: { user_id: params.userId },
        data: omitMissingColumns(userFields, compat, "user"),
      });

      const bizcardFields: Record<string, unknown> = {
        updated_at: new Date(),
        first_name: firstName,
        last_name: lastName,
        suffix,
        occupation: clampStr(occupation, 200) || null,
        bio: about || null,
        // Required non-null column — always a real string.
        bizcard_name: bizCardName,
        description: description || null,
        alt_email: alternativeEmail,
        // Bizcard contact columns allow 50 chars; keep in sync with clamped user values.
        contact_number: contactNumber ?? "",
        alt_contact_number: secondaryNumber,
        // Admin-managed professional profile should leave the blank placeholder state.
        is_blank: false,
      };
      if (contactEmail) {
        bizcardFields.email = contactEmail;
      }
      if (compat.bizcardTelephone) {
        bizcardFields.telephone_number = telephoneNumber;
        bizcardFields.alt_telephone_number = altTelephoneNumber;
      }

      await tx.bizcard.updateMany({
        where: { user_id: params.userId },
        data: omitMissingColumns(bizcardFields, compat, "bizcard"),
      });

      if (addressInput !== undefined) {
        const addressData = omitMissingColumns(
          {
            area: nextAddress.area || null,
            brgy: nextAddress.brgy || null,
            city: nextAddress.city || null,
            region: nextAddress.region || null,
            zipcode: nextAddress.zipcode || null,
            plus_code: nextAddress.plusCode || null,
            map_link: nextAddress.mapLink || null,
            landmark: nextAddress.landmark || null,
            latitude: nextAddress.latitude,
            longitude: nextAddress.longitude,
            updated_at: new Date(),
          },
          compat,
          "address",
        );

        if (existingAddress) {
          await tx.address.update({
            where: { address_id: existingAddress.address_id },
            data: addressData,
          });
        } else {
          await tx.address.create({
            data: omitMissingColumns(
              {
                user_id: params.userId,
                ...addressData,
              },
              compat,
              "address",
            ),
          });
        }
      }
    });
  } catch (error) {
    console.error("[company-employee-profile] updateProfessionalDetails failed", {
      requestId: params.requestId,
      userId: params.userId.toString(),
      employeeId: params.employeeId.toString(),
      error,
    });
    throw createCompanyError(
      CompanyErrorCode.INVALID_EMPLOYEE_DATA,
      "Failed to save employee professional details. Check field lengths and try again.",
      500,
      params.requestId,
    );
  }

  try {
    await syncUserProfileToBizcard(params.userId);
  } catch (syncError) {
    // Profile rows already saved above — do not fail the admin save on sync edge cases.
    console.warn("[company-employee-profile] syncUserProfileToBizcard failed after save", {
      requestId: params.requestId,
      userId: params.userId.toString(),
      error: syncError,
    });
  }

  await invalidateEmployeeProfileCaches(params.userId);

  await logCompanyAudit({
    companyId: params.companyId,
    userId: params.actorUserId,
    action: "employee.professional_details_updated",
    requestId: params.requestId,
    ipAddress: params.ip,
    details: {
      employeeId: params.employeeId.toString(),
      employeeUserId: params.userId.toString(),
      changedFields,
    },
  });

  return { changedFields };
}

export async function fetchEmployeeSocials(userId: bigint) {
  const rows = await prisma.social.findMany({
    where: { user_id: userId, deleted_at: null },
    orderBy: { display_order: "asc" },
    select: {
      socials_id: true,
      platform: true,
      url: true,
      display_order: true,
      is_visible: true,
    },
  });

  return rows.map((row) => ({
    id: row.socials_id.toString(),
    platform: row.platform,
    url: row.url,
    displayOrder: row.display_order,
    isVisible: row.is_visible,
  }));
}

export async function replaceEmployeeSocials(params: {
  userId: bigint;
  employeeId: bigint;
  companyId: bigint;
  actorUserId: bigint;
  socials: unknown[];
  requestId: string;
  ip?: string;
}): Promise<{ count: number; platforms: string[] }> {
  const validated: SocialInput[] = [];
  const errors: string[] = [];

  for (let i = 0; i < params.socials.length; i += 1) {
    const item = params.socials[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`socials[${i}]: invalid object.`);
      continue;
    }
    const result = validateSocialInput(item as Record<string, unknown>);
    if (!result.valid) {
      errors.push(...result.errors.map((e) => `socials[${i}]: ${e}`));
      continue;
    }
    validated.push(result.data);
  }

  if (errors.length) {
    throw createCompanyError(
      CompanyErrorCode.INVALID_EMPLOYEE_DATA,
      errors[0] ?? "Invalid social links.",
      422,
      params.requestId,
      { details: errors },
    );
  }

  const preferredBizcard = await prisma.bizcard.findFirst({
    where: { user_id: params.userId, is_blank: false },
    orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
    select: { bizcard_id: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.social.updateMany({
      where: { user_id: params.userId, deleted_at: null },
      data: { deleted_at: new Date(), updated_at: new Date() },
    });

    if (validated.length > 0) {
      await tx.social.createMany({
        data: validated.map((s) => ({
          user_id: params.userId,
          ...(preferredBizcard ? { bizcard_id: preferredBizcard.bizcard_id } : {}),
          platform: s.platform,
          url: s.url,
          display_order: s.displayOrder,
          is_visible: s.isVisible,
        })),
      });
    }
  });

  await invalidateEmployeeProfileCaches(params.userId);

  const platforms = validated.map((s) => s.platform);
  await logCompanyAudit({
    companyId: params.companyId,
    userId: params.actorUserId,
    action: "employee.socials_updated",
    requestId: params.requestId,
    ipAddress: params.ip,
    details: {
      employeeId: params.employeeId.toString(),
      employeeUserId: params.userId.toString(),
      count: validated.length,
      platforms,
    },
  });

  return { count: validated.length, platforms };
}

export async function fetchEmployeeServices(userId: bigint) {
  const services = await prisma.service.findMany({
    where: { user_id: userId },
    orderBy: [{ display_order: "asc" }, { created_at: "desc" }],
    select: {
      service_id: true,
      name: true,
      description: true,
      tagline: true,
      price: true,
      currency_code: true,
      service_url: true,
      featured_image: true,
      featured: true,
      is_visible: true,
      is_price_negotiable: true,
      status: true,
      display_order: true,
      created_at: true,
      updated_at: true,
    },
  });

  return services.map((svc) => ({
    id: svc.service_id.toString(),
    name: svc.name,
    description: svc.description,
    tagline: svc.tagline,
    price: svc.price,
    currency: svc.currency_code,
    serviceUrl: svc.service_url,
    featuredImage: svc.featured_image,
    featured: svc.featured,
    isVisible: svc.is_visible,
    isPriceNegotiable: svc.is_price_negotiable,
    status: svc.status,
    displayOrder: svc.display_order,
    createdAt: svc.created_at,
    updatedAt: svc.updated_at,
  }));
}

export async function hasActiveEmployeeCard(userId: bigint): Promise<boolean> {
  const count = await prisma.employeeCard.count({
    where: { assigned_user_id: userId, activation_status: "active" },
  });
  return count > 0;
}
