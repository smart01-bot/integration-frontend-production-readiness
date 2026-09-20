import supabase from '../config/supabase.js';

// Schema: migration 017 `race_photos`:
// image_url (NOT NULL), thumb_url, discipline (swim|bike|run|finish|awards|general),
// checkpoint_name, bib_numbers TEXT[] (GIN-indexed), photographer, taken_at.

const DISCIPLINES = ['swim', 'bike', 'run', 'finish', 'awards', 'general'];

export const getPhotos = async (req, res) => {
  try {
    const { page, limit, offset } = req.pagination || { page: 1, limit: 24, offset: 0 };
    const { discipline, bib_number } = req.query;
    let query = supabase
      .from('race_photos')
      .select('*', { count: 'exact' })
      .order('taken_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (discipline) query = query.eq('discipline', discipline);
    if (bib_number) query = query.contains('bib_numbers', [String(bib_number)]);

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (err) {
    console.error('Error fetching photos:', err);
    res.status(500).json({ error: 'Failed to retrieve photos' });
  }
};

export const searchPhotosByBib = async (req, res) => {
  try {
    const { bib_number } = req.params;
    if (!/^\d+$/.test(bib_number)) return res.status(400).json({ error: 'Invalid bib number' });
    const { data, error } = await supabase
      .from('race_photos')
      .select('*')
      .contains('bib_numbers', [bib_number])
      .order('taken_at', { ascending: true });
    if (error) throw error;
    res.json({ success: true, bib_number, count: (data || []).length, data: data || [] });
  } catch (err) {
    console.error('Error searching photos by bib:', err);
    res.status(500).json({ error: 'Failed to search photos' });
  }
};

// ── Helper: parse bib_numbers from array or comma-separated string ──
function parseBibNumbers(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(String).map(s => s.trim()).filter(Boolean);
  return String(input).split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * §14 Photo Upload / Registration
 * POST /api/v1/photos
 * Accepts:
 *   - image_url (direct URL or CDN link) OR file_base64 / image_data (uploaded to Supabase Storage)
 *   - bib_numbers: ["08421", "08422"] or "08421, 08422"
 *   - discipline: 'swim' | 'bike' | 'run' | 'finish' | 'awards' | 'general'
 *   - checkpoint_name: e.g. "Msasani Bay Exit", "Coco Beach Finish Chute"
 *   - photographer: name / agency
 */
export const uploadPhoto = async (req, res) => {
  try {
    const {
      image_url,
      file_base64,
      file_name,
      content_type = 'image/jpeg',
      thumb_url,
      discipline = 'general',
      checkpoint_name,
      bib_numbers,
      photographer,
      taken_at
    } = req.body;

    let finalImageUrl = image_url;

    // Handle base64 upload to Supabase Storage if provided
    if (!finalImageUrl && file_base64) {
      try {
        const bucketName = 'race-photos';
        const buffer = Buffer.from(file_base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const filename = `${Date.now()}-${file_name || 'photo.jpg'}`;

        const uploadRes = await supabase.storage
          .from(bucketName)
          .upload(filename, buffer, {
            contentType: content_type,
            upsert: true
          });

        if (uploadRes.data?.path) {
          const { data: pubUrl } = supabase.storage.from(bucketName).getPublicUrl(uploadRes.data.path);
          finalImageUrl = pubUrl.publicUrl;
        }
      } catch (storageErr) {
        console.warn('Storage upload error, falling back to data URL if needed:', storageErr.message);
      }
    }

    if (!finalImageUrl) {
      return res.status(400).json({ error: 'image_url or file_base64 is required' });
    }

    if (discipline && !DISCIPLINES.includes(discipline)) {
      return res.status(400).json({ error: 'Invalid discipline. Allowed: ' + DISCIPLINES.join(', ') });
    }

    const bibs = parseBibNumbers(bib_numbers);

    const { data, error } = await supabase
      .from('race_photos')
      .insert({
        image_url: finalImageUrl,
        thumb_url: thumb_url || finalImageUrl,
        discipline,
        checkpoint_name: checkpoint_name || null,
        bib_numbers: bibs,
        photographer: photographer || (req.user?.full_name || 'Official Photographer'),
        taken_at: taken_at || new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('Error uploading race photo:', err);
    res.status(500).json({ error: 'Failed to upload photo: ' + err.message });
  }
};

/**
 * POST /api/v1/photos/batch
 * Ingest multiple photos at once with bib tags.
 */
export const batchUploadPhotos = async (req, res) => {
  try {
    const photos = Array.isArray(req.body) ? req.body : req.body.photos;
    if (!photos || !photos.length) {
      return res.status(400).json({ error: 'Array of photo objects is required' });
    }

    const records = photos.map(p => ({
      image_url: p.image_url,
      thumb_url: p.thumb_url || p.image_url,
      discipline: DISCIPLINES.includes(p.discipline) ? p.discipline : 'general',
      checkpoint_name: p.checkpoint_name || null,
      bib_numbers: parseBibNumbers(p.bib_numbers),
      photographer: p.photographer || 'Official Media',
      taken_at: p.taken_at || new Date().toISOString()
    })).filter(p => p.image_url);

    if (records.length === 0) {
      return res.status(400).json({ error: 'No valid photos with image_url found' });
    }

    const { data, error } = await supabase
      .from('race_photos')
      .insert(records)
      .select();

    if (error) throw error;

    res.status(201).json({
      success: true,
      count: data.length,
      data
    });
  } catch (err) {
    console.error('Error batch uploading photos:', err);
    res.status(500).json({ error: 'Failed to batch upload photos: ' + err.message });
  }
};

/**
 * DELETE /api/v1/photos/:photoId
 * Remove a photo. Requires admin.
 */
export const deletePhoto = async (req, res) => {
  try {
    const { photoId } = req.params;
    const { error } = await supabase
      .from('race_photos')
      .delete()
      .eq('id', photoId);

    if (error) throw error;
    res.json({ success: true, message: 'Photo deleted successfully' });
  } catch (err) {
    console.error('Error deleting photo:', err);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
};
