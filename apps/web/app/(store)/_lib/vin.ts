const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/i;

export const EXPERT_HELP_VIN_STORAGE_KEY = "an30:expert-help:vin-prefill";

export function isValidVin(value: string): boolean {
  return VIN_PATTERN.test(value);
}
