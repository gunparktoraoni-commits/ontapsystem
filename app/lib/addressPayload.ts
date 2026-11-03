import type { VCardFormData } from '../types';

export function buildAddressApiPayload(
  vcard: Pick<
    VCardFormData,
    | 'addressArea'
    | 'addressHouseNo'
    | 'addressBrgy'
    | 'addressCity'
    | 'addressRegion'
    | 'addressZipcode'
    | 'addressMapLink'
    | 'addressLandmark'
    | 'addressLatitude'
    | 'addressLongitude'
  >
): Record<string, string | number> | undefined {
  const mapValue = vcard.addressMapLink.trim();
  const isUrl = /^https?:\/\//i.test(mapValue);
  const payload: Record<string, string | number> = {};

  const houseNo = vcard.addressHouseNo.trim();
  const areaBase = vcard.addressArea.trim();
  const area = houseNo && areaBase
    ? `${houseNo}, ${areaBase}`
    : houseNo || areaBase;
  const brgy = vcard.addressBrgy.trim();
  const city = vcard.addressCity.trim();
  const region = vcard.addressRegion.trim();
  const zipcode = vcard.addressZipcode.trim();
  const landmark = vcard.addressLandmark.trim();

  if (area) payload.area = area;
  if (brgy) payload.brgy = brgy;
  if (city) payload.city = city;
  if (region) payload.region = region;
  if (zipcode) payload.zipcode = zipcode;
  if (isUrl && mapValue) payload.mapLink = mapValue;
  if (!isUrl && mapValue) payload.plusCode = mapValue;
  if (vcard.addressLatitude != null) payload.latitude = vcard.addressLatitude;
  if (vcard.addressLongitude != null) payload.longitude = vcard.addressLongitude;

  const hasCoreAddress =
    Boolean(area) ||
    Boolean(brgy) ||
    Boolean(city) ||
    Boolean(region) ||
    Boolean(zipcode) ||
    Boolean(mapValue) ||
    vcard.addressLatitude != null ||
    vcard.addressLongitude != null;

  // Only send landmark when there is address content (so clears work) or landmark itself is set.
  // Never send `{ landmark: "" }` alone — that used to 422 / wipe address on every save.
  if (landmark) {
    payload.landmark = landmark;
  } else if (hasCoreAddress) {
    payload.landmark = '';
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}
