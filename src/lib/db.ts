import { PrismaClient } from "@prisma/client";

// Next.js recharge les modules en développement : on réutilise une instance
// unique pour ne pas épuiser le pool de connexions PostgreSQL.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
