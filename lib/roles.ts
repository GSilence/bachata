/**
 * Роли пользователей. Расширяемо: при добавлении новых ролей добавить сюда и в БД (default "user").
 */
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export function isAdmin(role: string | undefined | null): boolean {
  return role === ROLES.ADMIN;
}
