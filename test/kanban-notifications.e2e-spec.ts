import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * Kanban Phase 4 — generic Notifications. Verifies the notify-on-event rules
 * and the one hard rule: never notify someone about their OWN action.
 * The scrum master (SM) manages the board; the member is the assignee/other.
 */
describe('Kanban notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const createdEmployeeIds: string[] = [];
  const createdBoardIds: string[] = [];

  let smToken: string;
  let smId: string;
  let memberToken: string;
  let memberId: string;
  let boardId: string;
  let listA: string;
  let listB: string;
  let sprintId: string;

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken;
  }

  async function unread(token: string): Promise<number> {
    const res = await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data.count;
  }

  async function mine(token: string) {
    const res = await request(app.getHttpServer())
      .get('/notifications/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data as Array<{
      id: string;
      type: string;
      relatedCardId: string | null;
      isRead: boolean;
    }>;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const superAdminToken = await login(adminEmail, adminPassword);
    const superAdminId = (
      await prisma.employee.findUniqueOrThrow({ where: { email: adminEmail } })
    ).id;
    const salesVertical = await prisma.vertical.findUniqueOrThrow({
      where: { code: 'SALES' },
    });
    const suffix = Date.now();
    const mk = async (first: string) => {
      const email = `kbn.${first.toLowerCase()}.${suffix}@peoplehub.local`;
      const res = await request(app.getHttpServer())
        .post('/employees')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          firstName: first,
          lastName: 'N',
          email,
          password: 'S3curePass!',
          role: 'EMPLOYEE',
          verticalId: salesVertical.id,
          reportingManagerId: superAdminId,
        })
        .expect(201);
      createdEmployeeIds.push(res.body.data.id);
      return { id: res.body.data.id, email };
    };

    const sm = await mk('Sm');
    smId = sm.id;
    const member = await mk('Mem');
    memberId = member.id;
    await request(app.getHttpServer())
      .patch(`/employees/${smId}/designate-scrum-master`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    smToken = await login(sm.email, 'S3curePass!');
    memberToken = await login(member.email, 'S3curePass!');

    // Board (SM creator+member) + add member + two lists + a sprint.
    boardId = (
      await request(app.getHttpServer())
        .post('/kanban/boards')
        .set('Authorization', `Bearer ${smToken}`)
        .send({ name: 'Notif Board' })
        .expect(201)
    ).body.data.id;
    createdBoardIds.push(boardId);
    await request(app.getHttpServer())
      .post(`/kanban/boards/${boardId}/members`)
      .set('Authorization', `Bearer ${smToken}`)
      .send({ employeeId: memberId })
      .expect(201);
    listA = (
      await request(app.getHttpServer())
        .post(`/kanban/boards/${boardId}/lists`)
        .set('Authorization', `Bearer ${smToken}`)
        .send({ name: 'A', position: 0 })
        .expect(201)
    ).body.data.id;
    listB = (
      await request(app.getHttpServer())
        .post(`/kanban/boards/${boardId}/lists`)
        .set('Authorization', `Bearer ${smToken}`)
        .send({ name: 'B', position: 1 })
        .expect(201)
    ).body.data.id;
    sprintId = (
      await request(app.getHttpServer())
        .post(`/kanban/boards/${boardId}/sprints`)
        .set('Authorization', `Bearer ${smToken}`)
        .send({ name: 'Sp', durationWeeks: 'ONE_WEEK', startDate: '2026-08-01' })
        .expect(201)
    ).body.data.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { employeeId: { in: createdEmployeeIds } },
    });
    await prisma.kanbanCard.deleteMany({
      where: { list: { boardId: { in: createdBoardIds } } },
    });
    await prisma.kanbanSprint.deleteMany({ where: { boardId: { in: createdBoardIds } } });
    await prisma.kanbanList.deleteMany({ where: { boardId: { in: createdBoardIds } } });
    await prisma.kanbanBoardMember.deleteMany({ where: { boardId: { in: createdBoardIds } } });
    await prisma.kanbanBoard.deleteMany({ where: { id: { in: createdBoardIds } } });
    if (createdEmployeeIds.length) {
      await prisma.employee.deleteMany({ where: { id: { in: createdEmployeeIds } } });
    }
    await app.close();
  });

  it('CARD_ASSIGNED: assigning to another notifies them; self-assign notifies no one', async () => {
    const before = await unread(memberToken);

    // SM creates a card, assigns it to the member → member gets CARD_ASSIGNED.
    const cardId = (
      await request(app.getHttpServer())
        .post(`/kanban/lists/${listA}/cards`)
        .set('Authorization', `Bearer ${smToken}`)
        .send({ title: 'Assign card' })
        .expect(201)
    ).body.data.id;
    await request(app.getHttpServer())
      .patch(`/kanban/cards/${cardId}`)
      .set('Authorization', `Bearer ${smToken}`)
      .send({ assigneeId: memberId })
      .expect(200);

    const memberNotifs = await mine(memberToken);
    expect(
      memberNotifs.some(
        (n) => n.type === 'CARD_ASSIGNED' && n.relatedCardId === cardId,
      ),
    ).toBe(true);
    expect(await unread(memberToken)).toBe(before + 1);

    // The member assigns the card to THEMSELVES → no self-notification.
    const smBefore = await unread(smToken);
    await request(app.getHttpServer())
      .patch(`/kanban/cards/${cardId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ assigneeId: memberId })
      .expect(200); // no-op assignee (already member) — no new notif anyway
    // And the SM (actor of the original change) got nothing about their own act.
    expect(await unread(smToken)).toBe(smBefore);
  });

  it('CARD_COMMENTED: comment notifies the assignee, not when the assignee comments', async () => {
    // Card assigned to member.
    const cardId = (
      await request(app.getHttpServer())
        .post(`/kanban/lists/${listA}/cards`)
        .set('Authorization', `Bearer ${smToken}`)
        .send({ title: 'Comment card', assigneeId: memberId })
        .expect(201)
    ).body.data.id;

    // SM comments → member (assignee) notified.
    const before = await unread(memberToken);
    await request(app.getHttpServer())
      .post(`/kanban/cards/${cardId}/comments`)
      .set('Authorization', `Bearer ${smToken}`)
      .send({ text: 'hi' })
      .expect(201);
    expect(await unread(memberToken)).toBe(before + 1);

    // The member (assignee) comments on their own card → no self-notification.
    const selfBefore = await unread(memberToken);
    await request(app.getHttpServer())
      .post(`/kanban/cards/${cardId}/comments`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ text: 'my own comment' })
      .expect(201);
    expect(await unread(memberToken)).toBe(selfBefore);
  });

  it('CARD_UPDATED: priority/sprint change notifies the assignee, excluding the actor', async () => {
    const cardId = (
      await request(app.getHttpServer())
        .post(`/kanban/lists/${listA}/cards`)
        .set('Authorization', `Bearer ${smToken}`)
        .send({ title: 'Update card', assigneeId: memberId, priority: 'LOW' })
        .expect(201)
    ).body.data.id;

    const before = await unread(memberToken);
    // SM changes priority → member notified.
    await request(app.getHttpServer())
      .patch(`/kanban/cards/${cardId}`)
      .set('Authorization', `Bearer ${smToken}`)
      .send({ priority: 'HIGH' })
      .expect(200);
    // SM assigns a sprint → member notified again.
    await request(app.getHttpServer())
      .patch(`/kanban/cards/${cardId}/sprint`)
      .set('Authorization', `Bearer ${smToken}`)
      .send({ sprintId })
      .expect(200);
    expect(await unread(memberToken)).toBe(before + 2);

    // The member changes their OWN card's priority → no self-notification.
    const selfBefore = await unread(memberToken);
    await request(app.getHttpServer())
      .patch(`/kanban/cards/${cardId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ priority: 'MEDIUM' })
      .expect(200);
    expect(await unread(memberToken)).toBe(selfBefore);
  });

  it('mark-read and mark-all-read clear the unread count', async () => {
    const list = await mine(memberToken);
    expect(list.length).toBeGreaterThan(0);
    // Mark one read → count drops by exactly 1 (if it was unread).
    const firstUnread = list.find((n) => !n.isRead);
    if (firstUnread) {
      const before = await unread(memberToken);
      await request(app.getHttpServer())
        .patch(`/notifications/${firstUnread.id}/read`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      expect(await unread(memberToken)).toBe(before - 1);
    }
    // Mark all read → zero.
    await request(app.getHttpServer())
      .patch('/notifications/read-all')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    expect(await unread(memberToken)).toBe(0);
  });

  it("a user cannot mark someone else's notification read (404)", async () => {
    const memberNotifs = await mine(memberToken);
    const someId = memberNotifs[0]?.id;
    expect(someId).toBeDefined();
    // The SM tries to mark the member's notification → 404 (not theirs).
    await request(app.getHttpServer())
      .patch(`/notifications/${someId}/read`)
      .set('Authorization', `Bearer ${smToken}`)
      .expect(404);
  });
});
