/** App paths — never put usernames or other personal data in the URL. */
export const paths = {
  login: '/login',
  buy: '/buy',
  sell: '/sell',
  purchased: '/purchased',
  chats: '/chats',
  chat: (threadId) => `/chats/${threadId}`,
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isThreadId(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}
