import { KanbanActivityService } from './kanban-activity.service';

describe('KanbanActivityService', () => {
  const service = new KanbanActivityService({} as never);

  it('uses the established activity wording for every cross-list move', () => {
    expect(service.listMoved('To do', 'Completed')).toBe(
      'moved this card from To do to Completed',
    );
  });
});
