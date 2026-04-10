-- Supabase Schema for TangoLive

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  coin_balance INTEGER DEFAULT 1000,
  role TEXT DEFAULT 'user',
  avatar TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  is_banned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Streams table
CREATE TABLE IF NOT EXISTS streams (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  title TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  type TEXT DEFAULT 'public',
  host_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_live BOOLEAN DEFAULT FALSE,
  viewer_count INTEGER DEFAULT 0,
  livekit_room TEXT,
  thumbnail TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Gifts catalog table
CREATE TABLE IF NOT EXISTS gifts (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  coin_cost INTEGER NOT NULL
);

-- 4. Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  sender_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  receiver_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  gift_id BIGINT REFERENCES gifts(id) ON DELETE SET NULL,
  stream_id BIGINT REFERENCES streams(id) ON DELETE SET NULL,
  gift_name TEXT,
  gift_icon TEXT,
  amount INTEGER NOT NULL,
  type TEXT DEFAULT 'gift',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Withdrawals table
CREATE TABLE IF NOT EXISTS withdrawals (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Stream join requests
CREATE TABLE IF NOT EXISTS stream_requests (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  stream_id BIGINT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Direct Messages table
CREATE TABLE IF NOT EXISTS messages (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Followers table
CREATE TABLE IF NOT EXISTS followers (
  follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id)
);

-- Enable RLS (Optional, but recommended for Supabase)
-- For this migration, we'll keep it simple and assume the backend handles auth.

-- Seed default gifts
INSERT INTO gifts (name, icon, coin_cost) VALUES 
('Rose', '🌹', 10),
('Star', '⭐', 50),
('Diamond', '💎', 200),
('Crown', '👑', 500)
ON CONFLICT DO NOTHING;
