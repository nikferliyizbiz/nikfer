// ============================================================
// Nikfer Belleği — Veritabanı Katmanı
// ============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── QUERY HELPER ─────────────────────────────────────────────
// Tekrar eden hata yönetimini merkezileştirir
async function q(builder) {
  const { data, error } = await builder;
  if (error) throw error;
  return data;
}

// ── SECTIONS ─────────────────────────────────────────────────

export function getSections() {
  return q(supabase.from('sections').select('*').eq('is_visible', true).order('sort_order'));
}

// Admin için — gizli bölümler de dahil tümünü getirir
export function getAllSections() {
  return q(supabase.from('sections').select('*').order('sort_order'));
}

export function getFeaturedSections() {
  return q(
    supabase.from('sections').select('*')
      .eq('is_visible', true).eq('is_featured', true)
      .order('sort_order').limit(4)
  );
}

export function getRecentComments(limit = 3) {
  return q(
    supabase.from('comments')
      .select('*, sections(title, slug, icon)')
      .eq('is_approved', true)
      .order('created_at', { ascending: false })
      .limit(limit)
  );
}

export function getSectionBySlug(slug) {
  return q(supabase.from('sections').select('*').eq('slug', slug).single());
}

// ── CONTENT BLOCKS ───────────────────────────────────────────

export function getContentBlocks(sectionId) {
  return q(supabase.from('content_blocks').select('*').eq('section_id', sectionId).order('sort_order'));
}

// Paralel sorgular — önceki sıralı yapıya göre ~%60 daha hızlı
export async function getSectionWithContent(slug) {
  const section = await getSectionBySlug(slug);
  const [blocks, audio, links, gallery] = await Promise.all([
    getContentBlocks(section.id),
    getAudioFiles(section.id),
    getLinks(section.id),
    getGallery(section.id),
  ]);
  return { section, blocks, audio, links, gallery };
}

// ── AUDIO ────────────────────────────────────────────────────

export function getAudioFiles(sectionId) {
  return q(supabase.from('audio_files').select('*').eq('section_id', sectionId).order('sort_order'));
}

export function getPublicUrl(filePath) {
  const { data } = supabase.storage.from('nikfer-media').getPublicUrl(filePath);
  return data.publicUrl;
}

// ── LINKS ────────────────────────────────────────────────────

export function getLinks(sectionId) {
  return q(supabase.from('links').select('*').eq('section_id', sectionId).order('sort_order'));
}

// ── GALLERY ──────────────────────────────────────────────────

export function getGallery(sectionId) {
  return q(supabase.from('gallery').select('*').eq('section_id', sectionId).order('sort_order'));
}

// ── COMMENTS ─────────────────────────────────────────────────

export async function getApprovedComments(sectionId = null) {
  let builder = supabase
    .from('comments')
    .select('*')
    .eq('is_approved', true)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (sectionId) builder = builder.eq('section_id', sectionId);
  return q(builder);
}

export async function submitComment({ sectionId, authorName, authorNote, content }) {
  const { error } = await supabase
    .from('comments')
    .insert({
      section_id:  sectionId,
      author_name: authorName,
      author_note: authorNote,
      content,
      is_approved: false
    });
  if (error) throw error;
}
// ── REALTIME (canlı yorum güncellemesi) ──────────────────────

export function subscribeComments(sectionId, callback) {
  return supabase
    .channel(`comments-${sectionId}`)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'comments',
        filter: `section_id=eq.${sectionId}`
      },
      (payload) => {
        if (payload.new.is_approved) callback(payload.new);
      }
    )
    .subscribe();
}

// ── SITE SETTINGS ────────────────────────────────────────────

export async function getSiteSettings() {
  const { data, error } = await supabase
    .from('site_settings')
    .select('*');
  if (error) throw error;
  // key:value objesi döndür
  return Object.fromEntries(data.map(r => [r.key, r]));
}

export async function updateSiteSetting(key, value) {
  const { data, error } = await supabase
    .from('site_settings')
    .upsert({ key, value })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Otomatik istatistikler — paralel sorgularla hesapla
export async function getStatCounts() {
  try {
    // Adım 1: slug → id + genel sayılar paralel
    const [slugRes, sectRes, commRes] = await Promise.all([
      supabase.from('sections').select('id, slug').in('slug', ['muhtarlar', 'canakkale']),
      supabase.from('sections').select('*', { count: 'exact', head: true }).eq('is_visible', true),
      supabase.from('comments').select('*', { count: 'exact', head: true }).eq('is_approved', true),
    ]);

    if (slugRes.error) throw slugRes.error;

    const muhtarId    = slugRes.data?.find(s => s.slug === 'muhtarlar')?.id || null;
    const canakkaleId = slugRes.data?.find(s => s.slug === 'canakkale')?.id || null;

    // Adım 2: tablo satırı sayıları paralel
    const [muhtarRes, sehitRes] = await Promise.all([
      muhtarId
        ? supabase.from('content_blocks').select('*', { count: 'exact', head: true }).eq('type', 'table_row').eq('section_id', muhtarId)
        : Promise.resolve({ count: 0 }),
      canakkaleId
        ? supabase.from('content_blocks').select('*', { count: 'exact', head: true }).eq('type', 'table_row').eq('section_id', canakkaleId)
        : Promise.resolve({ count: 0 }),
    ]);

    return {
      sectionCount: sectRes.count ?? 0,
      commentCount: commRes.count ?? 0,
      muhtarCount:  muhtarRes.count ?? 0,
      sehitCount:   sehitRes.count ?? 0,
    };

  } catch(e) {
    console.error('getStatCounts hatası:', e);
    return { sectionCount: 0, commentCount: 0, muhtarCount: 0, sehitCount: 0 };
  }
}

// ── AUTH ─────────────────────────────────────────────────────

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => callback(event, session));
}

// ── ADMIN: SECTIONS ──────────────────────────────────────────

export function createSection(payload) {
  return q(supabase.from('sections').insert(payload).select().single());
}

export function updateSection(id, payload) {
  return q(supabase.from('sections').update(payload).eq('id', id).select().single());
}

export async function deleteSection(id) {
  const { error } = await supabase.from('sections').delete().eq('id', id);
  if (error) throw error;
}

// ── ADMIN: CONTENT BLOCKS ────────────────────────────────────

export function createBlock(payload) {
  return q(supabase.from('content_blocks').insert(payload).select().single());
}

export function updateBlock(id, payload) {
  return q(supabase.from('content_blocks').update(payload).eq('id', id).select().single());
}

export async function deleteBlock(id) {
  const { error } = await supabase.from('content_blocks').delete().eq('id', id);
  if (error) throw error;
}

// ── ADMIN: AUDIO ─────────────────────────────────────────────

export async function uploadAudio(sectionId, file, title) {
  const ext      = file.name.split('.').pop();
  const filePath = `audio/${sectionId}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage.from('nikfer-media').upload(filePath, file);
  if (upErr) throw upErr;

  return q(
    supabase.from('audio_files')
      .insert({ section_id: sectionId, title, file_path: filePath, file_url: getPublicUrl(filePath) })
      .select().single()
  );
}

export function updateAudio(id, payload) {
  return q(supabase.from('audio_files').update(payload).eq('id', id).select().single());
}

export async function deleteAudio(id, filePath) {
  const { error: storageErr } = await supabase.storage.from('nikfer-media').remove([filePath]);
  if (storageErr) console.warn('Audio Storage\'dan silinemedi:', storageErr.message);
  const { error } = await supabase.from('audio_files').delete().eq('id', id);
  if (error) throw error;
}

// ── ADMIN: GALLERY ───────────────────────────────────────────

export async function uploadImage(sectionId, file, title, caption) {
  const ext      = file.name.split('.').pop();
  const filePath = `gallery/${sectionId}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage.from('nikfer-media').upload(filePath, file);
  if (upErr) throw upErr;

  return q(
    supabase.from('gallery')
      .insert({ section_id: sectionId, title, caption, file_path: filePath, file_url: getPublicUrl(filePath) })
      .select().single()
  );
}

export function updateImage(id, payload) {
  return q(supabase.from('gallery').update(payload).eq('id', id).select().single());
}

export async function deleteImage(id, filePath) {
  const { error: storageErr } = await supabase.storage.from('nikfer-media').remove([filePath]);
  if (storageErr) console.warn('Görsel Storage\'dan silinemedi:', storageErr.message);
  const { error } = await supabase.from('gallery').delete().eq('id', id);
  if (error) throw error;
}

// ── ADMIN: LINKS ─────────────────────────────────────────────

export function createLink(payload) {
  return q(supabase.from('links').insert(payload).select().single());
}

export function updateLink(id, payload) {
  return q(supabase.from('links').update(payload).eq('id', id).select().single());
}

export async function deleteLink(id) {
  const { error } = await supabase.from('links').delete().eq('id', id);
  if (error) throw error;
}

// ── ADMIN: COMMENTS ──────────────────────────────────────────

export function getAllComments() {
  return q(
    supabase.from('comments')
      .select('*, sections(title)')
      .order('created_at', { ascending: false })
  );
}

export function approveComment(id) {
  return q(supabase.from('comments').update({ is_approved: true }).eq('id', id).select().single());
}

export function pinComment(id, pinned) {
  return q(supabase.from('comments').update({ is_pinned: pinned }).eq('id', id).select().single());
}

export async function deleteComment(id) {
  const { error } = await supabase.from('comments').delete().eq('id', id);
  if (error) throw error;
}
