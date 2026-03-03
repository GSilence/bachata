/**
 * Роли пользователей.
 */
export const ROLES = {
  ADMIN:     "admin",
  MODERATOR: "moderator",
  USER:      "user",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export function isAdmin(role: string | undefined | null): boolean {
  return role === ROLES.ADMIN;
}

export function isModerator(role: string | undefined | null): boolean {
  return role === ROLES.MODERATOR;
}

/** Может видеть все треки, управлять очередью и статусами */
export function isAdminOrModerator(role: string | undefined | null): boolean {
  return role === ROLES.ADMIN || role === ROLES.MODERATOR;
}
