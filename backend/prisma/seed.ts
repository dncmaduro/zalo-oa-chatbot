import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, OperatorRoleCode } from '../src/generated/prisma/client';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

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

async function main() {
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

  const admin = await prisma.role.upsert({
    where: { code: OperatorRoleCode.ADMIN },
    update: { name: 'Administrator' },
    create: {
      code: OperatorRoleCode.ADMIN,
      name: 'Administrator',
    },
  });

  const leader = await prisma.role.upsert({
    where: { code: OperatorRoleCode.LEADER },
    update: { name: 'Leader' },
    create: {
      code: OperatorRoleCode.LEADER,
      name: 'Leader',
    },
  });

  const operator = await prisma.role.upsert({
    where: { code: OperatorRoleCode.OPERATOR },
    update: { name: 'Operator' },
    create: {
      code: OperatorRoleCode.OPERATOR,
      name: 'Operator',
    },
  });

  const allPermissions = await prisma.permission.findMany();

  const leaderPermissionCodes = new Set([
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

  const operatorPermissionCodes = new Set([
    'knowledge.read',

    'conversation.read',
    'conversation.reply',

    'task.read',
    'task.update',
    'task.complete',

    'contact.read',
    'contact.update',
  ]);

  const rolePermissions = [
    {
      role: admin,
      permissions: allPermissions,
    },
    {
      role: leader,
      permissions: allPermissions.filter((permission) =>
        leaderPermissionCodes.has(permission.code),
      ),
    },
    {
      role: operator,
      permissions: allPermissions.filter((permission) =>
        operatorPermissionCodes.has(permission.code),
      ),
    },
  ];

  for (const item of rolePermissions) {
    for (const permission of item.permissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: item.role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: item.role.id,
          permissionId: permission.id,
        },
      });
    }
  }

  console.log('RBAC seed completed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });