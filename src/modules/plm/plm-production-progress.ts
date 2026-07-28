/** One source of truth for internal and customer-facing PLM production %. */
export function deriveProductionProgress(
  cards: Array<{ list: { isDoneList: boolean } }>,
) {
  const total = cards.length;
  const done = cards.filter((card) => card.list.isDoneList).length;
  return {
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}
