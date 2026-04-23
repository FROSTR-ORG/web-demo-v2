import { expect, test, type Page } from "@playwright/test";

/**
 * Outside-runtime workflow coverage.
 *
 * These tests exercise import, rotate, recover, and returning-user flows with
 * packages generated directly through the WASM bridge and a synthetic relay
 * URL (`wss://relay.example.test`). They intentionally assert successful app
 * navigation and persisted profile state rather than live relay convergence;
 * multi-device relay behavior is covered by the dedicated live-relay specs.
 */

const DB_NAME = "keyval-store";
const STORE_NAME = "keyval";
const PROFILE_INDEX_KEY = "igloo.web-demo-v2.profile-index";
const PROFILE_RECORD_PREFIX = "igloo.web-demo-v2.profile.";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await clearIdb(page);
});

async function expectDashboardReady(page: Page, expectedLabel: string) {
  await expect(page).toHaveURL(/\/dashboard\//, { timeout: 30_000 });
  await expect(page.locator(".app-header")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(expectedLabel).first()).toBeVisible({
    timeout: 30_000,
  });
}

test("generate nsec, create keyset, reload to returning welcome, and unlock", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create New Keyset" }).click();
  await page.getByLabel("Keyset Name").fill("Returning Flow Key");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  const nsecInput = page.getByPlaceholder("Paste your existing nsec or generate a new one");
  await expect(nsecInput).toHaveValue(/nsec1/);
  await page.getByRole("button", { name: "Reveal nsec" }).click();
  await expect(nsecInput).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Create Keyset" }).click();

  await expect(page.getByRole("heading", { name: "Create Profile" })).toBeVisible();
  await page.getByLabel("Profile Name").fill("Returning Browser");
  // fix-followup-distribute-2a/2c — the former shared "Remote Package
  // Password" field on /create/profile was removed in 2A; remote
  // passwords are now collected per share on /create/distribute via
  // the per-share Password input + Create package CTA (Paper 8GU-0).
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("test-password");
  await page.getByRole("textbox", { name: "Confirm Password", exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Continue to Distribute Shares" }).click();

  await expect(page.getByRole("heading", { name: "Distribute Shares" })).toBeVisible({ timeout: 30_000 });

  const packagePasswordInputs = page.getByLabel(/^Package password for share \d+$/);
  const remoteCount = await packagePasswordInputs.count();
  expect(remoteCount).toBeGreaterThan(0);
  const createPackageButtons = page.getByRole("button", { name: "Create package" });
  for (let index = 0; index < remoteCount; index += 1) {
    await packagePasswordInputs.first().fill(`remote-package-password-${index + 1}`);
    await createPackageButtons.first().click();
    await expect(createPackageButtons).toHaveCount(remoteCount - index - 1, {
      timeout: 10_000,
    });
  }

  const markDistributedButtons = page.getByRole("button", { name: /^Mark distributed$/ });
  await expect(markDistributedButtons).toHaveCount(remoteCount);
  for (let index = 0; index < remoteCount; index += 1) {
    await markDistributedButtons.nth(index).click();
  }

  await page.getByRole("button", { name: "Continue to Completion" }).click();
  await page.getByRole("button", { name: "Finish Distribution" }).click();
  await expectDashboardReady(page, "Returning Flow Key");

  await page.reload();
  await expect(page.getByText("Welcome back.")).toBeVisible();
  await page.getByRole("button", { name: "Unlock" }).first().click();
  await page.getByLabel("Profile Password").fill("test-password");
  await page.getByRole("button", { name: "Unlock" }).last().click();
  await expectDashboardReady(page, "Returning Flow Key");
});

test("manual pasted nsec remains unsupported", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create New Keyset" }).click();
  await page.getByPlaceholder("Paste your existing nsec or generate a new one").fill("invalid-key");
  await page.getByRole("button", { name: "Create Keyset" }).click();
  await expect(page.getByText("Invalid nsec format — must start with nsec1.")).toBeVisible();
});

test("imports a generated bfprofile through decrypt and review", async ({ page }) => {
  const fixture = await createProtocolFixture(page, { storeProfile: false });
  await page.goto("/");
  await page.getByRole("button", { name: "Import Device Profile" }).click();
  await page.getByPlaceholder("bfprofile1...").fill(fixture.profilePackage);
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Backup Password").fill(fixture.profilePassword);
  await page.getByRole("button", { name: "Decrypt Backup" }).click();
  await expect(page.getByRole("heading", { name: "Review & Save Profile" })).toBeVisible();
  await expect(page.getByText("Outside Flow Key")).toBeVisible();
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("import-local-password");
  await page.getByRole("textbox", { name: "Confirm Password", exact: true }).fill("import-local-password");
  await page.getByRole("button", { name: "Import & Launch Signer" }).click();

  await expectDashboardReady(page, "Outside Flow Key");
});

test("rotates a returning profile from a generated bfshare source", async ({ page }) => {
  const fixture = await createProtocolFixture(page, { storeProfile: true });
  await page.goto("/");
  await expect(page.getByText("Welcome back.")).toBeVisible();
  await page.getByRole("button", { name: "Rotate" }).first().click();

  await page.getByPlaceholder("Enter saved profile password").fill(fixture.profilePassword);
  await page.getByPlaceholder("Paste bfshare from another device or backup...").fill(fixture.externalSharePackage);
  await page.getByPlaceholder("Enter password to decrypt").fill(fixture.sourcePassword);
  await page.getByRole("button", { name: "Validate & Continue" }).click();

  await expect(page.getByRole("heading", { name: "Review & Generate" })).toBeVisible();
  await page.getByRole("button", { name: "Rotate & Generate Keyset" }).click();

  await expect(page.getByRole("heading", { name: "Create Profile" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Profile Name").fill("Rotated Browser");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("rotated-local-password");
  await page.getByRole("textbox", { name: "Confirm Password", exact: true }).fill("rotated-local-password");
  await page.getByRole("button", { name: "Continue to Distribute Shares" }).click();

  await expect(page.getByRole("heading", { name: "Distribute Shares" })).toBeVisible();
  const packagePasswordInputs = page.locator("input.password-input");
  const remotePackageCount = await packagePasswordInputs.count();
  expect(remotePackageCount).toBeGreaterThan(0);

  const createPackageButtons = page.getByRole("button", { name: "Create package" });
  for (let index = 0; index < remotePackageCount; index += 1) {
    await packagePasswordInputs.first().fill(`rotate-package-password-${index + 1}`);
    await createPackageButtons.first().click();
    await expect(createPackageButtons).toHaveCount(
      remotePackageCount - index - 1,
      { timeout: 10_000 },
    );
  }

  const markDistributedButtons = page.getByRole("button", { name: /^Mark distributed$/ });
  await expect(markDistributedButtons).toHaveCount(remotePackageCount);
  for (let index = 0; index < remotePackageCount; index += 1) {
    await markDistributedButtons.nth(index).click();
  }

  await page.getByRole("button", { name: "Continue to Completion" }).click();
  await page.getByRole("button", { name: "Finish Distribution" }).click();

  await expectDashboardReady(page, "Outside Flow Key");
});

test("recovers a real nsec from a returning profile and generated bfshare source", async ({ page }) => {
  const fixture = await createProtocolFixture(page, { storeProfile: true, fromGeneratedNsec: true });
  expect(fixture.recoveredNsec).toBe(fixture.generatedNsec);
  await page.goto("/");
  await expect(page.getByText("Welcome back.")).toBeVisible();
  await page.getByRole("button", { name: "Unlock" }).first().click();
  await page.getByLabel("Profile Password").fill(fixture.profilePassword);
  await page.getByRole("button", { name: "Unlock" }).last().click();
  await expectDashboardReady(page, "Outside Flow Key");

  await page.getByRole("button", { name: "Recover" }).click();
  await expect(page.getByRole("heading", { name: "Recover NSEC" })).toBeVisible();
  await page.getByLabel("Saved profile password").fill(fixture.profilePassword);
  await page.getByLabel("Source Share #2 bfshare package").fill(fixture.externalSharePackage);
  await page.getByLabel("Source Share #2 package password").fill(fixture.sourcePassword);
  await page.getByRole("button", { name: "Validate Sources" }).click();
  await expect(page.getByText("Loaded")).toHaveCount(2);

  await page.getByRole("button", { name: "Recover NSEC" }).click();
  await expect(page.getByText("Security Warning")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(fixture.recoveredNsec)).not.toBeVisible();
  await page.getByRole("button", { name: "Reveal" }).click();
  await expect(page.getByText(fixture.recoveredNsec)).toBeVisible();
  await page.getByRole("button", { name: "Copy to Clipboard" }).click();
  await expect(page.getByText("Copied!")).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();
  await expectDashboardReady(page, "Outside Flow Key");
});

async function clearIdb(page: Page) {
  await page.evaluate(
    async ({ dbName, storeName }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(storeName);
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).clear();
          tx.oncomplete = () => {
            db.close();
            sessionStorage.clear();
            localStorage.clear();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { dbName: DB_NAME, storeName: STORE_NAME }
  );
}

async function createProtocolFixture(page: Page, options: { storeProfile: boolean; fromGeneratedNsec?: boolean }) {
  return page.evaluate(
    async ({ dbName, storeName, indexKey, recordPrefix, storeProfile, fromGeneratedNsec }) => {
      const bridge = await (new Function("path", "return import(path)") as (path: string) => Promise<any>)(
        "/src/vendor/bifrost-bridge-wasm/bifrost_bridge_wasm.js"
      );
      await bridge.default();

      const relays = ["wss://relay.example.test"];
      const profilePassword = "fixture-profile-password";
      const sourcePassword = "fixture-source-password";
      const generatedNsec = fromGeneratedNsec ? JSON.parse(bridge.generate_nsec()).nsec : null;
      const keyset = JSON.parse(
        generatedNsec
          ? bridge.create_keyset_bundle_from_nsec(
              JSON.stringify({
                nsec: generatedNsec,
                group_name: "Outside Flow Key",
                threshold: 2,
                count: 3
              })
            )
          : bridge.create_keyset_bundle(
              JSON.stringify({
                group_name: "Outside Flow Key",
                threshold: 2,
                count: 3
              })
            )
      );
      const localShare = keyset.shares[0];
      const externalShare = keyset.shares[1];
      const profileId = bridge.derive_profile_id_from_share_secret(localShare.seckey);
      const payload = {
        profile_id: profileId,
        version: 1,
        device: {
          name: "Fixture Browser",
          share_secret: localShare.seckey,
          manual_peer_policy_overrides: [],
          relays
        },
        group_package: keyset.group
      };
      const pair = JSON.parse(bridge.create_profile_package_pair(JSON.stringify(payload), profilePassword));
      const externalSharePackage = bridge.encode_bfshare_package(
        JSON.stringify({
          share_secret: externalShare.seckey,
          relays
        }),
        sourcePassword
      );
      const recovered = JSON.parse(
        bridge.recover_nsec_from_shares(
          JSON.stringify({
            group: keyset.group,
            shares: [localShare, externalShare]
          })
        )
      );

      if (storeProfile) {
        const now = Date.now();
        const record = {
          summary: {
            id: profileId,
            label: keyset.group.group_name,
            deviceName: payload.device.name,
            groupName: keyset.group.group_name,
            threshold: keyset.group.threshold,
            memberCount: keyset.group.members.length,
            localShareIdx: localShare.idx,
            groupPublicKey: keyset.group.group_pk,
            relays,
            createdAt: now,
            lastUsedAt: now
          },
          encryptedProfilePackage: pair.profile_string
        };
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(dbName, 1);
          request.onupgradeneeded = () => {
            request.result.createObjectStore(storeName);
          };
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(storeName, "readwrite");
            const store = tx.objectStore(storeName);
            store.put([profileId], indexKey);
            store.put(record, `${recordPrefix}${profileId}`);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        });
      }

      return {
        profileId,
        profilePackage: pair.profile_string,
        profilePassword,
        sourcePassword,
        externalSharePackage,
        recoveredNsec: recovered.nsec,
        generatedNsec
      };
    },
    {
      dbName: DB_NAME,
      storeName: STORE_NAME,
      indexKey: PROFILE_INDEX_KEY,
      recordPrefix: PROFILE_RECORD_PREFIX,
      storeProfile: options.storeProfile,
      fromGeneratedNsec: options.fromGeneratedNsec ?? false
    }
  );
}
