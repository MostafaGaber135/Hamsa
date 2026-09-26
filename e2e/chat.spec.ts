import { expect, test } from '@playwright/test'
import { becomeFriends, personName, signUp, startChat } from './people'

test('friends through an invite link, then a message arrives live and the reply comes back', async ({ browser }) => {
  const aliceName = personName('Alice')
  const bobName = personName('Bob')
  const alice = await signUp(browser, aliceName)
  const bob = await signUp(browser, bobName)

  await becomeFriends(alice, bob)

  // Alice's bell tells her Bob accepted.
  await alice.getByRole('button', { name: 'Notifications' }).click()
  await expect(alice.getByRole('dialog').getByText(`${bobName} accepted your friend request`)).toBeVisible()
  await alice.getByRole('button', { name: 'Close notifications' }).click()

  // Friends now: Alice starts a chat with Bob and writes.
  await startChat(alice, bobName, 'Hello from Alice')

  // It arrives in Bob's chat list, live.
  await bob.getByRole('option', { name: new RegExp(aliceName) }).click()
  await expect(bob.getByRole('log').getByText('Hello from Alice')).toBeVisible()

  // Bob replies, and Alice sees it without reloading.
  const bobBox = bob.getByRole('textbox', { name: `Message ${aliceName}` })
  await bobBox.fill('Hi Alice')
  await bobBox.press('Enter')
  await expect(alice.getByRole('log').getByText('Hi Alice')).toBeVisible()
})
