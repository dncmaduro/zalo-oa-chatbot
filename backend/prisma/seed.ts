import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { OperatorRoleCode, OperatorStatus, PrismaClient } from '../src/generated/prisma/client';
import { hashPassword } from '../src/modules/auth/password-hash';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

const isProduction = process.env.NODE_ENV === 'production';

// ======================================================
// DEVELOPMENT ACCOUNTS
// ======================================================

const DEV_OPERATOR_EMAIL = 'operator.dev@local.test';
const DEV_OPERATOR_PASSWORD = 'dev-operator-password';

const DEV_ADMIN_EMAIL = 'admin.dev@local.test';
const DEV_ADMIN_PASSWORD = 'dev-admin-password';

// ======================================================
// PRODUCTION ADMIN
// ======================================================

const PROD_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL?.trim();
const PROD_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const PROD_ADMIN_FULL_NAME = process.env.SEED_ADMIN_FULL_NAME?.trim() || 'Administrator';

// ======================================================
// PERMISSIONS
// ======================================================

const permissions = [
  // Knowledge
  ['knowledge.read', 'Xem Knowledge Base'],
  ['knowledge.create', 'Tạo knowledge'],
  ['knowledge.update', 'Sửa knowledge'],
  ['knowledge.publish', 'Publish knowledge'],
  ['knowledge.import', 'Import knowledge từ Excel'],
  ['knowledge.review', 'Xử lý review issue'],

  // Conversations
  ['conversation.read', 'Xem hội thoại'],
  ['conversation.reply', 'Trả lời hội thoại'],
  ['conversation.takeover', 'Tiếp quản hội thoại'],

  // Operator Tasks
  ['task.read', 'Xem công việc vận hành'],
  ['task.assign', 'Phân công công việc'],
  ['task.update', 'Cập nhật công việc'],
  ['task.complete', 'Hoàn thành công việc'],

  // Human contact
  ['contact.read', 'Xem yêu cầu liên hệ'],
  ['contact.assign', 'Phân công yêu cầu liên hệ'],
  ['contact.update', 'Cập nhật yêu cầu liên hệ'],

  // Operator management
  ['operator.read', 'Xem nhân viên vận hành'],
  ['operator.manage', 'Quản lý nhân viên vận hành'],

  // Audit
  ['audit.read', 'Xem audit log'],
] as const;

const leaderPermissionCodes = new Set<string>([
  'knowledge.read',
  'knowledge.create',
  'knowledge.update',
  'knowledge.publish',
  'knowledge.import',
  'knowledge.review',

  'conversation.read',
  'conversation.reply',
  'conversation.takeover',

  'task.read',
  'task.assign',
  'task.update',
  'task.complete',

  'contact.read',
  'contact.assign',
  'contact.update',

  'operator.read',
  'audit.read',
]);

const operatorPermissionCodes = new Set<string>([
  'knowledge.read',

  'conversation.read',
  'conversation.reply',

  'task.read',
  'task.update',
  'task.complete',

  'contact.read',
  'contact.update',
]);

// ======================================================
// HELPERS
// ======================================================

async function seedPermissions() {
  for (const [code, name] of permissions) {
    await prisma.permission.upsert({
      where: { code },
      update: { name },
      create: {
        code,
        name,
      },
    });
  }
}

async function seedRoles() {
  const admin = await prisma.role.upsert({
    where: {
      code: OperatorRoleCode.ADMIN,
    },
    update: {
      name: 'Administrator',
    },
    create: {
      code: OperatorRoleCode.ADMIN,
      name: 'Administrator',
    },
  });

  const leader = await prisma.role.upsert({
    where: {
      code: OperatorRoleCode.LEADER,
    },
    update: {
      name: 'Leader',
    },
    create: {
      code: OperatorRoleCode.LEADER,
      name: 'Leader',
    },
  });

  const operator = await prisma.role.upsert({
    where: {
      code: OperatorRoleCode.OPERATOR,
    },
    update: {
      name: 'Operator',
    },
    create: {
      code: OperatorRoleCode.OPERATOR,
      name: 'Operator',
    },
  });

  return {
    admin,
    leader,
    operator,
  };
}

async function syncRolePermissions(roles: Awaited<ReturnType<typeof seedRoles>>) {
  const configuredPermissionCodes = permissions.map(([code]) => code);

  const allPermissions = await prisma.permission.findMany({
    where: {
      code: {
        in: configuredPermissionCodes,
      },
    },
  });

  const rolePermissions = [
    {
      role: roles.admin,
      permissions: allPermissions,
    },
    {
      role: roles.leader,
      permissions: allPermissions.filter((permission) => leaderPermissionCodes.has(permission.code)),
    },
    {
      role: roles.operator,
      permissions: allPermissions.filter((permission) => operatorPermissionCodes.has(permission.code)),
    },
  ];

  for (const item of rolePermissions) {
    await prisma.$transaction(async (tx) => {
      // Permission matrix trong file seed là source of truth.
      // Xóa mapping cũ trước để các quyền đã bỏ khỏi role
      // không còn tồn tại âm thầm trong database.
      await tx.rolePermission.deleteMany({
        where: {
          roleId: item.role.id,
        },
      });

      if (item.permissions.length === 0) {
        return;
      }

      await tx.rolePermission.createMany({
        data: item.permissions.map((permission) => ({
          roleId: item.role.id,
          permissionId: permission.id,
        })),
      });
    });
  }
}

async function seedDevelopmentAccounts(roles: Awaited<ReturnType<typeof seedRoles>>) {
  const developmentOperatorPasswordHash = await hashPassword(DEV_OPERATOR_PASSWORD);

  const developmentAdminPasswordHash = await hashPassword(DEV_ADMIN_PASSWORD);

  await prisma.operator.upsert({
    where: {
      email: DEV_OPERATOR_EMAIL,
    },
    update: {
      roleId: roles.operator.id,
      fullName: 'Dev Operator',
      status: OperatorStatus.ACTIVE,
      passwordHash: developmentOperatorPasswordHash,
    },
    create: {
      email: DEV_OPERATOR_EMAIL,
      fullName: 'Dev Operator',
      roleId: roles.operator.id,
      status: OperatorStatus.ACTIVE,
      passwordHash: developmentOperatorPasswordHash,
    },
  });

  await prisma.operator.upsert({
    where: {
      email: DEV_ADMIN_EMAIL,
    },
    update: {
      roleId: roles.admin.id,
      fullName: 'Dev Admin',
      status: OperatorStatus.ACTIVE,
      passwordHash: developmentAdminPasswordHash,
    },
    create: {
      email: DEV_ADMIN_EMAIL,
      fullName: 'Dev Admin',
      roleId: roles.admin.id,
      status: OperatorStatus.ACTIVE,
      passwordHash: developmentAdminPasswordHash,
    },
  });

  console.log('Development operator/admin seed completed.');
}

async function assertNoDevelopmentAccountsInProduction() {
  const developmentAccounts = await prisma.operator.findMany({
    where: {
      email: {
        in: [DEV_OPERATOR_EMAIL, DEV_ADMIN_EMAIL],
      },
    },
    select: {
      email: true,
    },
  });

  if (developmentAccounts.length > 0) {
    const emails = developmentAccounts.map((account) => account.email).join(', ');

    throw new Error(
      `Development accounts exist in production database: ${emails}. Remove or deactivate them before continuing.`,
    );
  }
}

async function seedProductionAdmin(roles: Awaited<ReturnType<typeof seedRoles>>) {
  const hasEmail = Boolean(PROD_ADMIN_EMAIL);
  const hasPassword = Boolean(PROD_ADMIN_PASSWORD);

  // Cho phép chạy seed production bình thường sau khi admin đã được tạo
  // và SEED_ADMIN_PASSWORD đã bị xóa khỏi prod.env.
  if (!hasEmail && !hasPassword) {
    console.log('Production RBAC seed completed. No production admin credentials supplied.');

    return;
  }

  if (!hasEmail || !hasPassword) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must either both be provided or both be omitted.');
  }

  if (PROD_ADMIN_PASSWORD!.length < 16) {
    throw new Error('SEED_ADMIN_PASSWORD must contain at least 16 characters.');
  }

  const existingAdmin = await prisma.operator.findUnique({
    where: {
      email: PROD_ADMIN_EMAIL!,
    },
  });

  if (existingAdmin) {
    // Không cập nhật password ở đây.
    // Seed chạy lại không được âm thầm reset credential production.
    await prisma.operator.update({
      where: {
        id: existingAdmin.id,
      },
      data: {
        roleId: roles.admin.id,
        fullName: PROD_ADMIN_FULL_NAME,
        status: OperatorStatus.ACTIVE,
      },
    });

    console.log(`Production admin already exists: ${PROD_ADMIN_EMAIL}. Password was not changed.`);

    return;
  }

  const passwordHash = await hashPassword(PROD_ADMIN_PASSWORD!);

  await prisma.operator.create({
    data: {
      email: PROD_ADMIN_EMAIL!,
      fullName: PROD_ADMIN_FULL_NAME,
      roleId: roles.admin.id,
      status: OperatorStatus.ACTIVE,
      passwordHash,
    },
  });

  console.log(`Production admin created: ${PROD_ADMIN_EMAIL}`);
}

// ======================================================
// MAIN
// ======================================================

async function main() {
  console.log(`Starting database seed for environment: ${isProduction ? 'production' : 'development'}`);

  await seedPermissions();

  const roles = await seedRoles();

  await syncRolePermissions(roles);

  if (isProduction) {
    await assertNoDevelopmentAccountsInProduction();
    await seedProductionAdmin(roles);
  } else {
    await seedDevelopmentAccounts(roles);
  }

  console.log('Database seed completed successfully.');
}

main()
  .catch((error) => {
    console.error('Database seed failed.');
    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
