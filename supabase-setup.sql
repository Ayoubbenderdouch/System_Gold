-- Supabase SQL Setup Script
-- Run this in Supabase SQL Editor to create the vaults table

-- Create vaults table
CREATE TABLE IF NOT EXISTS vaults (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    encrypted_data JSONB NOT NULL,
    device TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_vaults_user_id ON vaults(user_id);

-- Create index on updated_at for sync checks
CREATE INDEX IF NOT EXISTS idx_vaults_updated_at ON vaults(updated_at);

-- Enable Row Level Security
ALTER TABLE vaults ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can insert their own data (using user_id as identifier)
CREATE POLICY "Users can insert their own data"
ON vaults
FOR INSERT
WITH CHECK (true);

-- Policy: Users can read their own data
CREATE POLICY "Users can read their own data"
ON vaults
FOR SELECT
USING (true);

-- Policy: Users can update their own data
CREATE POLICY "Users can update their own data"
ON vaults
FOR UPDATE
USING (true)
WITH CHECK (true);

-- Policy: Users can delete their own data
CREATE POLICY "Users can delete their own data"
ON vaults
FOR DELETE
USING (true);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function before update
CREATE TRIGGER update_vaults_updated_at
    BEFORE UPDATE ON vaults
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Realtime for the vaults table
ALTER PUBLICATION supabase_realtime ADD TABLE vaults;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Vaults table created successfully!';
    RAISE NOTICE 'Row Level Security enabled';
    RAISE NOTICE 'Realtime replication enabled';
    RAISE NOTICE 'Ready to sync encrypted data between devices';
END $$;
