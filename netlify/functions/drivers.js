const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

async function getAuthContext(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const { data: { user }, error } = await supabase.auth.getUser(auth.slice(7));
  if (error || !user) return null;
  const { data: member } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', user.id)
    .single();
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
        .from('drivers')
        .select('name')
        .eq('org_id', ctx.orgId)
        .order('name');
      if (error) throw error;
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data.map(d => d.name)) };
    }

    if (event.httpMethod === 'POST') {
      const { name } = JSON.parse(event.body);
      if (!name?.trim()) return { statusCode: 400, headers: HEADERS, body: 'Name required' };
      const { error } = await supabase.from('drivers').upsert(
        { name: name.trim(), org_id: ctx.orgId },
        { onConflict: 'name,org_id', ignoreDuplicates: true }
      );
      if (error) throw error;
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };
  } catch (err) {
    console.error('drivers fn error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
