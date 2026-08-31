import {
  cardAssignedPush,
  pingReceivedPush,
  PINGS_URL,
  PUSH_PREVIEW_LENGTH,
} from './push-triggers';

describe('push triggers', () => {
  describe('pingReceivedPush', () => {
    it('names the sender and previews the message', () => {
      const push = pingReceivedPush({
        pingId: 'ping-1',
        senderName: 'Asha Menon',
        message: 'Can you approve the GRN before 5?',
      });
      expect(push.title).toBe('Asha Menon pinged you');
      expect(push.body).toBe('Can you approve the GRN before 5?');
    });

    it('deep-links to the Pings view', () => {
      expect(
        pingReceivedPush({
          pingId: 'ping-1',
          senderName: 'Asha',
          message: 'hi',
        }).url,
      ).toBe(PINGS_URL);
    });

    it('tags per ping so two different pings do not collapse into one', () => {
      const a = pingReceivedPush({
        pingId: 'ping-1',
        senderName: 'Asha',
        message: 'first',
      });
      const b = pingReceivedPush({
        pingId: 'ping-2',
        senderName: 'Asha',
        message: 'second',
      });
      expect(a.tag).toBe('ping:ping-1');
      expect(b.tag).toBe('ping:ping-2');
      expect(a.tag).not.toBe(b.tag);
    });

    it('truncates a long message rather than filling the notification shade', () => {
      const push = pingReceivedPush({
        pingId: 'ping-1',
        senderName: 'Asha',
        message: 'x'.repeat(500),
      });
      expect(push.body).toHaveLength(PUSH_PREVIEW_LENGTH);
      expect(push.body?.endsWith('…')).toBe(true);
    });
  });

  describe('cardAssignedPush', () => {
    it('names the assigner and shows the task title', () => {
      const push = cardAssignedPush({
        cardId: 'card-7',
        cardTitle: 'Draft the Q3 vendor audit plan',
        assignerName: 'Ravi Kumar',
      });
      expect(push.title).toBe('Ravi Kumar assigned you a task');
      expect(push.body).toBe('Draft the Q3 vendor audit plan');
    });

    it('deep-links through the card resolver, not straight to a board', () => {
      // /kanban/cards/:id is what decides board-modal vs standalone view, so a
      // non-member assignee is never sent to a board they cannot open.
      expect(
        cardAssignedPush({
          cardId: 'card-7',
          cardTitle: 'Task',
          assignerName: 'Ravi',
        }).url,
      ).toBe('/kanban/cards/card-7');
    });

    it('tags per card so a reassignment replaces the earlier notification', () => {
      expect(
        cardAssignedPush({
          cardId: 'card-7',
          cardTitle: 'Task',
          assignerName: 'Ravi',
        }).tag,
      ).toBe('card:card-7');
    });
  });
});
