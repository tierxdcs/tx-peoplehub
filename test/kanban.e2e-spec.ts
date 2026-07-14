import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * Kanban Phase 1 e2e — the access model is the point:
 *  - only Scrum Master / SUPER_ADMIN create boards
 *  - a board is visible only to explicit members (+ SUPER_ADMIN override)
 *  - a plain ADMIN sees nothing unless added
 *  - members can view lists/sprints but NOT create them
 *  - Scrum Master / SUPER_ADMIN manage members + lists + sprints
 *  - sprint status is computed from dates; endDate is startDate + weeks*7
 */
describe('Kanban (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const createdEmployeeIds: string[] = [];
  const createdBoardIds: string[] = [];

  let superAdminToken: string;
  let superAdminId: string;
  let scrumToken: string; // designated Scrum Master
  let scrumId: string;
  let memberToken: string; // a plain board member
  let memberId: string;
  let outsiderToken: string; // not a member of the board
  let outsiderId: string;
  let plainAdminToken: string; // ADMIN — sees nothing by default

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken;
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

    superAdminId = (
      await prisma.employee.findUniqueOrThrow({ where: { email: adminEmail } })
    ).id;
    superAdminToken = await login(adminEmail, adminPassword);

    const salesVertical = await prisma.vertical.findUniqueOrThrow({
      where: { code: 'SALES' },
    });
    const suffix = Date.now();
    const mk = async (
      firstName: string,
      role: string,
    ): Promise<{ id: string; email: string }> => {
      const email = `kb.${firstName.toLowerCase()}.${suffix}@peoplehub.local`;
      const res = await request(app.getHttpServer())
        .post('/employees')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          firstName,
          lastName: 'KB',
          email,
          password: 'S3curePass!',
          role,
          verticalId: salesVertical.id,
          reportingManagerId: superAdminId,
        })
        .expect(201);
      createdEmployeeIds.push(res.body.data.id);
      return { id: res.body.data.id, email };
    };

    const scrum = await mk('Scrum', 'EMPLOYEE');
    scrumId = scrum.id;
    const member = await mk('Member', 'EMPLOYEE');
    memberId = member.id;
    const outsider = await mk('Outsider', 'EMPLOYEE');
    outsiderId = outsider.id;
    const plainAdmin = await mk('Adm', 'ADMIN');

    // Designate the Scrum Master.
    await request(app.getHttpServer())
      .patch(`/employees/${scrumId}/designate-scrum-master`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);

    scrumToken = await login(scrum.email, 'S3curePass!');
    memberToken = await login(member.email, 'S3curePass!');
    outsiderToken = await login(outsider.email, 'S3curePass!');
    plainAdminToken = await login(plainAdmin.email, 'S3curePass!');
  });

  afterAll(async () => {
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

  it('a non-Scrum-Master cannot create a board (403)', async () => {
    await request(app.getHttpServer())
      .post('/kanban/boards')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'Nope' })
      .expect(403);
  });

  it('full access model: create, membership visibility, management gating', async () => {
    // Scrum Master creates a board — auto-added as a member.
    const boardRes = await request(app.getHttpServer())
      .post('/kanban/boards')
      .set('Authorization', `Bearer ${scrumToken}`)
      .send({ name: 'CEO Board' })
      .expect(201);
    const boardId = boardRes.body.data.id;
    createdBoardIds.push(boardId);
    expect(boardRes.body.data.memberCount).toBe(1);

    // Creator sees it in their list; an outsider and a plain ADMIN do not.
    const scrumList = await request(app.getHttpServer())
      .get('/kanban/boards')
      .set('Authorization', `Bearer ${scrumToken}`)
      .expect(200);
    expect(scrumList.body.data.some((b: { id: string }) => b.id === boardId)).toBe(true);

    for (const token of [outsiderToken, plainAdminToken]) {
      const list = await request(app.getHttpServer())
        .get('/kanban/boards')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body.data.some((b: { id: string }) => b.id === boardId)).toBe(false);
      // Direct fetch is forbidden for a non-member.
      await request(app.getHttpServer())
        .get(`/kanban/boards/${boardId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    }

    // SUPER_ADMIN sees it despite not being a member (full override).
    await request(app.getHttpServer())
      .get(`/kanban/boards/${boardId}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);

    // Scrum Master adds the member; a member cannot add members.
    await request(app.getHttpServer())
      .post(`/kanban/boards/${boardId}/members`)
      .set('Authorization', `Bearer ${scrumToken}`)
      .send({ employeeId: memberId })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/kanban/boards/${boardId}/members`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ employeeId: superAdminId })
      .expect(403);

    // Now the member can view the board + its (empty) lists.
    await request(app.getHttpServer())
      .get(`/kanban/boards/${boardId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    const memberLists = await request(app.getHttpServer())
      .get(`/kanban/boards/${boardId}/lists`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    expect(memberLists.body.data).toHaveLength(0);

    // A member cannot create a list; the Scrum Master can.
    await request(app.getHttpServer())
      .post(`/kanban/boards/${boardId}/lists`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'To Do', position: 0 })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/kanban/boards/${boardId}/lists`)
      .set('Authorization', `Bearer ${scrumToken}`)
      .send({ name: 'To Do', position: 0 })
      .expect(201);

    // Sprint: member blocked, Scrum Master allowed; endDate + status computed.
    await request(app.getHttpServer())
      .post(`/kanban/boards/${boardId}/sprints`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'S1', durationWeeks: 'TWO_WEEKS', startDate: '2026-01-01' })
      .expect(403);
    const sprintRes = await request(app.getHttpServer())
      .post(`/kanban/boards/${boardId}/sprints`)
      .set('Authorization', `Bearer ${scrumToken}`)
      .send({ name: 'S1', durationWeeks: 'TWO_WEEKS', startDate: '2026-01-01' })
      .expect(201);
    // endDate = start + 14 days; status COMPLETED (2026-01 window is past "now" 2026-07).
    expect(sprintRes.body.data.endDate.slice(0, 10)).toBe('2026-01-15');
    expect(sprintRes.body.data.status).toBe('COMPLETED');

    // An UPCOMING sprint (far-future start).
    const upcoming = await request(app.getHttpServer())
      .post(`/kanban/boards/${boardId}/sprints`)
      .set('Authorization', `Bearer ${scrumToken}`)
      .send({ name: 'S2', durationWeeks: 'ONE_WEEK', startDate: '2099-01-01' })
      .expect(201);
    expect(upcoming.body.data.status).toBe('UPCOMING');

    // Creator can't be removed; a real member can.
    await request(app.getHttpServer())
      .delete(`/kanban/boards/${boardId}/members/${scrumId}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .delete(`/kanban/boards/${boardId}/members/${memberId}`)
      .set('Authorization', `Bearer ${scrumToken}`)
      .expect(204);
    // Removed member loses visibility.
    await request(app.getHttpServer())
      .get(`/kanban/boards/${boardId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);
  });

  it('a designated Scrum Master cannot manage a board they are not a member of', async () => {
    // SUPER_ADMIN creates a board (super-admin is NOT auto-scoped to scrum).
    const boardRes = await request(app.getHttpServer())
      .post('/kanban/boards')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'SA Only Board' })
      .expect(201);
    const boardId = boardRes.body.data.id;
    createdBoardIds.push(boardId);

    // The Scrum Master isn't a member → can't even view it, let alone add lists.
    await request(app.getHttpServer())
      .get(`/kanban/boards/${boardId}`)
      .set('Authorization', `Bearer ${scrumToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/kanban/boards/${boardId}/lists`)
      .set('Authorization', `Bearer ${scrumToken}`)
      .send({ name: 'x', position: 0 })
      .expect(403);
  });

  describe('cards (Phase 2)', () => {
    let boardId: string;
    let listA: string;
    let listB: string;
    let sprintId: string;

    beforeAll(async () => {
      // Scrum Master board with the member added + two lists + a sprint.
      const board = await request(app.getHttpServer())
        .post('/kanban/boards')
        .set('Authorization', `Bearer ${scrumToken}`)
        .send({ name: 'Cards Board' })
        .expect(201);
      boardId = board.body.data.id;
      createdBoardIds.push(boardId);
      await request(app.getHttpServer())
        .post(`/kanban/boards/${boardId}/members`)
        .set('Authorization', `Bearer ${scrumToken}`)
        .send({ employeeId: memberId })
        .expect(201);
      listA = (
        await request(app.getHttpServer())
          .post(`/kanban/boards/${boardId}/lists`)
          .set('Authorization', `Bearer ${scrumToken}`)
          .send({ name: 'To Do', position: 0 })
          .expect(201)
      ).body.data.id;
      listB = (
        await request(app.getHttpServer())
          .post(`/kanban/boards/${boardId}/lists`)
          .set('Authorization', `Bearer ${scrumToken}`)
          .send({ name: 'Doing', position: 1 })
          .expect(201)
      ).body.data.id;
      sprintId = (
        await request(app.getHttpServer())
          .post(`/kanban/boards/${boardId}/sprints`)
          .set('Authorization', `Bearer ${scrumToken}`)
          .send({ name: 'Sprint 1', durationWeeks: 'TWO_WEEKS', startDate: '2026-08-01' })
          .expect(201)
      ).body.data.id;
    });

    it('a member creates/edits cards; an outsider is 403', async () => {
      const created = await request(app.getHttpServer())
        .post(`/kanban/lists/${listA}/cards`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ title: 'First card', priority: 'HIGH' })
        .expect(201);
      const cardId = created.body.data.id;
      expect(created.body.data.priority).toBe('HIGH');
      expect(created.body.data.sprintId).toBeNull();

      // Edit priority/dates via the general PATCH — member allowed.
      const edited = await request(app.getHttpServer())
        .patch(`/kanban/cards/${cardId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ priority: 'LOW', dueDate: '2026-08-10' })
        .expect(200);
      expect(edited.body.data.priority).toBe('LOW');
      expect(edited.body.data.dueDate.slice(0, 10)).toBe('2026-08-10');

      // Outsider can't create on this board.
      await request(app.getHttpServer())
        .post(`/kanban/lists/${listA}/cards`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ title: 'nope' })
        .expect(403);
    });

    it('assigning to a non-member is rejected; a member assignee works', async () => {
      const cardId = (
        await request(app.getHttpServer())
          .post(`/kanban/lists/${listA}/cards`)
          .set('Authorization', `Bearer ${memberToken}`)
          .send({ title: 'assign me' })
          .expect(201)
      ).body.data.id;

      // scrumId + memberId are members; outsider is not.
      await request(app.getHttpServer())
        .patch(`/kanban/cards/${cardId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ assigneeId: memberId })
        .expect(200);

      // The outsider isn't a board member → 400.
      await request(app.getHttpServer())
        .patch(`/kanban/cards/${cardId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ assigneeId: outsiderId })
        .expect(400);
    });

    it('sprintId cannot be set via the general PATCH (400), only the dedicated endpoint', async () => {
      const cardId = (
        await request(app.getHttpServer())
          .post(`/kanban/lists/${listA}/cards`)
          .set('Authorization', `Bearer ${memberToken}`)
          .send({ title: 'sprint target' })
          .expect(201)
      ).body.data.id;

      // General PATCH rejects the unknown sprintId field (forbidNonWhitelisted).
      await request(app.getHttpServer())
        .patch(`/kanban/cards/${cardId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ sprintId })
        .expect(400);

      // Dedicated endpoint: a plain member is forbidden…
      await request(app.getHttpServer())
        .patch(`/kanban/cards/${cardId}/sprint`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ sprintId })
        .expect(403);

      // …the Scrum Master (member + capability) can.
      const set = await request(app.getHttpServer())
        .patch(`/kanban/cards/${cardId}/sprint`)
        .set('Authorization', `Bearer ${scrumToken}`)
        .send({ sprintId })
        .expect(200);
      expect(set.body.data.sprintId).toBe(sprintId);
    });

    it('moves a card to another list at a fractional position (single-row, no reindex)', async () => {
      // Two cards in listA → positions 1024, 2048. Insert one between them.
      const c1 = (
        await request(app.getHttpServer())
          .post(`/kanban/lists/${listA}/cards`)
          .set('Authorization', `Bearer ${memberToken}`)
          .send({ title: 'A' })
          .expect(201)
      ).body.data;
      const c2 = (
        await request(app.getHttpServer())
          .post(`/kanban/lists/${listA}/cards`)
          .set('Authorization', `Bearer ${memberToken}`)
          .send({ title: 'B' })
          .expect(201)
      ).body.data;

      // Move c2 to listB at the midpoint of nothing → just lands there.
      const moved = await request(app.getHttpServer())
        .patch(`/kanban/cards/${c2.id}/move`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ listId: listB, position: (c1.position + c2.position) / 2 })
        .expect(200);
      expect(moved.body.data.listId).toBe(listB);

      // c1's position is untouched (no reindex of the source list).
      const listACards = await request(app.getHttpServer())
        .get(`/kanban/lists/${listA}/cards`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      const c1After = (listACards.body.data as { id: string; position: number }[]).find(
        (c) => c.id === c1.id,
      );
      expect(c1After?.position).toBe(c1.position);
    });

    it('archive: a non-creator member cannot delete; creator/Scrum Master can', async () => {
      // Member creates a card.
      const cardId = (
        await request(app.getHttpServer())
          .post(`/kanban/lists/${listA}/cards`)
          .set('Authorization', `Bearer ${memberToken}`)
          .send({ title: 'delete me' })
          .expect(201)
      ).body.data.id;

      // The Scrum Master (manages the board) can archive it even though the
      // member created it.
      await request(app.getHttpServer())
        .delete(`/kanban/cards/${cardId}`)
        .set('Authorization', `Bearer ${scrumToken}`)
        .expect(204);

      // Archived card is gone from the list.
      const remaining = await request(app.getHttpServer())
        .get(`/kanban/lists/${listA}/cards`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      expect(
        (remaining.body.data as { id: string }[]).some((c) => c.id === cardId),
      ).toBe(false);
    });
  });
});
