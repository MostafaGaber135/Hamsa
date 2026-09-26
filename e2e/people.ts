// Steps the end-to-end tests share: signing people up, making them friends, opening a chat.
import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test'

// Unique people per run, so the tests work on a database that isn't empty.
const run = Date.now().toString(36)

export const personName = (first: string) => `${first} ${run}`

export async function signUp(browser: Browser, name: string, options?: BrowserContextOptions) {
  const page = await (await browser.newContext(options)).newPage()
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

/** The invited person copies their invite link, the other opens it and sends a request, which is accepted. */
export async function becomeFriends(requester: Page, invited: Page) {
  await invited.getByRole('button', { name: 'Friends' }).first().click()
  await invited.getByRole('tab', { name: 'Find people' }).click()
  const inviteLink = (await invited.getByText(/\/add\/[a-z0-9_]+$/).textContent()) ?? ''

  await requester.goto(new URL(inviteLink).pathname)
  await requester.getByRole('button', { name: 'Add friend' }).click()
  await invited.getByRole('tab', { name: /Requests/ }).click()
  await invited.getByRole('button', { name: 'Accept' }).click()
}

/** Starts a one-to-one chat with a friend and sends the first message. */
export async function startChat(page: Page, friendName: string, firstMessage: string) {
  await page.getByRole('button', { name: 'New chat' }).first().click()
  await page.getByLabel('Search your friends').fill(friendName)
  await page
    .getByRole('dialog')
    .getByRole('button', { name: new RegExp(friendName) })
    .click()
  await page.getByRole('button', { name: 'Start chat' }).click()
  const box = page.getByRole('textbox', { name: `Message ${friendName}` })
  await box.fill(firstMessage)
  await box.press('Enter')
}
