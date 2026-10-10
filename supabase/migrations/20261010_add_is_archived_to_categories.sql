-- Add is_archived column to finance_categories table
ALTER TABLE finance_categories ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
