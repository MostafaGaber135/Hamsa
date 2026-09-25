import { expect, test, type Browser } from '@playwright/test'

// Unique people per run, so the test works on a database that isn't empty.
const run = Date.now().toString(36)

async function signUp(browser: Browser, name: string) {
  const page = await (await browser.newContext()).newPage()
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create one' }).click()
  await page.getByLabel('Full name').fill(name)
  await page.getByLabel('Email').fill(`${name.split(' ')[0].toLowerCase()}.${run}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill('quiet-room-42')
  await page.getByRole('button', { name: 'Create account' }).click()
  // Signed in: the chat list is on screen.
  await expect(page.getByRole('button', { name: 'New chat' }).first()).toBeVisible()
  return page
}

test('friends through an invite link, then a message arrives live and the reply comes back', async ({ browser }) => {
  const aliceName = `Alice ${run}`
  const bobName = `Bob ${run}`
  const alice = await signUp(browser, aliceName)
  const bob = await signUp(browser, bobName)

  // Bob copies his invite link from the friends page.
  await bob.getByRole('button', { name: 'Friends' }).first().click()
  await bob.getByRole('tab', { name: 'Find people' }).click()
  const inviteLink = (await bob.getByText(/\/add\/[a-z0-9_]+$/).textContent()) ?? ''

  // Alice opens it and sends him a request; Bob accepts.
  await alice.goto(new URL(inviteLink).pathname)
  await alice.getByRole('button', { name: 'Add friend' }).click()
  await bob.getByRole('tab', { name: /Requests/ }).click()
  await bob.getByRole('button', { name: 'Accept' }).click()

  // Friends now: Alice starts a chat with Bob and writes.
  await alice.getByRole('button', { name: 'New chat' }).first().click()
  await alice.getByLabel('Search your friends').fill(bobName)
  await alice
    .getByRole('dialog')
    .getByRole('button', { name: new RegExp(bobName) })
    .click()
  await alice.getByRole('button', { name: 'Start chat' }).click()
  const aliceBox = alice.getByRole('textbox', { name: `Message ${bobName}` })
  await aliceBox.fill('Hello from Alice')
  await aliceBox.press('Enter')

  // It arrives in Bob's chat list, live.
  await bob.getByRole('option', { name: new RegExp(aliceName) }).click()
  await expect(bob.getByRole('log').getByText('Hello from Alice')).toBeVisible()

  // Bob replies, and Alice sees it without reloading.
  const bobBox = bob.getByRole('textbox', { name: `Message ${aliceName}` })
  await bobBox.fill('Hi Alice')
  await bobBox.press('Enter')
  await expect(alice.getByRole('log').getByText('Hi Alice')).toBeVisible()
})
