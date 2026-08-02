/**
 * Assert the signed-in user is buyer or seller on a chat thread.
 * Returns 403 (not 404) when the thread exists but the caller is not a party —
 * so URL hijacking is rejected explicitly.
 */
export async function assertThreadAccess(supabase, threadId, userId, { select = 'id, buyer_id, seller_id' } = {}) {
  const { data, error } = await supabase
    .from('chat_threads')
    .select(select)
    .eq('id', threadId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return { ok: false, status: 404, error: 'Conversation not found' };
  }
  if (data.buyer_id !== userId && data.seller_id !== userId) {
    return {
      ok: false,
      status: 403,
      error: 'Access denied. Only the two participants in this chat can open it.',
    };
  }
  return { ok: true, thread: data };
}
