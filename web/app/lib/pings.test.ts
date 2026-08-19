import { linkedPingHref, pingAgeHours, pingContextForPath } from './pings';

describe('pings presentation helpers', () => {
  it('computes whole elapsed hours for the 24-hour overdue rule', () => {
    expect(pingAgeHours('2026-08-18T10:00:00.000Z', new Date('2026-08-19T11:30:00.000Z'))).toBe(25);
  });

  it('derives record links and vertical scope from the current route', () => {
    expect(pingContextForPath('/sales/orders/order-7')).toEqual({ verticalCode: 'SALES', linkedRecordType: 'ORDER', linkedRecordId: 'order-7', label: 'Order' });
    expect(pingContextForPath('/scm/items')).toEqual({ verticalCode: 'SCM', linkedRecordType: 'PAGE', linkedRecordId: '/scm/items', label: 'Current page' });
    expect(pingContextForPath('/kanban/boards/board-2')).toEqual({ linkedRecordType: 'KANBAN_BOARD', linkedRecordId: 'board-2', label: 'Kanban board', verticalCode: undefined });
  });

  it('maps supported linked records and rejects unknown types', () => {
    expect(linkedPingHref('KANBAN_CARD', 'card-1')).toBe('/kanban/cards/card-1');
    expect(linkedPingHref('UNKNOWN', 'x')).toBeNull();
    expect(linkedPingHref(null, null)).toBeNull();
  });
});
