import { LOGIN_ID_PATTERN } from "@j-customer-auth-db/contracts";
import type { GuestInput, GuestUpdate } from "@j-customer-auth-db/contracts";
import { invalid } from "./errors.js";
export function cleanText(value: string, max: number, allowEmpty = false) {
  if (!value.isWellFormed() || /[\u0000-\u001f\u007f]/u.test(value))
    throw invalid();
  const trimmed = value.trim();
  if ([...trimmed].length > max || (!allowEmpty && !trimmed)) throw invalid();
  return trimmed;
}
export function validatePassword(value: string) {
  if (
    !value.isWellFormed() ||
    value.includes("\0") ||
    [...value].length < 12 ||
    [...value].length > 128 ||
    Buffer.byteLength(value) > 512
  )
    throw invalid();
  return value;
}
export function normalizeGuest<T extends GuestInput | GuestUpdate>(
  value: T,
): T {
  if (value.name !== undefined) value.name = cleanText(value.name, 120);
  if (value.contact !== undefined)
    value.contact = cleanText(value.contact, 256, true);
  if (
    value.loginId !== undefined &&
    !new RegExp(LOGIN_ID_PATTERN).test(value.loginId)
  )
    throw invalid();
  if ("password" in value) validatePassword(value.password);
  return value;
}
