import { afterEach, describe, expect, it } from "vitest";

import { absoluteUrl, deploymentEnvironment, indexingAllowed, siteBaseUrl } from "./site-config";

const originalBaseUrl = process.env.APP_BASE_URL;
const originalEnvironment = process.env.DEPLOYMENT_ENVIRONMENT;

afterEach(() => {
  process.env.APP_BASE_URL = originalBaseUrl;
  process.env.DEPLOYMENT_ENVIRONMENT = originalEnvironment;
});

describe("siteBaseUrl", () => {
  it("keeps only the origin of the configured base URL", () => {
    process.env.APP_BASE_URL = "https://an30.ru/catalog?utm=1";
    expect(siteBaseUrl()).toBe("https://an30.ru");
  });

  it("falls back when the configured value is not a URL", () => {
    process.env.APP_BASE_URL = "not a url";
    expect(siteBaseUrl()).toBe("http://localhost:3000");
  });

  it("falls back when the value is missing", () => {
    delete process.env.APP_BASE_URL;
    expect(siteBaseUrl()).toBe("http://localhost:3000");
  });
});

describe("absoluteUrl", () => {
  it("builds canonical links against the configured origin", () => {
    process.env.APP_BASE_URL = "https://an30.ru";
    expect(absoluteUrl("/catalog")).toBe("https://an30.ru/catalog");
    expect(absoluteUrl("/catalog/product/filtr")).toBe("https://an30.ru/catalog/product/filtr");
  });

  it("does not let a staging origin emit production links", () => {
    process.env.APP_BASE_URL = "https://staging.an30.ru";
    expect(absoluteUrl("/")).toBe("https://staging.an30.ru/");
  });
});

describe("indexingAllowed", () => {
  it("permits crawling only on production", () => {
    process.env.DEPLOYMENT_ENVIRONMENT = "production";
    expect(indexingAllowed()).toBe(true);
    expect(deploymentEnvironment()).toBe("production");
  });

  it("refuses crawling on staging", () => {
    process.env.DEPLOYMENT_ENVIRONMENT = "staging";
    expect(indexingAllowed()).toBe(false);
  });

  it("treats an unknown environment as development", () => {
    process.env.DEPLOYMENT_ENVIRONMENT = "qa";
    expect(deploymentEnvironment()).toBe("development");
    expect(indexingAllowed()).toBe(false);
  });
});
