const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

const supabaseUrl = process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const supabaseKey = process.env.SUPABASE_KEY || 'YOUR_SUPABASE_SERVICE_ROLE_KEY';

const supabase = createClient(supabaseUrl, supabaseKey);

const initDB = async () => {
    console.log('Supabase initialized.');
    
    try {
        // Seed default admin user if not exists
        const { data: existingAdmin } = await supabase
            .from('users')
            .select('id')
            .eq('role', 'admin')
            .limit(1)
            .single();

        if (!existingAdmin) {
            const hash = await bcrypt.hash('admin123', 10);
            const { error: insertError } = await supabase
                .from('users')
                .insert([{
                    username: 'admin',
                    email: 'admin@tangolive.com',
                    password: hash,
                    coin_balance: 9999999,
                    role: 'admin'
                }]);
            
            if (!insertError) {
                console.log('Default admin user created: admin / admin123');
            } else {
                console.error("Failed to seed admin:", insertError.message);
            }
        }
    } catch (e) {
        console.error("Error connecting to Supabase during init:", e.message);
    }
};

module.exports = { db: supabase, initDB };
