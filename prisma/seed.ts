// ──────────────────────────────────────────────────────────────
// Prisma Seed — Required reference data + developer accounts
// ──────────────────────────────────────────────────────────────
// Run with:  npx prisma db seed
// Configured via "prisma.seed" in package.json
// ──────────────────────────────────────────────────────────────
//
// Theme paths are sourced from the frontend filesystem. Backend stores
// only theme metadata (name/path) and defaults user.theme_path to
// "ocean-gradient".
// ──────────────────────────────────────────────────────────────

import dotenv from "dotenv";
import bcryptjs from "bcryptjs";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env.local" });
dotenv.config();

const prisma = new PrismaClient();

const DEV_ACCOUNTS = [
  {
    email: "dev1@coliving.local",
    firstName: "Developer",
    lastName: "One",
  },
  {
    email: "dev2@coliving.local",
    firstName: "Developer",
    lastName: "Two",
  },
];

function generateStrongPassword(): string {
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const symbols = "!@#$%^&*_-+=";
  const allChars = uppercase + lowercase + digits + symbols;

  const passwordChars = [
    uppercase[Math.floor(Math.random() * uppercase.length)],
    lowercase[Math.floor(Math.random() * lowercase.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];

  for (let i = passwordChars.length; i < 16; i += 1) {
    passwordChars.push(allChars[Math.floor(Math.random() * allChars.length)]);
  }

  return passwordChars.sort(() => Math.random() - 0.5).join("");
}

async function hashPassword(password: string): Promise<string> {
  const salt = await bcryptjs.genSalt(12);
  return bcryptjs.hash(password, salt);
}

async function upsertDeveloperAccount(
  email: string,
  firstName: string,
  lastName: string,
  plainPassword: string
): Promise<{ userId: bigint; password: string }> {
  const hashedPassword = await hashPassword(plainPassword);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      role: "dev",
      first_name: firstName,
      last_name: lastName,
      is_active: true,
      deactivated_flag: false,
    },
    create: {
      email,
      first_name: firstName,
      last_name: lastName,
      role: "dev",
      is_active: true,
      deactivated_flag: false,
    },
  });

  await prisma.credential.upsert({
    where: { user_id: user.user_id },
    update: {
      password_hash: hashedPassword,
      email_verified: true,
      email_verified_at: new Date(),
    },
    create: {
      user_id: user.user_id,
      password_hash: hashedPassword,
      email_verified: true,
      email_verified_at: new Date(),
    },
  });
  return { userId: user.user_id, password: plainPassword };
}

async function main() {
  const themes = [
    { theme_name: "Ocean Gradient", theme_path: "ocean-gradient" },
    { theme_name: "Elegant Dark", theme_path: "elegant-dark" },
    { theme_name: "Royal Purple", theme_path: "royal-purple" },
    {
      theme_name: "BubbleGem",
      theme_path: "bubble-gem",
      tag: "premium",
      price: 99,
      category: "customize-templates",
      is_active: true,
      preview_images: JSON.stringify(["/images/template-res/floral-bg-1.png"]),
    },
    {
      theme_name: "Frosted Crystal",
      theme_path: "frosted-crystal",
      tag: "premium",
      price: 99,
      category: "customize-templates",
      is_active: true,
      preview_images: JSON.stringify(["/images/template-res/floral-bg-2.png"]),
    },
    {
      theme_name: "Velvet Noir",
      theme_path: "dark-cinematic",
      tag: "premium",
      price: 99,
      category: "customize-templates",
      is_active: true,
      preview_images: JSON.stringify(["/images/template-res/floral-bg-1.png"]),
    },
  ];

  for (const theme of themes) {
    await prisma.theme.upsert({
      where: { theme_path: theme.theme_path },
      update: {
        theme_name: theme.theme_name,
        ...("tag" in theme ? { tag: theme.tag } : {}),
        ...("price" in theme ? { price: theme.price } : {}),
        ...("category" in theme ? { category: theme.category } : {}),
        ...("is_active" in theme ? { is_active: theme.is_active } : {}),
        ...("preview_images" in theme ? { preview_images: theme.preview_images } : {}),
      },
      create: theme,
    });
  }

  console.log(`Seed complete: ${themes.length} theme paths upserted.`);

  console.log("\nCreating developer accounts:\n");

  for (const account of DEV_ACCOUNTS) {
    const password = generateStrongPassword();
    const result = await upsertDeveloperAccount(
      account.email,
      account.firstName,
      account.lastName,
      password
    );

    console.log(`Developer account created:`);
    console.log(`  Email:    ${account.email}`);
    console.log(`  Password: ${password}`);
    console.log(`  User ID:  ${result.userId}`);
    console.log(`  Role:     dev`);
    console.log("");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
