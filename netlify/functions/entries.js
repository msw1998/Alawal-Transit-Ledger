const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  try {
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('entries')
        .select('data')
        .order('date', { ascending: false });
      if (error) throw error;
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data.map(r => r.data)) };
    }

    if (event.httpMethod === 'POST') {
      const entry = JSON.parse(event.body);
      const { error } = await supabase.from('entries').upsert({
        id: entry.id,
        date: entry.date,
        driver: entry.driver,
        data: entry,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body);
      const { error } = await supabase.from('entries').delete().eq('id', id);
      if (error) throw error;
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };
  } catch (err) {
    console.error('entries fn error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
