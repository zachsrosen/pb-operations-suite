require('dotenv').config();
const { PrismaClient } = require('../src/generated/prisma');
const prisma = new PrismaClient();
prisma.scheduleRecord.findMany({
  where: { projectId: 'PROJ-8732', scheduleType: 'survey' },
  orderBy: { createdAt: 'desc' },
}).then(records => {
  for (const r of records) {
    console.log(JSON.stringify({
      id: r.id, status: r.status, assignedUser: r.assignedUser,
      assignedUserUid: r.assignedUserUid, scheduledBy: r.scheduledBy,
      scheduledByEmail: r.scheduledByEmail, scheduledDate: r.scheduledDate,
      scheduledStart: r.scheduledStart, scheduledEnd: r.scheduledEnd,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
      zuperAssigned: r.zuperAssigned, zuperError: r.zuperError,
    }, null, 2));
    console.log('---');
  }
  return prisma.$disconnect();
}).catch(e => { console.error(e); process.exit(1); });
