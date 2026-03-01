/**
 * Устанавливает роль admin для указанного email (без смены пароля).
 * Безопасность: скрипт выполняется только при наличии секрета SET_ADMIN_SECRET в окружении.
 * Секрет задаётся только на сервере (например в .env, который не коммитится) и никому не передаётся.
 *
 * Использование (локально/на сервере):
 *   SET_ADMIN_SECRET=ваш_секрет_из_env npx tsx scripts/set-admin-email.ts
 *   ADMIN_EMAIL=email@example.com SET_ADMIN_SECRET=... npx tsx scripts/set-admin-email.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_EMAIL = "valerynistratov@gmail.com";

async function main() {
  const secret = process.env.SET_ADMIN_SECRET;
  if (!secret || secret.trim() === "") {
    console.error(
      "Отказ: для запуска скрипта необходимо задать переменную окружения SET_ADMIN_SECRET.",
    );
    console.error(
      "Секрет храните только на сервере (например в .env), не коммитьте его в репозиторий.",
    );
    process.exit(1);
  }

  const email = process.env.ADMIN_EMAIL ?? DEFAULT_EMAIL;

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (!user) {
    console.error(`Пользователь с email "${email}" не найден.`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { email: user.email },
    data: { role: "admin" },
  });

  console.log(`Роль admin установлена для: ${user.email}`);
}

main()
  .catch((e) => {
    console.error("Ошибка:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
