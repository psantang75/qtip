import { describe, expect, it } from 'vitest'
import { normalizeConversationId } from '../conversationId'

const ID = '4c397ac5-ec9a-40ed-9235-c046f2e6f927'

describe('normalizeConversationId', () => {
  it('pulls the id out of a pasted Genesys Cloud interaction URL', () => {
    expect(normalizeConversationId(
      `https://apps.usw2.pure.cloud/directory/#/analytics/interactions/${ID}/admin%22`,
    )).toBe(ID)
  })

  it('handles the same URL without the stray trailing quote', () => {
    expect(normalizeConversationId(
      `https://apps.usw2.pure.cloud/directory/#/analytics/interactions/${ID}/admin`,
    )).toBe(ID)
  })

  it('handles other Genesys regions and an id in a query string', () => {
    expect(normalizeConversationId(
      `https://apps.mypurecloud.com/directory/#/analytics/interactions/${ID}/admin`,
    )).toBe(ID)
    expect(normalizeConversationId(`https://apps.usw2.pure.cloud/x?conversationId=${ID}&tab=audio`))
      .toBe(ID)
  })

  it('leaves a bare id alone, whatever whitespace or case it arrives in', () => {
    expect(normalizeConversationId(ID)).toBe(ID)
    expect(normalizeConversationId(`  ${ID}\n`)).toBe(ID)
    expect(normalizeConversationId(ID.toUpperCase())).toBe(ID.toUpperCase())
  })

  it('strips quotes and stray characters around a pasted id', () => {
    expect(normalizeConversationId(`"${ID}"`)).toBe(ID)
    expect(normalizeConversationId(`Conversation: ${ID}.`)).toBe(ID)
  })

  it('passes through input with no id in it, so legacy call ids still work', () => {
    expect(normalizeConversationId('4567894')).toBe('4567894')
    expect(normalizeConversationId('  4567894  ')).toBe('4567894')
    expect(normalizeConversationId('')).toBe('')
  })

  it('passes through a partially typed id rather than guessing', () => {
    expect(normalizeConversationId('4c397ac5-ec9a-40ed')).toBe('4c397ac5-ec9a-40ed')
  })

  it('takes the first id when text somehow carries more than one', () => {
    const other = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    expect(normalizeConversationId(`${ID} ${other}`)).toBe(ID)
  })
})
