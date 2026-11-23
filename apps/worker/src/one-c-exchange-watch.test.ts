import { describe, expect, it, vi } from "vitest";

import { ONE_C_EXCHANGE_LATE_TOPIC, queueLateExchangeAlerts } from "./one-c-exchange-watch.js";
import { buildStaffAlert } from "./outbox-dispatcher.js";

function fakePool(rows: Array<{ source_key: string }>, failInsert = false) {
  const statements: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      statements.push(sql.trim().split(/\s+/u).slice(0, 2).join(" "));
      if (sql.includes("INSERT INTO app.outbox_events")) {
        if (failInsert) throw new Error("connection lost");
        return { rows };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { client, pool: { connect: vi.fn(async () => client) } as never, statements };
}

describe("the watch over a late 1С exchange", () => {
  it("queues the alert under a lock and names the late bases", async () => {
    const { client, pool, statements } = fakePool([{ source_key: "one_c" }]);
    const logger = { warn: vi.fn() };

    expect(await queueLateExchangeAlerts(pool, logger)).toEqual(["one_c"]);

    expect(statements).toEqual(["BEGIN", "SELECT pg_advisory_xact_lock(hashtext($1))", "INSERT INTO", "COMMIT"]);
    expect(logger.warn).toHaveBeenCalledWith({ sources: ["one_c"] }, expect.any(String));
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("stays quiet while every base is on time", async () => {
    const { pool } = fakePool([]);
    const logger = { warn: vi.fn() };
    expect(await queueLateExchangeAlerts(pool, logger)).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("rolls back and gives the connection back when the database fails", async () => {
    const { client, pool, statements } = fakePool([], true);
    await expect(queueLateExchangeAlerts(pool, { warn: vi.fn() })).rejects.toThrow("connection lost");
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe("the staff alert about a late 1С exchange", () => {
  const payload = {
    displayName: "Основная база 1С",
    expectedSyncMinutes: 1440,
    lastOffersExchangeAt: "2026-11-20T03:00:00Z",
    sourceKey: "one_c",
  };

  it("says which base is silent, for how long and where to look", () => {
    const alert = buildStaffAlert(ONE_C_EXCHANGE_LATE_TOPIC, payload, "https://an30.ru", new Date("2026-11-23T04:00:00Z"));
    expect(alert).toBe(
      "Обмен с 1С задерживается: «Основная база 1С» не присылала цены и остатки 3 сут. (ожидается раз в сутки). "
      + "Сайт показывает данные последнего обмена. Проверьте расписание обмена в 1С и «Отказы на входе». https://an30.ru/admin/settings",
    );
  });

  it("counts a shorter silence in hours and names a base that has no name of its own", () => {
    const alert = buildStaffAlert(
      ONE_C_EXCHANGE_LATE_TOPIC,
      { ...payload, displayName: "", expectedSyncMinutes: 30, lastOffersExchangeAt: "2026-11-23T01:00:00Z", sourceKey: "one_c_secondary" },
      "https://an30.ru",
      new Date("2026-11-23T04:00:00Z"),
    );
    expect(alert).toContain("«Дополнительная база 1С» не присылала цены и остатки 3 ч (ожидается каждые 30 мин.)");
  });

  it("rejects a payload with fields it does not know", () => {
    expect(() => buildStaffAlert(ONE_C_EXCHANGE_LATE_TOPIC, { ...payload, password: "x" }, "https://an30.ru")).toThrow();
  });
});
