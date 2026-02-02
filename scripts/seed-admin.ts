import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "valerynistratov@gmail.com";
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.error("Установите переменную окружения ADMIN_PASSWORD");
    console.error("Пример: ADMIN_PASSWORD=your_password npx tsx scripts/seed-admin.ts");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: { password: hash, role: "admin" },
    create: { email, password: hash, role: "admin" },
  });

  console.log(`Admin user created/updated: ${user.email} (role: ${user.role})`);
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
