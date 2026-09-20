import supabase from '../config/supabase.js';

// ── §17 EVENT LIFECYCLE ──────────────────────────────────────────────────────
// LIVE: community open. MEMORY/ARCHIVE: social activity closes, the memory
// (posts, photos, bibs, results) stays readable. The lifecycle row is cached
// briefly; a missing row or table (pre-migration-017) fails OPEN so existing
// behaviour is never regressed by the gate itself.
let lifecycleCache = { mode: null, at: 0 };
const LIFECYCLE_TTL_MS = 1000;

async function resolveLifecycleMode() {
  if (Date.now() - lifecycleCache.at < LIFECYCLE_TTL_MS && lifecycleCache.mode) {
    return lifecycleCache.mode;
  }
  try {
    const [lifecycleRes, configRes] = await Promise.all([
      supabase.from('event_lifecycle').select('current_mode').limit(1).maybeSingle(),
      supabase.from('event_config').select('phase').eq('id', 1).maybeSingle()
    ]);

    const lifeMode = lifecycleRes.data?.current_mode;
    const confPhase = configRes.data?.phase;

    let mode = 'live';
    if (confPhase === 'archive' || lifeMode === 'archive') {
      mode = 'archive';
    } else if (confPhase === 'post_event' || lifeMode === 'memory') {
      mode = 'memory';
    } else {
      mode = lifeMode || 'live';
    }

    lifecycleCache = { mode, at: Date.now() };
  } catch {
    lifecycleCache = { mode: 'live', at: Date.now() };
  }
  return lifecycleCache.mode;
}


async function assertSocialOpen(res) {
  const mode = await resolveLifecycleMode();
  if (mode === 'live') return true;
  res.status(403).json({
    error: 'The community feed is closed in ' + mode + ' mode. Past posts remain viewable.',
    code: 'SOCIAL_CLOSED',
    mode
  });
  return false;
}

const POST_TYPES = ['training', 'story', 'prep', 'tip', 'question', 'milestone', 'team_update', 'excitement'];
const DISCIPLINES = ['swim', 'bike', 'run', 'triathlon', 'general'];
const REACTIONS = ['cheer', 'fire', 'heart', 'applause', 'strong'];

// Best-effort denormalized counter sync (community_posts.likes_count /
// comments_count). Never fails the request if the counter update fails.
async function syncPostCounters(postId) {
  try {
    const [likes, comments] = await Promise.all([
      supabase.from('post_reactions').select('id', { count: 'exact', head: true }).eq('post_id', postId),
      supabase.from('post_comments').select('id', { count: 'exact', head: true }).eq('post_id', postId)
    ]);
    await supabase
      .from('community_posts')
      .update({ likes_count: likes.count || 0, comments_count: comments.count || 0 })
      .eq('id', postId);
  } catch (err) {
    console.error('Counter sync failed for post', postId, err.message);
  }
}

export const getPosts = async (req, res) => {
  try {
    const { page, limit, offset } = req.pagination || { page: 1, limit: 20, offset: 0 };
    let query = supabase
      .from('community_posts')
      .select('*, profiles:user_id (full_name)', { count: 'exact' })
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    const { discipline, type } = req.query;
    if (discipline) query = query.eq('discipline', discipline);
    if (type) query = query.eq('post_type', type);
    const { data, error, count } = await query;
    // PostgREST rejects offsets beyond the row count (PGRST103) — normalize any
    // out-of-range page to the last valid one instead of 500ing.
    if (error && error.code === 'PGRST103') {
      const totalPages = Math.max(Math.ceil((count || 0) / limit), 1);
      const safePage = Math.min(page, totalPages);
      const safeOffset = (safePage - 1) * limit;
      let retryQuery = supabase
        .from('community_posts')
        .select('*, profiles:user_id (full_name)', { count: 'exact' })
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .range(safeOffset, safeOffset + limit - 1);
      if (discipline) retryQuery = retryQuery.eq('discipline', discipline);
      if (type) retryQuery = retryQuery.eq('post_type', type);
      const retry = await retryQuery;
      res.json({ success: true, data: retry.data || [], pagination: { page: safePage, limit, total: count, pages: Math.ceil((count || 0) / limit) } });
      return;
    }
    if (error) throw error;
    res.json({ success: true, data, pagination: { page, limit, total: count, pages: Math.ceil((count || 0) / limit) } });
  } catch (err) {
    console.error('Error fetching posts:', err);
    res.status(500).json({ error: 'Failed to retrieve community posts' });
  }
};

export const createPost = async (req, res) => {
  try {
    if (!(await assertSocialOpen(res))) return;
    const { content, post_type = 'training', discipline = 'general', media_urls } = req.body;
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: 'Authentication required' });
    if (!content || content.trim().length === 0) return res.status(400).json({ error: 'Post content is required' });
    if (content.trim().length > 2000) return res.status(400).json({ error: 'Post content must be 2000 characters or fewer' });
    if (!POST_TYPES.includes(post_type)) return res.status(400).json({ error: 'Invalid post_type. Use: ' + POST_TYPES.join(', ') });
    if (!DISCIPLINES.includes(discipline)) return res.status(400).json({ error: 'Invalid discipline. Use: ' + DISCIPLINES.join(', ') });

    // §14 multi-image: normalize media_urls to an array of URL strings.
    const urls = (Array.isArray(media_urls) ? media_urls : (media_urls ? [media_urls] : []))
      .map(u => typeof u === 'string' ? u.trim() : '')
      .filter(u => u.length > 0)
      .slice(0, 8);
    // Legacy single column keeps the first image; the full set lives in
    // community_posts.media_urls (migration 018) so no photo is dropped.
    const image_url = urls[0] || null;

    // Build the insert payload once; media_urls is only included when the
    // column exists (migration 018 applied). On pre-018 databases a test
    // insert with the key fails with PGRST204, we retry without it, and
    // remember the result for the life of the process.
    let supportsMediaUrls = createPost._supportsMediaUrls;
    if (supportsMediaUrls === undefined) {
      const { error: probeErr } = await supabase
        .from('community_posts')
        .insert({ user_id, content: 'media_column_probe__ignored', status: 'hidden', media_urls: [] });
      // PGRST204 = "Could not find the 'media_urls' column of community_posts"
      createPost._supportsMediaUrls = supportsMediaUrls = !(probeErr?.code === 'PGRST204');
    }

    const payload = { user_id, content: content.trim(), post_type, discipline, image_url, status: 'published' };
    if (supportsMediaUrls) payload.media_urls = urls;

    const { data, error } = await supabase
      .from('community_posts')
      .insert(payload)
      .select('*, profiles:user_id (full_name)')
      .single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('Error creating post:', err);
    res.status(500).json({ error: 'Failed to create post' });
  }
};

export const reactToPost = async (req, res) => {
  try {
    if (!(await assertSocialOpen(res))) return;
    const { postId } = req.params;
    const { reaction_type = 'cheer' } = req.body;
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: 'Authentication required' });
    if (!REACTIONS.includes(reaction_type)) return res.status(400).json({ error: 'Invalid reaction_type. Use: ' + REACTIONS.join(', ') });

    const { data: existing } = await supabase
      .from('post_reactions').select('id')
      .eq('post_id', postId).eq('user_id', user_id).eq('reaction_type', reaction_type).maybeSingle();
    if (existing) {
      const { error } = await supabase.from('post_reactions').delete().eq('id', existing.id);
      if (error) throw error;
      await syncPostCounters(postId);
      return res.json({ success: true, action: 'removed' });
    }
    const { error } = await supabase.from('post_reactions').insert({ post_id: postId, user_id, reaction_type });
    if (error) throw error;
    await syncPostCounters(postId);
    res.json({ success: true, action: 'added' });
  } catch (err) {
    console.error('Error toggling reaction:', err);
    res.status(500).json({ error: 'Failed to toggle reaction' });
  }
};

export const addComment = async (req, res) => {
  try {
    if (!(await assertSocialOpen(res))) return;
    const { postId } = req.params;
    const { content } = req.body;
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: 'Authentication required' });
    if (!content || content.trim().length === 0) return res.status(400).json({ error: 'Comment content is required' });
    if (content.trim().length > 1000) return res.status(400).json({ error: 'Comment must be 1000 characters or fewer' });

    const { data: post } = await supabase.from('community_posts').select('id, status').eq('id', postId).maybeSingle();
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status !== 'published') return res.status(403).json({ error: 'Comments are closed for this post' });

    const { data, error } = await supabase
      .from('post_comments')
      .insert({ post_id: postId, user_id, content: content.trim() })
      .select('*, profiles:user_id (full_name)').single();
    if (error) throw error;
    await syncPostCounters(postId);
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('Error adding comment:', err);
    res.status(500).json({ error: 'Failed to add comment' });
  }
};

export const getComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const { data, error } = await supabase
      .from('post_comments').select('*, profiles:user_id (full_name)')
      .eq('post_id', postId).order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('Error fetching comments:', err);
    res.status(500).json({ error: 'Failed to retrieve comments' });
  }
};

// ── §15 MODERATION: report / review / hide ──────────────────────────────────

export const reportPost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { reason, details } = req.body;
    const reporter_id = req.user?.id;
    if (!reporter_id) return res.status(401).json({ error: 'Authentication required' });
    const VALID_REASONS = ['spam', 'abuse', 'inappropriate', 'misinformation', 'other'];
    if (!reason || !VALID_REASONS.includes(reason)) {
      return res.status(400).json({ error: 'Invalid reason. Use: ' + VALID_REASONS.join(', ') });
    }
    const { data: post } = await supabase.from('community_posts').select('id').eq('id', postId).maybeSingle();
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const { data, error } = await supabase
      .from('post_reports')
      .insert({ post_id: postId, reporter_id, reason, details: details?.trim() || null })
      .select().single();
    if (error) throw error;

    // Flag for the moderation queue (idempotent — only moves published posts).
    await supabase.from('community_posts').update({ status: 'flagged' }).eq('id', postId).eq('status', 'published');

    res.status(201).json({ success: true, data, message: 'Report received. Our moderators will review it.' });
  } catch (err) {
    console.error('Error reporting post:', err);
    res.status(500).json({ error: 'Failed to submit report' });
  }
};

export const getPostReports = async (req, res) => {
  try {
    // Admin-only report queue; clamp manually (this route skips the clamp middleware).
    const { status = 'open' } = req.query;
    const page = Math.min(Math.max(parseInt(req.query.page) || 1, 1), 10000);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
    const offset = (page - 1) * limit;
    let query = supabase
      .from('post_reports')
      .select('*, post:post_id (id, status, content, created_at), reporter:reporter_id (full_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (status && status !== 'all') query = query.eq('status', status);
    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ success: true, data, pagination: { page, limit, total: count, pages: Math.ceil((count || 0) / limit) } });
  } catch (err) {
    console.error('Error fetching reports:', err);
    res.status(500).json({ error: 'Failed to retrieve reports' });
  }
};

export const moderatePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { status, moderator_note } = req.body;
    if (!['published', 'hidden'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Use: published or hidden' });
    }
    const { data, error } = await supabase
      .from('community_posts')
      .update({ status })
      .eq('id', postId)
      .select('*, profiles:user_id (full_name)')
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Post not found' });

    // A moderation decision resolves every open report for the post.
    const { error: repErr } = await supabase
      .from('post_reports')
      .update({ status: 'resolved', moderator_note: moderator_note || null })
      .eq('post_id', postId)
      .eq('status', 'open');
    if (repErr) console.error('Failed to resolve reports for post', postId, repErr.message);

    await supabase.from('audit_logs').insert([{
      action: 'MODERATE_POST',
      target_resource: 'community_posts:' + postId,
      details_json: { status, moderator_note: moderator_note || null },
      actor_role: req.user?.role || 'admin'
    }]);

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error moderating post:', err);
    res.status(500).json({ error: 'Failed to moderate post' });
  }
};

/**
 * §15 Own-Content Delete — Posts
 * DELETE /api/v1/community/posts/:postId
 * Allows post author or staff (admin/hq_admin) to delete a post.
 */
export const deletePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user?.id;
    const isStaff = req.user?.role === 'admin' || req.user?.role === 'hq_admin';

    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    // Fetch post to check ownership
    const { data: post, error: fetchErr } = await supabase
      .from('community_posts')
      .select('id, user_id')
      .eq('id', postId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (post.user_id !== userId && !isStaff) {
      return res.status(403).json({ error: 'You can only delete your own posts' });
    }

    // Delete post (cascade will remove reactions, comments, reports)
    const { error: delErr } = await supabase
      .from('community_posts')
      .delete()
      .eq('id', postId);

    if (delErr) throw delErr;

    res.json({ success: true, message: 'Post deleted successfully' });
  } catch (err) {
    console.error('Error deleting post:', err);
    res.status(500).json({ error: 'Failed to delete post' });
  }
};

/**
 * §15 Own-Content Delete — Comments
 * DELETE /api/v1/community/comments/:commentId
 * Allows comment author or staff to delete a comment.
 */
export const deleteComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user?.id;
    const isStaff = req.user?.role === 'admin' || req.user?.role === 'hq_admin';

    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { data: comment, error: fetchErr } = await supabase
      .from('post_comments')
      .select('id, post_id, user_id')
      .eq('id', commentId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    if (comment.user_id !== userId && !isStaff) {
      return res.status(403).json({ error: 'You can only delete your own comments' });
    }

    const { error: delErr } = await supabase
      .from('post_comments')
      .delete()
      .eq('id', commentId);

    if (delErr) throw delErr;

    // Sync counters on the parent post
    await syncPostCounters(comment.post_id);

    res.json({ success: true, message: 'Comment deleted successfully' });
  } catch (err) {
    console.error('Error deleting comment:', err);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
};

