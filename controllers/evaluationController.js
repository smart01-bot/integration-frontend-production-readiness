import { supabase } from '../config/supabase.js';

/**
 * Evaluation Controller (Schedule C - Monitoring & Impact Evaluation)
 * 100% Database-backed survey intake and analytical reporting
 */

export const submitEvaluationSurvey = async (req, res) => {
  try {
    const { 
      edition_id,
      activity_id,
      nps_score = 10, 
      route_safety_rating = 5, 
      hydration_rating = 5, 
      merchandise_rating = 5,
      app_experience_rating = 5,
      what_went_well,
      areas_for_improvement,
      would_recommend = true 
    } = req.body;

    const newSurvey = {
      edition_id: edition_id || null,
      activity_id: activity_id || null,
      nps_score: Number(nps_score),
      route_safety_rating: Number(route_safety_rating),
      hydration_rating: Number(hydration_rating),
      merchandise_rating: Number(merchandise_rating),
      app_experience_rating: Number(app_experience_rating),
      what_went_well: what_went_well || null,
      areas_for_improvement: areas_for_improvement || null,
      would_recommend: Boolean(would_recommend),
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('evaluation_surveys')
      .insert([newSurvey])
      .select()
      .single();

    if (error) {
      console.error('Error saving survey to database:', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({
      status: 'success',
      message: 'Asante sana! Your evaluation has been recorded in the database for the Schedule C Impact Study.',
      data
    });
  } catch (error) {
    console.error('submitEvaluationSurvey exception:', error);
    return res.status(500).json({ error: 'Failed to submit post-event evaluation' });
  }
};

export const getEvaluationResults = async (req, res) => {
  try {
    const { data: surveys, error } = await supabase
      .from('evaluation_surveys')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const count = surveys ? surveys.length : 0;
    
    if (count === 0) {
      return res.status(200).json({
        status: 'success',
        edition: 'Tour de Rotary Dar es Salaam 2026',
        evaluation_metrics: {
          total_surveys_completed: 0,
          net_promoter_score: 0,
          satisfaction_rate: '0%',
          route_safety_avg_rating: 0,
          hydration_stations_avg_rating: 0,
          digital_platform_avg_rating: 0
        },
        feedback: []
      });
    }

    const avgNps = (surveys.reduce((acc, s) => acc + (Number(s.nps_score) || 0), 0) / count).toFixed(1);
    const avgSafety = (surveys.reduce((acc, s) => acc + (Number(s.route_safety_rating) || 0), 0) / count).toFixed(1);
    const avgHydration = (surveys.reduce((acc, s) => acc + (Number(s.hydration_rating) || 0), 0) / count).toFixed(1);
    const avgApp = (surveys.reduce((acc, s) => acc + (Number(s.app_experience_rating) || 0), 0) / count).toFixed(1);

    const promoters = surveys.filter(s => s.nps_score >= 9).length;
    const satisfactionRate = `${((promoters / count) * 100).toFixed(1)}%`;

    return res.status(200).json({
      status: 'success',
      edition: 'Tour de Rotary Dar es Salaam 2026',
      evaluation_metrics: {
        total_surveys_completed: count,
        net_promoter_score: Number(avgNps),
        satisfaction_rate: satisfactionRate,
        route_safety_avg_rating: Number(avgSafety),
        hydration_stations_avg_rating: Number(avgHydration),
        digital_platform_avg_rating: Number(avgApp)
      },
      feedback: surveys.map(s => ({
        id: s.id,
        nps: s.nps_score,
        comment: s.what_went_well,
        improvement: s.areas_for_improvement,
        created_at: s.created_at
      }))
    });
  } catch (error) {
    console.error('getEvaluationResults exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve evaluation results' });
  }
};

export const getScheduleCImpactReport = async (req, res) => {
  try {
    // Aggregate live stats from database
    const { count: checkedInCount } = await supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('checked_in', true);

    const { data: payments } = await supabase
      .from('payments')
      .select('amount_tsh')
      .eq('status', 'successful');

    const totalFundsRaised = (payments || []).reduce((sum, p) => sum + (Number(p.amount_tsh) || 0), 0);

    const { count: totalSurveys } = await supabase
      .from('evaluation_surveys')
      .select('id', { count: 'exact', head: true });

    return res.status(200).json({
      status: 'success',
      schedule: 'Schedule C - Post-Event Monitoring, Measurement & Evaluation',
      event_edition: 'Tour de Rotary Dar es Salaam 2026',
      reporting_timestamp: new Date().toISOString(),
      live_metrics: {
        verified_finishers_count: checkedInCount || 0,
        total_funds_raised_tsh: totalFundsRaised,
        evaluation_surveys_submitted: totalSurveys || 0
      },
      charity_cause: {
        initiative: 'Rotary Club Maternal & Neonatal Health Initiative',
        beneficiary_units: [
          'Amana Regional Hospital Maternity Ward',
          'Kawe Health Centre Neonatal Care Unit',
          'Kigamboni Mother-and-Child Health Post'
        ],
        equipment_focus: 'Infant incubators and sterile maternal delivery packs'
      }
    });
  } catch (error) {
    console.error('getScheduleCImpactReport exception:', error);
    return res.status(500).json({ error: 'Failed to aggregate Schedule C impact report' });
  }
};
