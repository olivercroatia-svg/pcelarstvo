export interface OutboxScope {
  userId: string
  farmId: string
}

export function belongsToScope(item: OutboxScope, active: OutboxScope): boolean {
  return item.userId === active.userId && item.farmId === active.farmId
}
