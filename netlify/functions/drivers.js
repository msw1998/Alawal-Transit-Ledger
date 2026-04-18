const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  try {
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase.from('drivers').select('name').order('name');
      if (error) throw error;
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data.map(d => d.name)) };
    }

    if (event.httpMethod === 'POST') {
      const { name } = JSON.parse(event.body);
      if (!name?.trim()) return { statusCode: 400, headers: HEADERS, body: 'Name required' };
      const { error } = await supabase.from('drivers').upsert({ name: name.trim() });
      if (error) throw error;
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };
  } catch (err) {
    console.error('drivers fn error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
