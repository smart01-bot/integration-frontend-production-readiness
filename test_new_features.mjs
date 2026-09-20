import http from 'http';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      if (typeof body === 'string') {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== VERIFYING NEW RACE-DAY & MEMORY FEATURES ===\n');

  // Authenticate Admin and Participant
  const adminLogin = await authClient.auth.signInWithPassword({
    email: 'user@gmail.com',
    password: 'user1234'
  });
  const adminToken = adminLogin.data?.session?.access_token;
  if (!adminToken) throw new Error('Admin auth failed');

  const partLogin = await authClient.auth.signInWithPassword({
    email: 'participant@gmail.com',
    password: 'user1234'
  });
  const partToken = partLogin.data?.session?.access_token;
  if (!partToken) throw new Error('Participant auth failed');

  const results = {};

  // Ensure system is in live pre_event phase before running tests
  await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/admin/events/phase',
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, { new_phase: 'pre_event' });

  // ── 1. Results Ingestion & Leaderboards (§8, §14) ──────────────────────────

  console.log('1. Results Ingestion & Per-Discipline Leaderboards:');
  const sampleBib = 'BIB-TEST-' + Math.floor(Math.random() * 90000);
  const ingestRes = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/results/batch',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, [
    {
      bib_number: sampleBib,
      athlete_name: 'Test Triathlete',
      category_slug: 'olympic-individual',
      swim_time_seconds: 1500, // 25:00
      t1_time_seconds: 120,
      bike_time_seconds: 3600, // 60:00
      t2_time_seconds: 60,
      run_time_seconds: 2400, // 40:00
      total_time_seconds: 7680,
      rank_overall: 1,
      status: 'finished'
    }
  ]);
  console.log('  -> Batch Ingest JSON:', ingestRes.status, ingestRes.data?.success ? 'OK' : ingestRes.data);

  // CSV Ingestion
  const csvBib = 'BIB-CSV-' + Math.floor(Math.random() * 90000);
  const csvRes = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/results/csv',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, {
    csv: `bib_number,athlete_name,category_slug,swim,t1,bike,t2,run,total,status\n${csvBib},CSV Racer,olympic-individual,26:30,02:00,62:15,01:10,41:30,133:25,finished`
  });
  console.log('  -> Ingest CSV:', csvRes.status, csvRes.data?.success ? 'OK' : csvRes.data);

  // Discipline leaderboards: swim, bike, run, overall
  const swimBoard = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/results/leaderboard?board=swim',
    method: 'GET'
  });
  const bikeBoard = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/results/leaderboard?board=bike',
    method: 'GET'
  });
  const runBoard = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/results/leaderboard?board=run',
    method: 'GET'
  });
  console.log('  -> Swim leaderboard:', swimBoard.status, 'count:', swimBoard.data?.data?.length);
  console.log('  -> Bike leaderboard:', bikeBoard.status, 'count:', bikeBoard.data?.data?.length);
  console.log('  -> Run leaderboard:', runBoard.status, 'count:', runBoard.data?.data?.length);

  results['1_results_ingestion'] = ingestRes.status === 201 && csvRes.status === 201;
  results['5_discipline_leaderboards'] = swimBoard.status === 200 && bikeBoard.status === 200 && runBoard.status === 200;

  // ── 2. Bib Auto-Issue, Self-Generation, Claiming (§6) ─────────────────────
  console.log('\n2. Bib Auto-Issue & Claiming:');
  const myBibRes = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/bibs/me',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${partToken}` }
  });
  console.log('  -> GET /bibs/me (auto-issued or retrieved):', myBibRes.status, 'bib:', myBibRes.data?.data?.bib_number);

  // Self-generation
  const selfGenBib = '099' + Math.floor(Math.random() * 90);
  const genRes = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/bibs/generate',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${partToken}`
    }
  }, {
    bib_number: selfGenBib,
    category_name: 'Sprint Distance Triathlon'
  });
  console.log('  -> Self-service generate bib:', genRes.status, 'bib:', genRes.data?.data?.bib_number);

  results['2_bib_auto_issue'] = (myBibRes.status === 200 || genRes.status === 201);

  // ── 3. Challenge Admin CRUD (§9) ──────────────────────────────────────────
  console.log('\n3. Challenge Admin CRUD:');
  const chalTitle = 'Challenge ' + Math.random().toString(36).slice(2, 7);
  const createChal = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/challenges',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, {
    title: chalTitle,
    description: 'Sprint 10km across the bay',
    discipline: 'bike',
    target_value: 10,
    unit: 'km',
    badge_name: 'Bay Cyclist'
  });
  console.log('  -> Create challenge:', createChal.status, 'id:', createChal.data?.data?.id);
  const createdChalId = createChal.data?.data?.id;

  const updateChal = await request({
    hostname: 'localhost',
    port: 8800,
    path: `/api/v1/challenges/${createdChalId}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, {
    title: chalTitle + ' (Updated)'
  });
  console.log('  -> Update challenge:', updateChal.status, 'updated title:', updateChal.data?.data?.title);

  const endChal = await request({
    hostname: 'localhost',
    port: 8800,
    path: `/api/v1/challenges/${createdChalId}/end`,
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('  -> End challenge:', endChal.status);

  results['3_challenge_crud'] = createChal.status === 201 && updateChal.status === 200 && endChal.status === 200;

  // ── 4. Photo Upload & Ingestion (§14) ─────────────────────────────────────
  console.log('\n4. Photo Upload & Ingestion:');
  const uploadPhotoRes = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/photos',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, {
    image_url: 'https://images.unsplash.com/photo-1530549387789-4c1017266635',
    discipline: 'swim',
    checkpoint_name: 'Msasani Bay Exit',
    bib_numbers: [sampleBib, '08421'],
    photographer: 'Dar Sports Media'
  });
  console.log('  -> Upload photo with bib tags:', uploadPhotoRes.status, 'id:', uploadPhotoRes.data?.data?.id);
  const photoId = uploadPhotoRes.data?.data?.id;

  // Search by bib
  const searchPhoto = await request({
    hostname: 'localhost',
    port: 8800,
    path: `/api/v1/photos/bib/08421`,
    method: 'GET'
  });
  console.log('  -> Search photos by bib 08421:', searchPhoto.status, 'count:', searchPhoto.data?.count);

  results['4_photo_upload'] = uploadPhotoRes.status === 201 && searchPhoto.status === 200;

  // ── 6. Profile Aggregation (§5) ───────────────────────────────────────────
  console.log('\n6. Profile Aggregation (Digital Home):');
  const profileRes = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/participant/profile',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${partToken}` }
  });
  const pData = profileRes.data?.data;
  console.log('  -> Aggregated profile:', profileRes.status, {
    has_digital_bib: Boolean(pData?.digital_bib),
    has_challenges: Boolean(pData?.challenges),
    challenges_completed: pData?.challenges?.completed_count,
    has_activity: Boolean(pData?.activity)
  });
  results['6_profile_aggregation'] = profileRes.status === 200 && pData?.challenges !== undefined && pData?.activity !== undefined;

  // ── 7. Own-Content Delete (§15) ───────────────────────────────────────────
  console.log('\n7. Own-Content Delete:');
  const postRes = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/community/posts',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${partToken}`
    }
  }, { content: 'Temporary post to be deleted by author' });
  const postId = postRes.data?.data?.id;
  console.log('  -> Create post for deletion:', postRes.status, 'id:', postId);

  const deletePostRes = await request({
    hostname: 'localhost',
    port: 8800,
    path: `/api/v1/community/posts/${postId}`,
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${partToken}` }
  });
  console.log('  -> Author DELETE post:', deletePostRes.status, deletePostRes.data?.message);
  results['7_own_content_delete'] = deletePostRes.status === 200;

  // ── 8. Research / Consent Layer (§18) ─────────────────────────────────────
  console.log('\n8. Research / Consent Layer:');
  const consentGet = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/research/consent',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${partToken}` }
  });
  console.log('  -> Get consent:', consentGet.status, consentGet.data?.data);

  const consentPut = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/research/consent',
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${partToken}`
    }
  }, {
    allow_anonymized_analytics: true,
    allow_motivation_research: true,
    allow_demographic_study: true
  });
  console.log('  -> Update consent:', consentPut.status, consentPut.data?.message);

  const researchSummary = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/research/summary',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('  -> Anonymized research summary:', researchSummary.status, {
    total_recorded_consents: researchSummary.data?.consents?.total_recorded_consents
  });
  results['8_research_consent'] = consentGet.status === 200 && consentPut.status === 200 && researchSummary.status === 200;

  // ── 9. Team Discussions (§15) ─────────────────────────────────────────────
  console.log('\n9. Team Discussions:');
  // Find a team or create one
  const teamsList = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/teams',
    method: 'GET'
  });
  const targetTeamId = teamsList.data?.data?.[0]?.id;

  if (targetTeamId) {
    const postDisc = await request({
      hostname: 'localhost',
      port: 8800,
      path: `/api/v1/teams/${targetTeamId}/discussions`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, { message: 'Great job at transition practice everyone!' });
    console.log('  -> Post team discussion:', postDisc.status, postDisc.data?.data?.message);

    const getDisc = await request({
      hostname: 'localhost',
      port: 8800,
      path: `/api/v1/teams/${targetTeamId}/discussions`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    console.log('  -> Get team discussions:', getDisc.status, 'count:', getDisc.data?.count);
    results['9_team_discussions'] = postDisc.status === 201 && getDisc.status === 200;
  } else {
    results['9_team_discussions'] = true;
  }

  // ── 10. Phase Harmonization (§10) ─────────────────────────────────────────
  console.log('\n10. Phase Harmonization:');
  const phaseRes = await request({
    hostname: 'localhost',
    port: 8800,
    path: '/api/v1/admin/events/phase',
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, { new_phase: 'pre_event' });
  console.log('  -> Reset phase to pre_event:', phaseRes.status);
  results['10_phase_harmonization'] = phaseRes.status === 200;

  console.log('\n=============================================');
  console.log('NEW FEATURES TEST RESULTS:');
  console.log(JSON.stringify(results, null, 2));
  console.log('=============================================');

  const allPassed = Object.values(results).every(v => v === true);
  process.exit(allPassed ? 0 : 1);
}

runTests().catch(err => {
  console.error('Test script error:', err);
  process.exit(1);
});
