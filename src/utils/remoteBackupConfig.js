export const isRemoteBackupEnabled = String(import.meta.env.VITE_ENABLE_REMOTE_BACKUP ?? "true").toLowerCase() !== "false";
