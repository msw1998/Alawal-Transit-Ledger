const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

async function getAuthContext(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const { data: { user }, error } = await supabase.auth.getUser(auth.slice(7));
  if (error || !user) return null;
  const requestedOrgId = event.headers['x-org-id'];
  let query = supabase.from('org_members').select('org_id, role').eq('user_id', user.id);
  if (requestedOrgId) query = query.eq('org_id', requestedOrgId);
  const { data: members } = await query.order('created_at', { ascending: true }).limit(1);
  const member = members?.[0] || null;
  if (!member) return null;
  return { userId: user.id, orgId: member.org_id, role: member.role };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  const ctx = await getAuthContext(event);
  if (!ctx) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };

  try {
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, plate, name')
        .eq('org_id', ctx.orgId)
        .order('created_at');
      if (error) throw error;
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data) };
    }

    if (event.httpMethod === 'POST') {
      const { plate, name } = JSON.parse(event.body || '{}');
      if (!plate?.trim()) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Plate is required' }) };
      const { data, error } = await supabase
        .from('vehicles')
        .insert({ plate: plate.trim().toUpperCase(), name: (name || '').trim(), org_id: ctx.orgId })
        .select('id, plate, name')
        .single();
      if (error && error.code === '23505') return { statusCode: 409, headers: HEADERS, body: JSON.stringify({ error: 'Vehicle with this plate already exists' }) };
      if (error) throw error;
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data) };
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters?.id;
      if (!id) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'id required' }) };
      const { error } = await supabase.from('vehicles').delete().eq('id', id).eq('org_id', ctx.orgId);
      if (error) throw error;
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };
  } catch (err) {
    console.error('vehicles fn error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
