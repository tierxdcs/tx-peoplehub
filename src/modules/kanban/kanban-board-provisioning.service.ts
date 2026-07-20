import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const DEFAULT_KANBAN_LISTS = [
  { name: 'To Do', position: 1024, isDoneList: false },
  { name: 'In progress', position: 2048, isDoneList: false },
  { name: 'Completed', position: 3072, isDoneList: true },
] as const;

/** Shared list provisioning for human-created and Project Kickoff boards. */
@Injectable()
export class KanbanBoardProvisioningService {
  async createDefaultLists(
    tx: Prisma.TransactionClient,
    boardId: string,
    createdById: string,
  ): Promise<{ todoListId: string; doneListId: string }> {
    const created = [];
    for (const list of DEFAULT_KANBAN_LISTS) {
      created.push(
        await tx.kanbanList.create({
          data: { boardId, createdById, ...list },
        }),
      );
    }
    return {
      todoListId: created[0].id,
      doneListId: created[2].id,
    };
  }
}
