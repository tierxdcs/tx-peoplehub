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

  it('any employee (not just a Scrum Master) can create a board, with the three default lists provisioned', async () => {
    const boardRes = await request(app.getHttpServer())
      .post('/kanban/boards')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'Personal Board' })
      .expect(201);
    const boardId = boardRes.body.data.id;
    createdBoardIds.push(boardId);
    expect(boardRes.body.data.createdById).toBe(memberId);
    expect(boardRes.body.data.memberCount).toBe(1);

    const lists = await request(app.getHttpServer())
      .get(`/kanban/boards/${boardId}/lists`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    const names = (lists.body.data as { name: string; isDoneList: boolean }[]).map(
      (l) => l.name,
    );
    expect(names).toEqual(['To Do', 'In progress', 'Completed']);
    expect(
      (lists.body.data as { name: string; isDoneList: boolean }[]).find(
        (l) => l.name === 'Completed',
      )?.isDoneList,
    ).toBe(true);
  });

  it('the board creator (not a Scrum Master) can manage lists on their own board, but not sprints', async () => {
    const boardRes = await request(app.getHttpServer())
      .post('/kanban/boards')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'Creator-managed board' })
      .expect(201);
    const boardId = boardRes.body.data.id;
    createdBoardIds.push(boardId);

    // Creator can create/edit/reorder a list on their own board.
    const list = await request(app.getHttpServer())
      .post(`/kanban/boards/${boardId}/lists`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'Backlog', position: 4096 })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/kanban/lists/${list.body.data.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'Backlog Renamed' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/kanban/lists/${list.body.data.id}/reorder`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ position: 5120 })
      .expect(200);

    // But the SAME creator cannot create a sprint on their own board — no
    // creator exception for sprints (explicitly confirmed, spec §1).
    await request(app.getHttpServer())
      .post(`/kanban/boards/${boardId}/sprints`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'S1', durationWeeks: 'ONE_WEEK', startDate: '2026-01-01' })
      .expect(403);
    // Nor add a member, nor create a label — those stay Scrum-Master-only too.
    await request(app.getHttpServer())
      .post(`/kanban/boards/${boardId}/members`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ employeeId: outsiderId })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/kanban/boards/${boardId}/labels`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'x', color: '#000' })
      .expect(403);

    // A random outsider (not the creator) is still blocked from list management.
    const otherBoard = await request(app.getHttpServer())
      .post('/kanban/boards')
      .set('Authorization', `Bearer ${scrumToken}`)
      .send({ name: 'Not yours' })
      .expect(201);
    createdBoardIds.push(otherBoard.body.data.id);
    await request(app.getHttpServer())
      .post(`/kanban/boards/${otherBoard.body.data.id}/members`)
      .set('Authorization', `Bearer ${scrumToken}`)
      .send({ employeeId: memberId })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/kanban/boards/${otherBoard.body.data.id}/lists`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'Nope', position: 0 })
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

    // Now the member can view the board + its auto-provisioned default lists
    // (To Do / In progress / Completed — every new board gets these).
    await request(app.getHttpServer())
      .get(`/kanban/boards/${boardId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    const memberLists = await request(app.getHttpServer())
      .get(`/kanban/boards/${boardId}/lists`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    expect(memberLists.body.data).toHaveLength(3);

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

      // GET /kanban/cards/:id resolves the card + its boardId (deep-link basis);
      // an outsider is 403, a missing card is 404.
      const fetched = await request(app.getHttpServer())
        .get(`/kanban/cards/${cardId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      expect(fetched.body.data.boardId).toBe(boardId);
      await request(app.getHttpServer())
        .get(`/kanban/cards/${cardId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/kanban/cards/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(404);

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

    it('assigning to a non-member now SUCCEEDS (assignment is the sharing mechanism); an inactive/unknown employee is still rejected', async () => {
      const cardId = (
        await request(app.getHttpServer())
          .post(`/kanban/lists/${listA}/cards`)
          .set('Authorization', `Bearer ${memberToken}`)
          .send({ title: 'assign me' })
          .expect(201)
      ).body.data.id;

      // A real board member still works.
      await request(app.getHttpServer())
        .patch(`/kanban/cards/${cardId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ assigneeId: memberId })
        .expect(200);

      // The outsider is NOT a board member — assignment now succeeds anyway.
      const assigned = await request(app.getHttpServer())
        .patch(`/kanban/cards/${cardId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ assigneeId: outsiderId })
        .expect(200);
      expect(assigned.body.data.assigneeId).toBe(outsiderId);

      // An unknown employee id is still rejected (existence, not membership).
      await request(app.getHttpServer())
        .patch(`/kanban/cards/${cardId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ assigneeId: '00000000-0000-0000-0000-000000000000' })
        .expect(400);
    });

    describe('card-only access (non-member assignee)', () => {
      let cardOnlyCardId: string;

      beforeAll(async () => {
        // outsiderToken/outsiderId is NOT a member of `boardId` (asserted below).
        await request(app.getHttpServer())
          .get(`/kanban/boards/${boardId}`)
          .set('Authorization', `Bearer ${outsiderToken}`)
          .expect(403);

        cardOnlyCardId = (
          await request(app.getHttpServer())
            .post(`/kanban/lists/${listA}/cards`)
            .set('Authorization', `Bearer ${memberToken}`)
            .send({ title: 'card-only target', assigneeId: outsiderId })
            .expect(201)
        ).body.data.id;
      });

      it('the non-member assignee can view the card via GET /cards/:id, with viewerHasBoardAccess=false', async () => {
        const res = await request(app.getHttpServer())
          .get(`/kanban/cards/${cardOnlyCardId}`)
          .set('Authorization', `Bearer ${outsiderToken}`)
          .expect(200);
        expect(res.body.data.id).toBe(cardOnlyCardId);
        expect(res.body.data.assigneeId).toBe(outsiderId);
        expect(res.body.data.viewerHasBoardAccess).toBe(false);

        // A real board member fetching the same card sees viewerHasBoardAccess=true.
        const asMember = await request(app.getHttpServer())
          .get(`/kanban/cards/${cardOnlyCardId}`)
          .set('Authorization', `Bearer ${memberToken}`)
          .expect(200);
        expect(asMember.body.data.viewerHasBoardAccess).toBe(true);
      });

      it('the non-member assignee can read the feed and add a comment', async () => {
        await request(app.getHttpServer())
          .get(`/kanban/cards/${cardOnlyCardId}/feed`)
          .set('Authorization', `Bearer ${outsiderToken}`)
          .expect(200);
        await request(app.getHttpServer())
          .post(`/kanban/cards/${cardOnlyCardId}/comments`)
          .set('Authorization', `Bearer ${outsiderToken}`)
          .send({ text: 'a card-only comment' })
          .expect(201);
      });

      it('the non-member assignee CANNOT move the card, edit it, or see the rest of the board', async () => {
        // Move (incl. the "Mark complete" path, which is just this endpoint)
        // requires full board access.
        await request(app.getHttpServer())
          .patch(`/kanban/cards/${cardOnlyCardId}/move`)
          .set('Authorization', `Bearer ${outsiderToken}`)
          .send({ listId: listB, position: 1024 })
          .expect(403);

        // General edit is also board-access-gated.
        await request(app.getHttpServer())
          .patch(`/kanban/cards/${cardOnlyCardId}`)
          .set('Authorization', `Bearer ${outsiderToken}`)
          .send({ title: 'hijacked' })
          .expect(403);

        // No board-level visibility at all: board, lists, members, other cards.
        await request(app.getHttpServer())
          .get(`/kanban/boards/${boardId}`)
          .set('Authorization', `Bearer ${outsiderToken}`)
          .expect(403);
        await request(app.getHttpServer())
          .get(`/kanban/boards/${boardId}/lists`)
          .set('Authorization', `Bearer ${outsiderToken}`)
          .expect(403);
        await request(app.getHttpServer())
          .get(`/kanban/boards/${boardId}/members`)
          .set('Authorization', `Bearer ${outsiderToken}`)
          .expect(403);
        await request(app.getHttpServer())
          .get(`/kanban/lists/${listA}/cards`)
          .set('Authorization', `Bearer ${outsiderToken}`)
          .expect(403);

        // A DIFFERENT card on the same board (not assigned to them) is 403 too.
        const otherCardId = (
          await request(app.getHttpServer())
            .post(`/kanban/lists/${listA}/cards`)
            .set('Authorization', `Bearer ${memberToken}`)
            .send({ title: 'not yours' })
            .expect(201)
        ).body.data.id;
        await request(app.getHttpServer())
          .get(`/kanban/cards/${otherCardId}`)
          .set('Authorization', `Bearer ${outsiderToken}`)
          .expect(403);
      });

      it('GET /kanban/cards/mine includes a card assigned to a non-board-member', async () => {
        const mine = await request(app.getHttpServer())
          .get('/kanban/cards/mine')
          .set('Authorization', `Bearer ${outsiderToken}`)
          .expect(200);
        const ids = (mine.body.data as { id: string }[]).map((c) => c.id);
        expect(ids).toContain(cardOnlyCardId);
      });
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

  describe('comments + activity feed (Phase 3)', () => {
    let boardId: string;
    let listA: string;
    let listB: string;
    let sprintId: string;
    let cardId: string;

    beforeAll(async () => {
      const board = await request(app.getHttpServer())
        .post('/kanban/boards')
        .set('Authorization', `Bearer ${scrumToken}`)
        .send({ name: 'Feed Board' })
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
          .send({ name: 'Backlog', position: 0 })
          .expect(201)
      ).body.data.id;
      listB = (
        await request(app.getHttpServer())
          .post(`/kanban/boards/${boardId}/lists`)
          .set('Authorization', `Bearer ${scrumToken}`)
          .send({ name: 'In Progress', position: 1 })
          .expect(201)
      ).body.data.id;
      sprintId = (
        await request(app.getHttpServer())
          .post(`/kanban/boards/${boardId}/sprints`)
          .set('Authorization', `Bearer ${scrumToken}`)
          .send({ name: 'Alpha', durationWeeks: 'ONE_WEEK', startDate: '2026-08-01' })
          .expect(201)
      ).body.data.id;
      cardId = (
        await request(app.getHttpServer())
          .post(`/kanban/lists/${listA}/cards`)
          .set('Authorization', `Bearer ${memberToken}`)
          .send({ title: 'Feed card', priority: 'MEDIUM' })
          .expect(201)
      ).body.data.id;
    });

    it('any member comments; only author or managing SM can delete', async () => {
      const c1 = (
        await request(app.getHttpServer())
          .post(`/kanban/cards/${cardId}/comments`)
          .set('Authorization', `Bearer ${memberToken}`)
          .send({ text: 'Member comment' })
          .expect(201)
      ).body.data;

      // The Scrum Master (manages the board) can delete the member's comment.
      await request(app.getHttpServer())
        .delete(`/kanban/cards/${cardId}/comments/${c1.id}`)
        .set('Authorization', `Bearer ${scrumToken}`)
        .expect(204);

      // A comment by the scrum master; the plain member (not author, not
      // manager) cannot delete it.
      const c2 = (
        await request(app.getHttpServer())
          .post(`/kanban/cards/${cardId}/comments`)
          .set('Authorization', `Bearer ${scrumToken}`)
          .send({ text: 'SM comment' })
          .expect(201)
      ).body.data;
      await request(app.getHttpServer())
        .delete(`/kanban/cards/${cardId}/comments/${c2.id}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);
      // Author can delete their own.
      await request(app.getHttpServer())
        .delete(`/kanban/cards/${cardId}/comments/${c2.id}`)
        .set('Authorization', `Bearer ${scrumToken}`)
        .expect(204);
    });

    it('field changes generate correctly-worded activity; no-ops do not', async () => {
      // No-op: priority already MEDIUM → PATCH with MEDIUM logs nothing.
      await request(app.getHttpServer())
        .patch(`/kanban/cards/${cardId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ priority: 'MEDIUM' })
        .expect(200);

      // Real changes: priority, due date, assignee.
      await request(app.getHttpServer())
        .patch(`/kanban/cards/${cardId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ priority: 'HIGH', dueDate: '2026-08-20', assigneeId: memberId })
        .expect(200);

      // Move to another list.
      await request(app.getHttpServer())
        .patch(`/kanban/cards/${cardId}/move`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ listId: listB, position: 5000 })
        .expect(200);

      // Sprint assignment (privileged).
      await request(app.getHttpServer())
        .patch(`/kanban/cards/${cardId}/sprint`)
        .set('Authorization', `Bearer ${scrumToken}`)
        .send({ sprintId })
        .expect(200);

      const feed = await request(app.getHttpServer())
        .get(`/kanban/cards/${cardId}/feed`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      const activity = (feed.body.data as { kind: string; text: string }[]).filter(
        (i) => i.kind === 'ACTIVITY',
      );
      const texts = activity.map((a) => a.text);
      // Exactly the four real changes — the no-op MEDIUM PATCH added nothing.
      expect(texts).toContain('changed priority to HIGH');
      expect(texts).toContain('set the due date to 2026-08-20');
      expect(texts.some((t) => t.startsWith('assigned this card to '))).toBe(true);
      expect(texts).toContain('moved this card from Backlog to In Progress');
      expect(texts).toContain('assigned this card to sprint Alpha');
      // No priority-noop entry: only one priority-change line total.
      expect(texts.filter((t) => t.startsWith('changed priority')).length).toBe(1);
    });

    it('feed merges comments + activity in chronological order with discriminators', async () => {
      const feed = await request(app.getHttpServer())
        .get(`/kanban/cards/${cardId}/feed`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      const items = feed.body.data as { kind: string; createdAt: string }[];
      expect(items.length).toBeGreaterThan(0);
      // Every item is tagged, and the list is non-decreasing by createdAt.
      expect(items.every((i) => i.kind === 'COMMENT' || i.kind === 'ACTIVITY')).toBe(true);
      const times = items.map((i) => i.createdAt);
      const sorted = [...times].sort((a, b) => a.localeCompare(b));
      expect(times).toEqual(sorted);
    });
  });

  describe('filters, sprints, labels, overdue, counts, reorder (Phase 5)', () => {
    let boardId: string;
    let todo: string;
    let done: string;

    beforeAll(async () => {
      const board = await request(app.getHttpServer())
        .post('/kanban/boards')
        .set('Authorization', `Bearer ${scrumToken}`)
        .send({ name: 'Phase5 Board' })
        .expect(201);
      boardId = board.body.data.id;
      createdBoardIds.push(boardId);
      await request(app.getHttpServer())
        .post(`/kanban/boards/${boardId}/members`)
        .set('Authorization', `Bearer ${scrumToken}`)
        .send({ employeeId: memberId })
        .expect(201);

      // A normal list and a done-list.
      todo = (
        await request(app.getHttpServer())
          .post(`/kanban/boards/${boardId}/lists`)
          .set('Authorization', `Bearer ${scrumToken}`)
          .send({ name: 'To Do', position: 1024 })
          .expect(201)
      ).body.data.id;
      const doneRes = await request(app.getHttpServer())
        .post(`/kanban/boards/${boardId}/lists`)
        .set('Authorization', `Bearer ${scrumToken}`)
        .send({ name: 'Done', position: 2048, isDoneList: true })
        .expect(201);
      done = doneRes.body.data.id;
      expect(doneRes.body.data.isDoneList).toBe(true);
      expect(doneRes.body.data.cardCount).toBe(0);
    });

    it('isDoneList: only Scrum Master/SUPER_ADMIN can set it; overdue respects it', async () => {
      // A member cannot flip a list's done-flag.
      await request(app.getHttpServer())
        .patch(`/kanban/lists/${todo}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ isDoneList: true })
        .expect(403);

      // Past-due card in the normal list → isOverdue true.
      const overdueCard = (
        await request(app.getHttpServer())
          .post(`/kanban/lists/${todo}/cards`)
          .set('Authorization', `Bearer ${memberToken}`)
          .send({ title: 'past due', dueDate: '2020-01-01' })
          .expect(201)
      ).body.data;
      expect(overdueCard.isOverdue).toBe(true);

      // Same past due-date but in a done-list → NOT overdue.
      const doneCard = (
        await request(app.getHttpServer())
          .post(`/kanban/lists/${done}/cards`)
          .set('Authorization', `Bearer ${memberToken}`)
          .send({ title: 'done past due', dueDate: '2020-01-01' })
          .expect(201)
      ).body.data;
      expect(doneCard.isOverdue).toBe(false);

      // Future due-date → not overdue.
      const futureCard = (
        await request(app.getHttpServer())
          .post(`/kanban/lists/${todo}/cards`)
          .set('Authorization', `Bearer ${memberToken}`)
          .send({ title: 'future', dueDate: '2099-01-01' })
          .expect(201)
      ).body.data;
      expect(futureCard.isOverdue).toBe(false);
    });

    it('list responses carry ACTIVE card counts', async () => {
      const lists = await request(app.getHttpServer())
        .get(`/kanban/boards/${boardId}/lists`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      const todoList = (lists.body.data as { id: string; cardCount: number }[]).find(
        (l) => l.id === todo,
      );
      const doneList = (lists.body.data as { id: string; cardCount: number }[]).find(
        (l) => l.id === done,
      );
      // todo has the past-due + future card; done has one.
      expect(todoList?.cardCount).toBe(2);
      expect(doneList?.cardCount).toBe(1);
    });

    it('board-wide card filter combines predicates with AND (incl. sprintId=none)', async () => {
      // A HIGH-priority card assigned to the member, due mid-2026.
      const targeted = (
        await request(app.getHttpServer())
          .post(`/kanban/lists/${todo}/cards`)
          .set('Authorization', `Bearer ${memberToken}`)
          .send({
            title: 'targeted',
            priority: 'HIGH',
            assigneeId: memberId,
            dueDate: '2026-06-15',
          })
          .expect(201)
      ).body.data;

      // Filter by priority + assignee.
      const byPriority = await request(app.getHttpServer())
        .get(`/kanban/boards/${boardId}/cards`)
        .query({ priority: 'HIGH', assigneeId: memberId })
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      const ids = (byPriority.body.data as { id: string }[]).map((c) => c.id);
      expect(ids).toContain(targeted.id);
      expect(ids.every((id: string) => id !== undefined)).toBe(true);
      // Every returned card is HIGH + assigned to member.
      expect(
        (byPriority.body.data as { priority: string; assigneeId: string }[]).every(
          (c) => c.priority === 'HIGH' && c.assigneeId === memberId,
        ),
      ).toBe(true);

      // Date-range filter: dueAfter excludes the 2020 card, dueBefore excludes 2099.
      const byRange = await request(app.getHttpServer())
        .get(`/kanban/boards/${boardId}/cards`)
        .query({ dueAfter: '2026-01-01', dueBefore: '2026-12-31' })
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      const rangeIds = (byRange.body.data as { id: string }[]).map((c) => c.id);
      expect(rangeIds).toContain(targeted.id);
      expect(rangeIds.length).toBe(1);

      // sprintId=none returns only cards with no sprint (all of them here).
      const noSprint = await request(app.getHttpServer())
        .get(`/kanban/boards/${boardId}/cards`)
        .query({ sprintId: 'none' })
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      expect(
        (noSprint.body.data as { sprintId: string | null }[]).every(
          (c) => c.sprintId === null,
        ),
      ).toBe(true);

      // An outsider is blocked from the board-wide search.
      await request(app.getHttpServer())
        .get(`/kanban/boards/${boardId}/cards`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(403);
    });

    it('labels: SM-only definition, any-member attach/detach, cross-board rejected', async () => {
      // A member cannot create a label.
      await request(app.getHttpServer())
        .post(`/kanban/boards/${boardId}/labels`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ name: 'Bug', color: '#f00' })
        .expect(403);

      const label = (
        await request(app.getHttpServer())
          .post(`/kanban/boards/${boardId}/labels`)
          .set('Authorization', `Bearer ${scrumToken}`)
          .send({ name: 'Bug', color: '#f00' })
          .expect(201)
      ).body.data;
      expect(label.boardId).toBe(boardId);

      const card = (
        await request(app.getHttpServer())
          .post(`/kanban/lists/${todo}/cards`)
          .set('Authorization', `Bearer ${memberToken}`)
          .send({ title: 'labelled' })
          .expect(201)
      ).body.data;

      // Any member attaches; the card response carries the label.
      const attached = await request(app.getHttpServer())
        .post(`/kanban/cards/${card.id}/labels/${label.id}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(201);
      expect(
        (attached.body.data.labels as { id: string }[]).some((l) => l.id === label.id),
      ).toBe(true);

      // Idempotent re-attach.
      await request(app.getHttpServer())
        .post(`/kanban/cards/${card.id}/labels/${label.id}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(201);

      // Detach.
      const detached = await request(app.getHttpServer())
        .delete(`/kanban/cards/${card.id}/labels/${label.id}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      expect((detached.body.data.labels as unknown[]).length).toBe(0);

      // A label from another board cannot be attached to this card.
      const otherBoard = (
        await request(app.getHttpServer())
          .post('/kanban/boards')
          .set('Authorization', `Bearer ${scrumToken}`)
          .send({ name: 'Other Board' })
          .expect(201)
      ).body.data.id;
      createdBoardIds.push(otherBoard);
      const foreignLabel = (
        await request(app.getHttpServer())
          .post(`/kanban/boards/${otherBoard}/labels`)
          .set('Authorization', `Bearer ${scrumToken}`)
          .send({ name: 'Foreign', color: '#00f' })
          .expect(201)
      ).body.data;
      await request(app.getHttpServer())
        .post(`/kanban/cards/${card.id}/labels/${foreignLabel.id}`)
        .set('Authorization', `Bearer ${scrumToken}`)
        .expect(400);
    });

    it('list reorder: SM-only, fractional position', async () => {
      // A member cannot reorder.
      await request(app.getHttpServer())
        .patch(`/kanban/lists/${todo}/reorder`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ position: 3072 })
        .expect(403);

      // The board also carries its 3 auto-provisioned default lists, one of
      // which (Completed) already sits at position 3072 — so this request
      // may collide and trigger a respace; the exact resulting number isn't
      // the point, only that `todo` ends up ordered after `done` (below).
      await request(app.getHttpServer())
        .patch(`/kanban/lists/${todo}/reorder`)
        .set('Authorization', `Bearer ${scrumToken}`)
        .send({ position: 3072 })
        .expect(200);

      // The board's lists are now ordered done(2048) then todo(moved after it).
      const lists = await request(app.getHttpServer())
        .get(`/kanban/boards/${boardId}/lists`)
        .set('Authorization', `Bearer ${scrumToken}`)
        .expect(200);
      const order = (lists.body.data as { id: string }[]).map((l) => l.id);
      expect(order.indexOf(done)).toBeLessThan(order.indexOf(todo));
    });

    it('sprint listing across boards is grouped by computed status with counts', async () => {
      // Add a completed + upcoming sprint on this board.
      await request(app.getHttpServer())
        .post(`/kanban/boards/${boardId}/sprints`)
        .set('Authorization', `Bearer ${scrumToken}`)
        .send({ name: 'Past', durationWeeks: 'ONE_WEEK', startDate: '2020-01-01' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/kanban/boards/${boardId}/sprints`)
        .set('Authorization', `Bearer ${scrumToken}`)
        .send({ name: 'Future', durationWeeks: 'ONE_WEEK', startDate: '2099-01-01' })
        .expect(201);

      const grouped = await request(app.getHttpServer())
        .get('/kanban/sprints')
        .query({ boardId })
        .set('Authorization', `Bearer ${scrumToken}`)
        .expect(200);
      const data = grouped.body.data as Record<string, { name: string; cardCount: number }[]>;
      expect(data.COMPLETED.some((s) => s.name === 'Past')).toBe(true);
      expect(data.UPCOMING.some((s) => s.name === 'Future')).toBe(true);
      // Counts present on every entry.
      expect(
        [...data.COMPLETED, ...data.UPCOMING, ...data.ACTIVE].every(
          (s) => typeof s.cardCount === 'number',
        ),
      ).toBe(true);

      // An outsider (member of no board) sees empty groups.
      const outsiderView = await request(app.getHttpServer())
        .get('/kanban/sprints')
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(200);
      const od = outsiderView.body.data as Record<string, unknown[]>;
      expect(od.COMPLETED.length + od.UPCOMING.length + od.ACTIVE.length).toBe(0);
    });
  });
});
