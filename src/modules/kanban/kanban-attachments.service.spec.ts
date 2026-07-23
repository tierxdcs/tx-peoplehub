import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  KanbanCardAttachmentStatus,
  KanbanCardStatus,
  Role,
} from '@prisma/client';
import { KanbanAttachmentsService } from './kanban-attachments.service';

describe('KanbanAttachmentsService', () => {
  const user = {
    id: 'employee-1',
    email: 'priya@example.com',
    role: Role.EMPLOYEE,
    verticalId: null,
  };
  const card = {
    id: 'card-1',
    status: KanbanCardStatus.ACTIVE,
    assigneeId: 'assignee-1',
    createdById: user.id,
    list: { boardId: 'board-1' },
  };
  const attachment = {
    id: 'attachment-1',
    cardId: card.id,
    filename: 'drawing-rev3.pdf',
    contentType: 'application/pdf',
    sizeBytes: BigInt(123),
    storageKey: 'kanban/cards/card-1/attachments/attachment-1',
    uploadedById: user.id,
    status: KanbanCardAttachmentStatus.PENDING,
    createdAt: new Date('2026-07-22T12:00:00.000Z'),
    uploadedBy: { firstName: 'Priya', lastName: 'Shah' },
  };

  function setup(canManageBoard = false) {
    const tx = {
      kanbanCardAttachment: {
        update: jest.fn().mockResolvedValue({
          ...attachment,
          status: KanbanCardAttachmentStatus.ACTIVE,
        }),
      },
    };
    const prisma = {
      kanbanCard: { findUnique: jest.fn().mockResolvedValue(card) },
      kanbanCardAttachment: {
        create: jest.fn().mockResolvedValue(attachment),
        update: jest.fn().mockResolvedValue(attachment),
        findUnique: jest.fn().mockResolvedValue(attachment),
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn().mockResolvedValue(attachment),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const access = {
      assertCanViewCard: jest.fn().mockResolvedValue({ hasBoardAccess: true }),
      assertCanEditCard: jest.fn().mockResolvedValue({ canManageBoard }),
      assertCanManageBoard: canManageBoard
        ? jest.fn().mockResolvedValue({})
        : jest.fn().mockRejectedValue(new ForbiddenException()),
    };
    const storage = {
      createUploadUrl: jest
        .fn()
        .mockResolvedValue({ url: 'https://upload', expiresInSeconds: 900 }),
      headObject: jest.fn().mockResolvedValue({ sizeBytes: 123 }),
      createDownloadUrl: jest.fn(),
      deleteObjectStrict: jest.fn().mockResolvedValue(undefined),
    };
    const activity = {
      attachmentAdded: jest
        .fn()
        .mockImplementation((name: string) => `attached \`${name}\``),
      log: jest.fn().mockResolvedValue(undefined),
    };
    const service = new KanbanAttachmentsService(
      prisma as never,
      access as never,
      storage as never,
      activity as never,
    );
    return { service, prisma, access, storage, activity, tx };
  }

  it('allows the card creator to create an upload ticket after assignment', async () => {
    const { service, access, storage } = setup(false);

    await expect(
      service.createUploadUrl(
        card.id,
        {
          filename: attachment.filename,
          contentType: attachment.contentType,
          sizeBytes: Number(attachment.sizeBytes),
        },
        user,
      ),
    ).resolves.toMatchObject({ attachmentId: attachment.id });
    expect(access.assertCanEditCard).toHaveBeenCalledWith(
      user,
      card.list.boardId,
      card.assigneeId,
      card.createdById,
    );
    expect(storage.createUploadUrl).toHaveBeenCalled();
  });

  it('reuses Vault extension guardrails before creating metadata', async () => {
    const { service, prisma } = setup();

    await expect(
      service.createUploadUrl(
        card.id,
        {
          filename: 'malware.exe',
          contentType: 'application/octet-stream',
          sizeBytes: 123,
        },
        user,
      ),
    ).rejects.toThrow(
      'Files with a .exe extension are not allowed for security reasons',
    );
    expect(prisma.kanbanCardAttachment.create).not.toHaveBeenCalled();
  });

  it('rejects an uploaded object whose actual size differs', async () => {
    const { service, storage, prisma, activity } = setup();
    storage.headObject.mockResolvedValue({ sizeBytes: 999 });

    await expect(
      service.confirm(card.id, attachment.id, {}, user),
    ).rejects.toEqual(
      new BadRequestException(
        'Uploaded size (999) does not match the declared size (123)',
      ),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(activity.log).not.toHaveBeenCalled();
  });

  it('activates the attachment and logs its activity atomically', async () => {
    const { service, prisma, activity, tx } = setup();

    await service.confirm(card.id, attachment.id, {}, user);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.kanbanCardAttachment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: KanbanCardAttachmentStatus.ACTIVE },
      }),
    );
    expect(activity.log).toHaveBeenCalledWith(
      tx,
      card.id,
      user.id,
      'attached `drawing-rev3.pdf`',
    );
  });

  it('lets a board manager delete any attachment and removes R2 first', async () => {
    const { service, prisma, storage } = setup(true);
    prisma.kanbanCardAttachment.findUnique.mockResolvedValue({
      ...attachment,
      uploadedById: 'someone-else',
    });

    await service.remove(card.id, attachment.id, user);

    expect(storage.deleteObjectStrict).toHaveBeenCalledWith(
      attachment.storageKey,
    );
    expect(storage.deleteObjectStrict.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.kanbanCardAttachment.delete.mock.invocationCallOrder[0],
    );
  });

  it('lets the card creator delete another uploader’s file', async () => {
    const { service, prisma, storage } = setup(false);
    prisma.kanbanCardAttachment.findUnique.mockResolvedValue({
      ...attachment,
      uploadedById: 'someone-else',
    });

    await service.remove(card.id, attachment.id, user);
    expect(storage.deleteObjectStrict).toHaveBeenCalledWith(
      attachment.storageKey,
    );
  });

  it('blocks an assignee with comment-only access from uploading', async () => {
    const { service, access, storage } = setup(false);
    access.assertCanEditCard.mockRejectedValue(
      new ForbiddenException('Only the card creator may edit this card'),
    );

    await expect(
      service.createUploadUrl(
        card.id,
        {
          filename: attachment.filename,
          contentType: attachment.contentType,
          sizeBytes: Number(attachment.sizeBytes),
        },
        { ...user, id: card.assigneeId },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(storage.createUploadUrl).not.toHaveBeenCalled();
  });

  it('keeps database metadata when strict R2 deletion fails', async () => {
    const { service, prisma, storage } = setup(false);
    storage.deleteObjectStrict.mockRejectedValue(new Error('R2 unavailable'));

    await expect(service.remove(card.id, attachment.id, user)).rejects.toThrow(
      'R2 unavailable',
    );
    expect(prisma.kanbanCardAttachment.delete).not.toHaveBeenCalled();
  });
});
