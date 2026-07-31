import { useMemo, useEffect, useState } from "react";

const TIMEZONE = "Asia/Chita";

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

interface HoursSchedule {
  [day: string]: { open: string; close: string } | null;
}

const DEFAULT_SHOP_HOURS: HoursSchedule = {
  monday: { open: "09:00", close: "19:00" },
  tuesday: { open: "09:00", close: "19:00" },
  wednesday: { open: "09:00", close: "19:00" },
  thursday: { open: "09:00", close: "19:00" },
  friday: { open: "09:00", close: "19:00" },
  saturday: { open: "10:00", close: "17:00" },
  sunday: null,
};

function parseTime(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h + (m || 0) / 60;
}

function getChitaDate(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TIMEZONE }));
}

function checkIsOpen(hours: HoursSchedule): { isOpen: boolean; statusText: string } {
  const now = getChitaDate();
  const dayName = DAY_NAMES[now.getDay()];
  const todayHours = hours[dayName];
  const currentTime = now.getHours() + now.getMinutes() / 60;

  if (!todayHours) {
    // Find next open day
    for (let i = 1; i <= 7; i++) {
      const nextDay = DAY_NAMES[(now.getDay() + i) % 7];
      const nextHours = hours[nextDay];
      if (nextHours) {
        const dayLabel = i === 1 ? "завтра" : `в ${getDayLabel(nextDay)}`;
        return { isOpen: false, statusText: `Откроемся ${dayLabel} в ${nextHours.open}` };
      }
    }
    return { isOpen: false, statusText: "Закрыто" };
  }

  const open = parseTime(todayHours.open);
  const close = parseTime(todayHours.close);

  if (currentTime >= open && currentTime < close) {
    return { isOpen: true, statusText: `Открыто до ${todayHours.close}` };
  }

  if (currentTime < open) {
    return { isOpen: false, statusText: `Откроемся в ${todayHours.open}` };
  }

  // After closing — find next open
  for (let i = 1; i <= 7; i++) {
    const nextDay = DAY_NAMES[(now.getDay() + i) % 7];
    const nextHours = hours[nextDay];
    if (nextHours) {
      const dayLabel = i === 1 ? "завтра" : `в ${getDayLabel(nextDay)}`;
      return { isOpen: false, statusText: `Откроемся ${dayLabel} в ${nextHours.open}` };
    }
  }
  return { isOpen: false, statusText: "Закрыто" };
}

function getDayLabel(day: string): string {
  const labels: Record<string, string> = {
    monday: "понедельник",
    tuesday: "вторник",
    wednesday: "среду",
    thursday: "четверг",
    friday: "пятницу",
    saturday: "субботу",
    sunday: "воскресенье",
  };
  return labels[day] || day;
}

export function useStoreStatus(shopHours?: HoursSchedule | null) {
  const hours = shopHours || DEFAULT_SHOP_HOURS;

  const status = useMemo(() => {
    const result = checkIsOpen(hours);
    return { ...result, chitaTime: getChitaDate() };
  }, [hours]);

  return status;
}

/**
 * Check if chat is available based on chat_hours schedule.
 * Accepts optional chat_hours from DB; falls back to default schedule.
 */
export function isChatAvailable(chatHours?: HoursSchedule | null): boolean {
  const hours = chatHours || DEFAULT_SHOP_HOURS;
  return checkIsOpen(hours).isOpen;
}

/**
 * Hook that reactively tracks chat availability using DB-based schedule.
 * Fetches chat_hours from store_settings_public once and checks every minute.
 */
export function useChatAvailability() {
  // TEMPORARY: Chat is always online (time restrictions disabled)
  // To re-enable, restore the original logic that fetches chat_hours from store_settings_public
  const [isOnline] = useState(true);

  return { isOnline, chatHours: null };
}
