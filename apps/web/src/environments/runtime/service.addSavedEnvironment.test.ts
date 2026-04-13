import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveRemotePairingTarget = vi.fn();
const mockFetchRemoteEnvironmentDescriptor = vi.fn();
const mockBootstrapRemoteBearerSession = vi.fn();
const mockPersistSavedEnvironmentRecord = vi.fn();
const mockWriteSavedEnvironmentBearerToken = vi.fn();
const mockSetSavedEnvironmentRegistry = vi.fn();
const mockGetSecretStorageStatus = vi.fn();
const mockUpsert = vi.fn();
const mockListSavedEnvironmentRecords = vi.fn();

vi.mock("../remote/target", () => ({
  resolveRemotePairingTarget: mockResolveRemotePairingTarget,
}));

vi.mock("../remote/api", () => ({
  bootstrapRemoteBearerSession: mockBootstrapRemoteBearerSession,
  fetchRemoteEnvironmentDescriptor: mockFetchRemoteEnvironmentDescriptor,
  fetchRemoteSessionState: vi.fn(),
  resolveRemoteWebSocketConnectionUrl: vi.fn(),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({
    persistence: {
      getSecretStorageStatus: mockGetSecretStorageStatus,
      setSavedEnvironmentRegistry: mockSetSavedEnvironmentRegistry,
    },
  }),
}));

vi.mock("./catalog", () => ({
  getSavedEnvironmentRecord: vi.fn(),
  hasSavedEnvironmentRegistryHydrated: vi.fn(),
  listSavedEnvironmentRecords: mockListSavedEnvironmentRecords,
  persistSavedEnvironmentRecord: mockPersistSavedEnvironmentRecord,
  readSavedEnvironmentBearerToken: vi.fn(),
  removeSavedEnvironmentBearerToken: vi.fn(),
  useSavedEnvironmentRegistryStore: {
    getState: () => ({
      upsert: mockUpsert,
      remove: vi.fn(),
      markConnected: vi.fn(),
    }),
  },
  useSavedEnvironmentRuntimeStore: {
    getState: () => ({
      ensure: vi.fn(),
      patch: vi.fn(),
      clear: vi.fn(),
    }),
  },
  waitForSavedEnvironmentRegistryHydration: vi.fn(),
  writeSavedEnvironmentBearerToken: mockWriteSavedEnvironmentBearerToken,
}));

vi.mock("./connection", () => ({
  createEnvironmentConnection: vi.fn(),
}));

describe("addSavedEnvironment", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      desktopBridge: {},
    });
    mockResolveRemotePairingTarget.mockReturnValue({
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
      credential: "pairing-code",
    });
    mockFetchRemoteEnvironmentDescriptor.mockResolvedValue({
      environmentId: EnvironmentId.make("environment-1"),
      label: "Remote environment",
    });
    mockBootstrapRemoteBearerSession.mockResolvedValue({
      sessionToken: "bearer-token",
      role: "owner",
    });
    mockPersistSavedEnvironmentRecord.mockResolvedValue(undefined);
    mockWriteSavedEnvironmentBearerToken.mockResolvedValue(false);
    mockSetSavedEnvironmentRegistry.mockResolvedValue(undefined);
    mockListSavedEnvironmentRecords.mockReturnValue([]);
    mockGetSecretStorageStatus.mockResolvedValue({
      available: true,
      platform: "linux",
      backend: "gnome_libsecret",
      desktopEnvironment: "Hyprland",
      sessionType: "wayland",
      recommendedPasswordStore: "gnome-libsecret",
      message: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects before any remote request when desktop secret storage is unavailable", async () => {
    const { addSavedEnvironment, resetEnvironmentServiceForTests } = await import("./service");
    mockGetSecretStorageStatus.mockResolvedValue({
      available: false,
      platform: "linux",
      backend: "basic_text",
      desktopEnvironment: "Hyprland",
      sessionType: "wayland",
      recommendedPasswordStore: "gnome-libsecret",
      message:
        "Secure credential storage is unavailable on this desktop, so T3 Code will not pair remote environments yet.",
    });

    await expect(
      addSavedEnvironment({
        label: "Remote environment",
        host: "remote.example.com",
        pairingCode: "123456",
      }),
    ).rejects.toThrow(
      "Secure credential storage is unavailable on this desktop, so T3 Code will not pair remote environments yet.",
    );

    expect(mockFetchRemoteEnvironmentDescriptor).not.toHaveBeenCalled();
    expect(mockBootstrapRemoteBearerSession).not.toHaveBeenCalled();
    expect(mockPersistSavedEnvironmentRecord).not.toHaveBeenCalled();

    await resetEnvironmentServiceForTests();
  });

  it("rolls back persisted metadata and reports the specific secret-storage error on write failure", async () => {
    const { addSavedEnvironment, resetEnvironmentServiceForTests } = await import("./service");
    mockGetSecretStorageStatus
      .mockResolvedValueOnce({
        available: true,
        platform: "linux",
        backend: "gnome_libsecret",
        desktopEnvironment: "Hyprland",
        sessionType: "wayland",
        recommendedPasswordStore: "gnome-libsecret",
        message: null,
      })
      .mockResolvedValueOnce({
        available: false,
        platform: "linux",
        backend: "basic_text",
        desktopEnvironment: "Hyprland",
        sessionType: "wayland",
        recommendedPasswordStore: "gnome-libsecret",
        message:
          "Secure credential storage is unavailable on this desktop, so T3 Code will not pair remote environments yet. This prevents one-time pairing links from being consumed and lost.",
      });

    await expect(
      addSavedEnvironment({
        label: "Remote environment",
        host: "remote.example.com",
        pairingCode: "123456",
      }),
    ).rejects.toThrow(
      "Secure credential storage is unavailable on this desktop, so T3 Code will not pair remote environments yet. This prevents one-time pairing links from being consumed and lost.",
    );

    expect(mockPersistSavedEnvironmentRecord).toHaveBeenCalledTimes(1);
    expect(mockWriteSavedEnvironmentBearerToken).toHaveBeenCalledWith(
      EnvironmentId.make("environment-1"),
      "bearer-token",
    );
    expect(mockSetSavedEnvironmentRegistry).toHaveBeenCalledWith([]);
    expect(mockUpsert).not.toHaveBeenCalled();

    await resetEnvironmentServiceForTests();
  });

  it("falls back to a generic persistence error when token write fails but secret storage is still available", async () => {
    const { addSavedEnvironment, resetEnvironmentServiceForTests } = await import("./service");
    mockGetSecretStorageStatus.mockResolvedValue({
      available: true,
      platform: "linux",
      backend: "gnome_libsecret",
      desktopEnvironment: "Hyprland",
      sessionType: "wayland",
      recommendedPasswordStore: "gnome-libsecret",
      message: null,
    });

    await expect(
      addSavedEnvironment({
        label: "Remote environment",
        host: "remote.example.com",
        pairingCode: "123456",
      }),
    ).rejects.toThrow("Failed to persist saved environment credentials.");

    expect(mockPersistSavedEnvironmentRecord).toHaveBeenCalledTimes(1);
    expect(mockWriteSavedEnvironmentBearerToken).toHaveBeenCalledWith(
      EnvironmentId.make("environment-1"),
      "bearer-token",
    );
    expect(mockSetSavedEnvironmentRegistry).toHaveBeenCalledWith([]);

    await resetEnvironmentServiceForTests();
  });
});
