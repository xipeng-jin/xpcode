import type {
  DesktopSecretStorageRecommendedPasswordStore,
  DesktopSecretStorageStatus,
} from "@t3tools/contracts";

const VALID_LINUX_PASSWORD_STORES = new Set<DesktopSecretStorageRecommendedPasswordStore>([
  "gnome-libsecret",
  "kwallet6",
  "kwallet5",
  "kwallet",
]);

function isSupportedLinuxPasswordStore(
  value: string,
): value is DesktopSecretStorageRecommendedPasswordStore {
  return VALID_LINUX_PASSWORD_STORES.has(value as DesktopSecretStorageRecommendedPasswordStore);
}

interface SafeStorageLike {
  readonly isEncryptionAvailable: () => boolean;
  readonly getSelectedStorageBackend?: () => string;
}

function readDesktopEnvironment(env: NodeJS.ProcessEnv): string | null {
  const desktopEnvironment = env.XDG_CURRENT_DESKTOP?.trim() || env.DESKTOP_SESSION?.trim();
  return desktopEnvironment && desktopEnvironment.length > 0 ? desktopEnvironment : null;
}

function normalizeSecretStorageBackend(backend: string | undefined): string | null {
  const trimmed = backend?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function resolveRecommendedPasswordStore(
  platform: string,
  desktopEnvironment: string | null,
): DesktopSecretStorageRecommendedPasswordStore | null {
  if (platform !== "linux") {
    return null;
  }

  const normalizedDesktopEnvironment = desktopEnvironment?.toLowerCase() ?? "";
  if (
    normalizedDesktopEnvironment.includes("kde") ||
    normalizedDesktopEnvironment.includes("plasma")
  ) {
    return "kwallet6";
  }

  return "gnome-libsecret";
}

function buildUnavailableSecretStorageMessage(input: {
  readonly platform: string;
  readonly backend: string | null;
  readonly desktopEnvironment: string | null;
  readonly recommendedPasswordStore: DesktopSecretStorageRecommendedPasswordStore | null;
}): string {
  const backend = input.backend ?? "unknown";

  if (input.platform === "linux") {
    const desktopEnvironment = input.desktopEnvironment ?? "unknown";
    const recommendedPasswordStoreMessage = input.recommendedPasswordStore
      ? ` After installing and unlocking a supported secret store, relaunch T3 Code. If needed, set T3CODE_DESKTOP_PASSWORD_STORE=${input.recommendedPasswordStore}.`
      : " After installing and unlocking a supported secret store, relaunch T3 Code.";

    return `Secure credential storage is unavailable on this desktop, so T3 Code will not pair remote environments yet. This prevents one-time pairing links from being consumed and lost. Desktop session: ${desktopEnvironment}. Secret storage backend: ${backend}.${recommendedPasswordStoreMessage}`;
  }

  return `Secure credential storage is unavailable on this desktop, so T3 Code will not pair remote environments yet. This prevents one-time pairing links from being consumed and lost. Secret storage backend: ${backend}.`;
}

export function resolveDesktopSecretStorageStatus(input: {
  readonly platform: string;
  readonly env: NodeJS.ProcessEnv;
  readonly safeStorage: SafeStorageLike;
}): DesktopSecretStorageStatus {
  const backend = normalizeSecretStorageBackend(input.safeStorage.getSelectedStorageBackend?.());
  const desktopEnvironment = readDesktopEnvironment(input.env);
  const sessionType = input.env.XDG_SESSION_TYPE?.trim() || null;
  const recommendedPasswordStore = resolveRecommendedPasswordStore(
    input.platform,
    desktopEnvironment,
  );
  const available =
    input.safeStorage.isEncryptionAvailable() &&
    !(input.platform === "linux" && backend === "basic_text");

  return {
    available,
    platform: input.platform,
    backend,
    desktopEnvironment,
    sessionType,
    recommendedPasswordStore,
    message: available
      ? null
      : buildUnavailableSecretStorageMessage({
          platform: input.platform,
          backend,
          desktopEnvironment,
          recommendedPasswordStore,
        }),
  } satisfies DesktopSecretStorageStatus;
}

export function resolveLinuxPasswordStoreSwitch(input: {
  readonly platform: string;
  readonly env: NodeJS.ProcessEnv;
  readonly argv: readonly string[];
}): DesktopSecretStorageRecommendedPasswordStore | null {
  if (input.platform !== "linux") {
    return null;
  }

  if (
    input.argv.some(
      (argument) => argument === "--password-store" || argument.startsWith("--password-store="),
    )
  ) {
    return null;
  }

  const configuredPasswordStore = input.env.T3CODE_DESKTOP_PASSWORD_STORE?.trim();
  if (!configuredPasswordStore || !isSupportedLinuxPasswordStore(configuredPasswordStore)) {
    return null;
  }

  return configuredPasswordStore;
}

export function applyLinuxPasswordStoreSwitch(input: {
  readonly platform: string;
  readonly env: NodeJS.ProcessEnv;
  readonly argv: readonly string[];
  readonly app: {
    readonly commandLine: {
      readonly appendSwitch: (name: string, value: string) => void;
    };
  };
}): DesktopSecretStorageRecommendedPasswordStore | null {
  const passwordStore = resolveLinuxPasswordStoreSwitch(input);
  if (passwordStore === null) {
    return null;
  }

  input.app.commandLine.appendSwitch("password-store", passwordStore);
  return passwordStore;
}
