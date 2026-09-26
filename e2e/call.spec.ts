import { expect, test } from '@playwright/test'
import { becomeFriends, personName, signUp, startChat } from './people'

// A fake camera and microphone, allowed without asking.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } })
const devices = { permissions: ['camera', 'microphone'] }
/** A connected call shows how long it has lasted, e.g. "0:04". */
const DURATION = /^\d+:\d{2}$/
/** Long enough to be sure the call stays up once connected. */
const STAYS_UP_MS = 6000

test('a video call connects, stays up, and ends for both people', async ({ browser }) => {
  const carolName = personName('Carol')
  const danName = personName('Dan')
  const carol = await signUp(browser, carolName, devices)
  const dan = await signUp(browser, danName, devices)
  await becomeFriends(carol, dan)
  await startChat(carol, danName, 'Call you in a sec')
  await dan.getByRole('option', { name: new RegExp(carolName) }).click()

  await carol.getByRole('button', { name: 'Video call' }).click()
  await expect(dan.getByText(`${carolName} is video calling`)).toBeVisible()
  await dan.getByRole('button', { name: 'Accept' }).click()

  // Connected on both sides, and still connected a few seconds later.
  for (const page of [carol, dan]) await expect(page.getByRole('dialog').getByText(DURATION)).toBeVisible()
  await carol.waitForTimeout(STAYS_UP_MS)
  for (const page of [carol, dan]) await expect(page.getByRole('button', { name: 'End call' })).toBeVisible()

  await carol.getByRole('button', { name: 'End call' }).click()
  for (const page of [carol, dan]) await expect(page.getByText('Call ended')).toBeVisible()
})
