import assert from 'node:assert/strict'
import test from 'node:test'

import { formatDecimalInput, parseDecimalInput } from './decimal.ts'
import { belongsToScope, type OutboxScope } from './outboxScope.ts'

test('AI decimal values remain valid number input values', () => {
  assert.equal(formatDecimalInput(12.34), '12.34')
  assert.equal(parseDecimalInput('12.34'), 12.34)
})

test('Croatian decimal input is normalized before submission', () => {
  assert.equal(parseDecimalInput('12,34'), 12.34)
})

test('outbox entries only belong to the user and farm that created them', () => {
  const active: OutboxScope = { userId: 'user-a', farmId: 'farm-a' }
  assert.equal(belongsToScope({ userId: 'user-a', farmId: 'farm-a' }, active), true)
  assert.equal(belongsToScope({ userId: 'user-b', farmId: 'farm-a' }, active), false)
  assert.equal(belongsToScope({ userId: 'user-a', farmId: 'farm-b' }, active), false)
})
