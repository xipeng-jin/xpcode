import { describe, expect, it, vi } from "vitest";

import {
  applyLinuxPasswordStoreSwitch,
  resolveDesktopSecretStorageStatus,
  resolveLinuxPasswordStoreSwitch,
} from "./secretStorage";

describe("secretStorage", () => {
  it("reports unavailable Linux secret storage with diagnostics and guidance", () => {
    const status = resolveDesktopSecretStorageStatus({
      platform: "linux",
      env: {
        XDG_CURRENT_DESKTOP: "Hyprland",
        XDG_SESSION_TYPE: "wayland",
      },
      safeStorage: {
        isEncryptionAvailable: () => false,
        getSelectedStorageBackend: () => "basic_text",
      },
    });

    expect(status).toEqual({
      available: false,
      platform: "linux",
      backend: "basic_text",
      desktopEnvironment: "Hyprland",
      sessionType: "wayland",
      recommendedPasswordStore: "gnome-libsecret",
      message: expect.stringContaining("Secure credential storage is unavailable on this desktop"),
    });
    expect(status.message).toContain("Desktop session: Hyprland");
    expect(status.message).toContain("Secret storage backend: basic_text");
    expect(status.message).toContain("T3CODE_DESKTOP_PASSWORD_STORE=gnome-libsecret");
  });

  it("treats Linux basic_text backend as unavailable even when encryption reports available", () => {
    const status = resolveDesktopSecretStorageStatus({
      platform: "linux",
      env: {
        XDG_CURRENT_DESKTOP: "Hyprland",
        XDG_SESSION_TYPE: "wayland",
      },
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => "basic_text",
      },
    });

    expect(status.available).toBe(false);
    expect(status.message).toContain("Secret storage backend: basic_text");
    expect(status.message).toContain("T3CODE_DESKTOP_PASSWORD_STORE=gnome-libsecret");
  });

  it("prefers kwallet guidance for KDE-like desktop environments", () => {
    const status = resolveDesktopSecretStorageStatus({
      platform: "linux",
      env: {
        XDG_CURRENT_DESKTOP: "KDE",
      },
      safeStorage: {
        isEncryptionAvailable: () => false,
        getSelectedStorageBackend: () => "unknown",
      },
    });

    expect(status.recommendedPasswordStore).toBe("kwallet6");
    expect(status.message).toContain("T3CODE_DESKTOP_PASSWORD_STORE=kwallet6");
  });

  it("accepts a supported Linux password-store override when no explicit CLI switch exists", () => {
    expect(
      resolveLinuxPasswordStoreSwitch({
        platform: "linux",
        env: {
          T3CODE_DESKTOP_PASSWORD_STORE: "gnome-libsecret",
        },
        argv: ["t3code"],
      }),
    ).toBe("gnome-libsecret");
  });

  it("does not override an explicit Chromium password-store argument", () => {
    expect(
      resolveLinuxPasswordStoreSwitch({
        platform: "linux",
        env: {
          T3CODE_DESKTOP_PASSWORD_STORE: "kwallet6",
        },
        argv: ["t3code", "--password-store=basic"],
      }),
    ).toBeNull();
  });

  it("appends the expected Chromium password-store switch when configured", () => {
    const appendSwitch = vi.fn();

    const selected = applyLinuxPasswordStoreSwitch({
      platform: "linux",
      env: {
        T3CODE_DESKTOP_PASSWORD_STORE: "kwallet6",
      },
      argv: ["t3code"],
      app: {
        commandLine: {
          appendSwitch,
        },
      },
    });

    expect(selected).toBe("kwallet6");
    expect(appendSwitch).toHaveBeenCalledWith("password-store", "kwallet6");
  });
});
