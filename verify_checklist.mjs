import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import supabase from './config/supabase.js';

const authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const results = {};

  async function api(path, options = {}) {
    const res = await fetch('http://localhost:8800/api/v1' + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch(e) { json = { text }; }
    return { status: res.status, data: json };
  }

  console.log('=== VERIFYING INTEGRATION CHECKLIST ===\n');

  // 1. Signup / Auth
  console.log('1. Signup / Auth:');
  const { data: authUser, error: authErr } = await authClient.auth.signInWithPassword({
    email: 'user@gmail.com',
    password: 'user1234'
  });
  if (authErr) throw new Error('Auth error: ' + authErr.message);
  const token = authUser.session.access_token;
  const userProfile = await api('/participant/profile', {
    headers: { Authorization: 'Bearer ' + token }
  });
  results['1_auth'] = userProfile.status === 200;
  console.log('  -> Status:', userProfile.status, results['1_auth'] ? 'PASS' : 'FAIL');

  // 5. Teams
  console.log('\n5. Teams (create, update, ownership restriction, join, leave):');
  const teamName = 'Team Verify ' + Date.now().toString(36);
  const createTeamRes = await api('/teams', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      name: teamName,
      story: 'Test team story',
      team_type: 'community',
      is_relay: false
    })
  });
  const createdTeam = createTeamRes.data?.data;
  console.log('  -> Create team:', createTeamRes.status, createTeamRes.data);

  const updateCaptainRes = await api('/teams/' + createdTeam.id, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({ story: 'Updated story by captain' })
  });
  console.log('  -> Update by captain:', updateCaptainRes.status);

  const { data: user2 } = await authClient.auth.signInWithPassword({
    email: 'participant@gmail.com',
    password: 'user1234'
  });
  const token2 = user2.session.access_token;

  const updateNonCaptainRes = await api('/teams/' + createdTeam.id, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token2 },
    body: JSON.stringify({ story: 'Unauthorized update' })
  });
  console.log('  -> Update by non-captain (expected 403):', updateNonCaptainRes.status);

  const joinRes = await api('/teams/' + createdTeam.id + '/join', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token2 },
    body: JSON.stringify({ role: 'member' })
  });
  console.log('  -> Join team:', joinRes.status);

  const leaveRes = await api('/teams/' + createdTeam.id + '/leave', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token2 }
  });
  console.log('  -> Leave team:', leaveRes.status);

  results['5_teams'] = createTeamRes.status === 201 && updateCaptainRes.status === 200 && updateNonCaptainRes.status === 403 && joinRes.status === 200 && leaveRes.status === 200;
  console.log('  -> Overall:', results['5_teams'] ? 'PASS' : 'FAIL');

  // 6. Community Feed
  console.log('\n6. Community Feed (posts, reactions, comments, reports):');
  const postRes = await api('/community/posts', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      content: 'Community feed verification test post #' + Date.now().toString(36),
      post_type: 'training',
      discipline: 'run'
    })
  });
  console.log('  -> Create post:', postRes.status);
  const postId = postRes.data.data?.id;

  const reactRes = await api('/community/posts/' + postId + '/react', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token2 },
    body: JSON.stringify({ reaction_type: 'cheer' })
  });
  console.log('  -> React to post:', reactRes.status, 'action:', reactRes.data.action);

  const commentRes = await api('/community/posts/' + postId + '/comments', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token2 },
    body: JSON.stringify({ content: 'Keep up the great training!' })
  });
  console.log('  -> Comment on post:', commentRes.status);

  const getCommentsRes = await api('/community/posts/' + postId + '/comments');
  console.log('  -> Get comments:', getCommentsRes.status, 'count:', getCommentsRes.data.data?.length);

  const reportRes = await api('/community/posts/' + postId + '/report', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token2 },
    body: JSON.stringify({ reason: 'spam', details: 'Automated test report' })
  });
  console.log('  -> Report post:', reportRes.status);

  results['6_community'] = postRes.status === 201 && reactRes.status === 200 && commentRes.status === 201 && getCommentsRes.data.data?.length >= 1 && reportRes.status === 201;
  console.log('  -> Overall:', results['6_community'] ? 'PASS' : 'FAIL');

  // 7. Why I Participate
  console.log('\n7. Why I Participate (submit, approve, list):');
  // First delete any previous story for user to avoid unique constraint if any
  await supabase.from('why_i_participate').delete().eq('user_id', userProfile.data.data.id);

  const storyRes = await api('/stories', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      quote: 'Participating in Tour de Dar to celebrate our coastline and inspire youth athletes.',
      discipline: 'triathlon',
      story_details: 'First Olympic triathlon attempt.'
    })
  });
  console.log('  -> Submit story:', storyRes.status);
  const storyId = storyRes.data.data?.id;

  const approveRes = await api('/stories/' + storyId + '/approve', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({ is_featured: true })
  });
  console.log('  -> Approve story:', approveRes.status);

  const listStoriesRes = await api('/stories?featured=true');
  console.log('  -> List stories:', listStoriesRes.status, 'count:', listStoriesRes.data.data?.length);

  results['7_stories'] = storyRes.status === 201 && approveRes.status === 200 && listStoriesRes.data.data?.length >= 1;
  console.log('  -> Overall:', results['7_stories'] ? 'PASS' : 'FAIL');

  // 8. Challenges
  console.log('\n8. Challenges (list, join, complete, leaderboard):');
  const challengesRes = await api('/challenges', {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('  -> List challenges:', challengesRes.status, 'count:', challengesRes.data.data?.length);
  const chId = challengesRes.data.data?.[0]?.id;

  const joinChRes = await api('/challenges/' + chId + '/join', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('  -> Join challenge (201 or 409 already joined):', joinChRes.status);

  const completeChRes = await api('/challenges/' + chId + '/complete', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({ proof_url: 'https://strava.com/activities/test-123' })
  });
  console.log('  -> Complete challenge:', completeChRes.status);

  const chLeaderboardRes = await api('/challenges/' + chId + '/leaderboard');
  console.log('  -> Challenge leaderboard:', chLeaderboardRes.status, 'entries:', chLeaderboardRes.data.data?.length);

  results['8_challenges'] = challengesRes.status === 200 && (joinChRes.status === 201 || joinChRes.status === 409) && completeChRes.status === 200 && chLeaderboardRes.status === 200;
  console.log('  -> Overall:', results['8_challenges'] ? 'PASS' : 'FAIL');

  // 9. Digital Bibs
  console.log('\n9. Digital Bibs (generate, get by me, get by slug):');
  const genBibRes = await api('/bibs/generate', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      user_id: userProfile.data.data.id,
      bib_number: '08421',
      athlete_name: userProfile.data.data.full_name || 'Master Test User',
      category_name: 'Olympic Distance Triathlon',
      team_name: teamName
    })
  });
  console.log('  -> Generate bib:', genBibRes.status);

  const myBibRes = await api('/bibs/me', {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('  -> Get my bib:', myBibRes.status, 'bib_number:', myBibRes.data.data?.bib_number);

  const slugBibRes = await api('/bibs/' + myBibRes.data.data?.share_slug);
  console.log('  -> Get bib by slug:', slugBibRes.status);

  results['9_bibs'] = (genBibRes.status === 201 || genBibRes.status === 200) && myBibRes.status === 200 && slugBibRes.status === 200;
  console.log('  -> Overall:', results['9_bibs'] ? 'PASS' : 'FAIL');

  // 10. Triathlon Results
  console.log('\n10. Triathlon Results (query, leaderboards, my result):');
  await supabase.from('triathlon_results').upsert({
    user_id: userProfile.data.data.id,
    bib_number: '08421',
    athlete_name: userProfile.data.data.full_name || 'Master Test User',
    category_slug: 'olympic-individual',
    rank_overall: 1,
    rank_category: 1,
    rank_gender: 1,
    swim_time_seconds: 1440,
    t1_time_seconds: 120,
    bike_time_seconds: 3900,
    t2_time_seconds: 90,
    run_time_seconds: 2400,
    total_time_seconds: 7950,
    status: 'finished'
  }, { onConflict: 'user_id' });

  const resultsRes = await api('/results');
  console.log('  -> Results list:', resultsRes.status, 'count:', resultsRes.data.data?.length);

  const leaderboardRes = await api('/results/leaderboard?board=performance');
  console.log('  -> Performance leaderboard:', leaderboardRes.status);

  const myResultRes = await api('/results/me', {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('  -> My result:', myResultRes.status, 'overall_rank:', myResultRes.data.data?.rank_overall);

  results['10_results'] = resultsRes.status === 200 && leaderboardRes.status === 200 && myResultRes.status === 200;
  console.log('  -> Overall:', results['10_results'] ? 'PASS' : 'FAIL');

  // 11. Phase Sync
  console.log('\n11. Phase Sync (event_editions <-> event_config <-> event_lifecycle):');
  const setPhaseRes = await api('/admin/events/phase', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({ new_phase: 'event_day' })
  });
  console.log('  -> Update phase to event_day:', setPhaseRes.status);

  // Wait 1s for sync
  await new Promise(r => setTimeout(r, 1000));
  const { data: chkConfig } = await supabase.from('event_config').select('phase').eq('id', 1).maybeSingle();
  const { data: chkLifecycle } = await supabase.from('event_lifecycle').select('current_mode').maybeSingle();
  console.log('  -> event_config.phase:', chkConfig?.phase, '(expected event_day)');
  console.log('  -> event_lifecycle.current_mode:', chkLifecycle?.current_mode, '(expected live)');

  // Restore to pre_event
  await api('/admin/events/phase', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({ new_phase: 'pre_event' })
  });

  results['11_phase_sync'] = setPhaseRes.status === 200 && chkConfig?.phase === 'event_day' && chkLifecycle?.current_mode === 'live';
  console.log('  -> Overall:', results['11_phase_sync'] ? 'PASS' : 'FAIL');

  // 12. Archive-Mode Lockout
  console.log('\n12. Archive-Mode Lockout (social write blocks with 403, read stays open):');
  const setArchiveRes = await api('/triathlon/lifecycle', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({ mode: 'archive' })
  });
  console.log('  -> Set lifecycle to archive:', setArchiveRes.status);

  // Wait 1.2s for lifecycle TTL cache to refresh
  await new Promise(r => setTimeout(r, 1200));

  const writeLockoutRes = await api('/community/posts', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({ content: 'Attempt to post during archive' })
  });
  console.log('  -> Write during archive status:', writeLockoutRes.status, 'code:', writeLockoutRes.data?.code, '(expected 403 SOCIAL_CLOSED)');

  const readArchiveRes = await api('/community/posts');
  console.log('  -> Read during archive status:', readArchiveRes.status, '(expected 200)');

  // Restore to live
  await api('/triathlon/lifecycle', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({ mode: 'live' })
  });
  await new Promise(r => setTimeout(r, 1200));

  results['12_archive_lockout'] = setArchiveRes.status === 200 && writeLockoutRes.status === 403 && writeLockoutRes.data?.code === 'SOCIAL_CLOSED' && readArchiveRes.status === 200;
  console.log('  -> Overall:', results['12_archive_lockout'] ? 'PASS' : 'FAIL');

  // 13. Admin & Audit Logs
  console.log('\n13. Admin & Audit Logs:');
  const auditRes = await api('/admin/audit-logs', {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('  -> Audit logs endpoint:', auditRes.status, 'count:', auditRes.data?.count);

  results['13_audit_log'] = auditRes.status === 200 && auditRes.data?.status === 'success';
  console.log('  -> Overall:', results['13_audit_log'] ? 'PASS' : 'FAIL');

  // 14. Payment Webhook
  console.log('\n14. Payment Webhook (HMAC signature, idempotency, amount check):');
  const webhookSecret = process.env.PAYME_WEBHOOK_SECRET || 'rotary_payme_webhook_secret_2026';
  process.env.PAYME_WEBHOOK_SECRET = webhookSecret;

  const noSigRes = await api('/payments/payme/webhook', {
    method: 'POST',
    body: JSON.stringify({ order_number: 'ORD-TEST', status: 'success' })
  });
  console.log('  -> Missing signature status (expected 401):', noSigRes.status);

  const testOrderNumber = 'ORD-VERIFY-' + Date.now();
  const { data: editionsList } = await supabase.from('event_editions').select('id');
  const editionId = editionsList?.[0]?.id || '30fa6cb4-8b80-4c1d-ac4c-0a3819477fb1';
  const { error: ordInsertErr } = await supabase.from('orders').insert({
    order_number: testOrderNumber,
    profile_id: userProfile.data.data.id,
    user_id: userProfile.data.data.id,
    edition_id: editionId,
    billing_phone: '+255700000000',
    total_tsh: 75000,
    status: 'pending'
  });
  if (ordInsertErr) console.error('  -> Failed to insert test order:', ordInsertErr);

  const validPayload = {
    order_number: testOrderNumber,
    status: 'success',
    amount_tsh: 75000,
    idempotency_key: 'idemp-' + Date.now(),
    event_type: 'charge.completed'
  };
  const validSig = crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(validPayload)).digest('hex');

  const validWebhookRes = await api('/payments/payme/webhook', {
    method: 'POST',
    headers: { 'x-payme-signature': validSig },
    body: JSON.stringify(validPayload)
  });
  console.log('  -> Valid webhook status:', validWebhookRes.status, 'status text:', validWebhookRes.data?.status);

  const replayWebhookRes = await api('/payments/payme/webhook', {
    method: 'POST',
    headers: { 'x-payme-signature': validSig },
    body: JSON.stringify(validPayload)
  });
  console.log('  -> Replay webhook duplicate_prevented:', replayWebhookRes.data?.duplicate_prevented, '(expected true)');

  const mismatchPayload = {
    order_number: testOrderNumber,
    status: 'success',
    amount_tsh: 500,
    idempotency_key: 'idemp-mismatch-' + Date.now()
  };
  const mismatchSig = crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(mismatchPayload)).digest('hex');
  const mismatchWebhookRes = await api('/payments/payme/webhook', {
    method: 'POST',
    headers: { 'x-payme-signature': mismatchSig },
    body: JSON.stringify(mismatchPayload)
  });
  console.log('  -> Amount mismatch webhook status (expected 400):', mismatchWebhookRes.status);

  results['14_webhook'] = noSigRes.status === 401 && validWebhookRes.status === 200 && replayWebhookRes.data?.duplicate_prevented === true && mismatchWebhookRes.status === 400;
  console.log('  -> Overall:', results['14_webhook'] ? 'PASS' : 'FAIL');

  console.log('\n=============================================');
  console.log('FINAL RESULTS SUMMARY:');
  console.log(JSON.stringify(results, null, 2));
  console.log('=============================================');
  process.exit(0);
}

run();
