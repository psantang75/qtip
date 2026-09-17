import { describe, it, expect } from 'vitest'
import type { MissedOpportunityFinding } from '@/types/missedOpportunities'
import {
  customerLabel,
  groupByCustomerThenInteraction,
  uniqueCategories,
} from '../groupFindings'

const finding = (over: Partial<MissedOpportunityFinding> = {}): MissedOpportunityFinding => ({
  findingId: '1',
  dateKey: 20260904,
  callDate: '2026-09-04T13:42:00',
  agentName: 'Jane Rep',
  conversationId: 'conv-1',
  talkSecs: 420,
  direction: 'inbound',
  customerName: 'Mabels Diner',
  crmRefKind: 'TASK',
  crmRefId: 12345,
  ruleKey: 'buying_signal_not_closed',
  ruleName: 'Buying signal not closed',
  category: 'Closing',
  severity: 'high',
  title: 'Did not ask for the order',
  whatHappened: 'Owner wanted install before the holidays.',
  evidenceQuote: 'I want this in before Thanksgiving',
  evidenceSpeaker: 'CUSTOMER',
  recommendedApproach: 'Ask for the order.',
  recoveryAction: 'Call Mabels this morning.',
  estValueNote: '~$2,400 ARR',
  ...over,
})

describe('groupByCustomerThenInteraction', () => {
  it('groups two customers under one agent, worst first', () => {
    const rows = [
      finding({ findingId: 'low', customerName: 'Quiet Shop', severity: 'low', conversationId: 'c-q' }),
      finding({ findingId: 'high', customerName: 'Mabels Diner', severity: 'high', conversationId: 'c-m' }),
    ]
    const groups = groupByCustomerThenInteraction(rows)
    expect(groups.map((g) => g.customerName)).toEqual(['Mabels Diner', 'Quiet Shop'])
  })

  it('keeps two calls with the same customer as separate interactions, chronological', () => {
    const rows = [
      finding({
        findingId: 'afternoon',
        conversationId: 'conv-pm',
        callDate: '2026-09-04T18:15:00',
        category: 'Follow-through',
      }),
      finding({
        findingId: 'morning',
        conversationId: 'conv-am',
        callDate: '2026-09-04T13:42:00',
        category: 'Closing',
      }),
    ]
    const [customer] = groupByCustomerThenInteraction(rows)
    expect(customer.interactions).toHaveLength(2)
    expect(customer.interactions[0].key).toBe('conv-am')
    expect(customer.interactions[1].key).toBe('conv-pm')
  })

  it('stacks multiple misses on the same call under one interaction', () => {
    const rows = [
      finding({ findingId: 'a', category: 'Closing', severity: 'high' }),
      finding({ findingId: 'b', category: 'Follow-through', severity: 'medium' }),
    ]
    const [customer] = groupByCustomerThenInteraction(rows)
    expect(customer.interactions).toHaveLength(1)
    expect(customer.interactions[0].findings.map((f) => f.findingId)).toEqual(['a', 'b'])
  })

  it('falls back to Unknown caller when the name is missing', () => {
    expect(customerLabel({ customerName: null })).toBe('Unknown caller')
    expect(customerLabel({ customerName: '  ' })).toBe('Unknown caller')
    const [group] = groupByCustomerThenInteraction([finding({ customerName: null })])
    expect(group.customerName).toBe('Unknown caller')
  })

  it('lists each category once for the customer header pills', () => {
    const rows = [
      finding({ findingId: 'a', category: 'Closing' }),
      finding({ findingId: 'b', category: 'Closing' }),
      finding({ findingId: 'c', category: 'Follow-through' }),
    ]
    expect(uniqueCategories(rows)).toEqual(['Closing', 'Follow-through'])
  })
})
